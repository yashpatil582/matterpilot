/**
 * iManage Work adapter — Work REST API (mocked).
 *
 * Real production code would call the customer's iManage Work tenant
 * (typically `https://{customer}.imanage.work/work/api/v2/`) with a Bearer
 * access token obtained via OAuth 2.0 PKCE. Every mocked call carries a
 * `REAL:` comment citing the exact iManage endpoint a production call
 * would hit. See ./README.md for the auth + endpoint cheatsheet.
 *
 * iManage docs claim coverage of 81% of AmLaw 200 firms — this is the
 * adapter most likely to matter for an enterprise August deployment.
 */

import { registerConnector } from '../../registry';
import type {
  Connector,
  ConnectorCtx,
  ConnectorSession,
  DocumentRef,
  FetchedDocument,
  FolderRef,
  PushTarget,
} from '../../types';

const MOCK_LIBRARY = 'ACTIVE'; // iManage convention for the live work library
const MOCK_BASE_URL = 'https://demo.imanage.work/work/api/v2';

const MOCK_FOLDERS: FolderRef[] = [
  { id: `${MOCK_LIBRARY}!CLIENT-1027`, name: 'Acme Corporation (1027)', path: '/Acme Corporation', parentId: null },
  { id: `${MOCK_LIBRARY}!MATTER-1027.001`, name: '1027.001 - Acme v. Smith', path: '/Acme Corporation/1027.001 - Acme v. Smith', parentId: `${MOCK_LIBRARY}!CLIENT-1027` },
  { id: `${MOCK_LIBRARY}!FOLDER-1027.001.CONTRACTS`, name: 'Contracts', path: '/Acme Corporation/1027.001 - Acme v. Smith/Contracts', parentId: `${MOCK_LIBRARY}!MATTER-1027.001` },
  { id: `${MOCK_LIBRARY}!FOLDER-1027.001.DISCOVERY`, name: 'Discovery', path: '/Acme Corporation/1027.001 - Acme v. Smith/Discovery', parentId: `${MOCK_LIBRARY}!MATTER-1027.001` },
];

type StoredDoc = Omit<DocumentRef, 'bytes'> & { payload: Uint8Array };

const MOCK_DOCS: StoredDoc[] = [
  {
    id: `${MOCK_LIBRARY}!387245.1`,
    name: 'Acme-Smith Settlement Term Sheet v3.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    payload: new TextEncoder().encode('Mock iManage doc — Settlement Term Sheet v3'),
    modifiedAt: new Date('2026-03-04T11:22:00Z'),
    folderId: `${MOCK_LIBRARY}!FOLDER-1027.001.CONTRACTS`,
  },
  {
    id: `${MOCK_LIBRARY}!387301.2`,
    name: 'Smith - Document Production Log.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    payload: new TextEncoder().encode('Mock iManage doc — Document Production Log'),
    modifiedAt: new Date('2026-03-12T08:00:00Z'),
    folderId: `${MOCK_LIBRARY}!FOLDER-1027.001.DISCOVERY`,
  },
];

function toRef(d: StoredDoc): DocumentRef {
  const { id, name, mimeType, payload, modifiedAt, folderId } = d;
  return { id, name, mimeType, bytes: payload.byteLength, modifiedAt, folderId };
}

export const imanageConnector: Connector = {
  id: 'imanage',
  displayName: 'iManage Work',
  authMode: 'oauth2-pkce',

  describe(): string {
    return 'iManage Work document management. OAuth 2.0 PKCE; scopes admin + user + downloads. (Mocked.)';
  },

  async authenticate(ctx: ConnectorCtx): Promise<ConnectorSession> {
    /* REAL:
     *   1. App launches the iManage authorisation endpoint in a browser:
     *      GET https://{customer}.imanage.work/auth/oauth2/authorize
     *        ?response_type=code
     *        &client_id={app-client-id}
     *        &redirect_uri={app-callback-url}
     *        &scope=admin user
     *        &code_challenge={S256(verifier)}
     *        &code_challenge_method=S256
     *        &state={csrf-token}
     *   2. User signs in (iManage typically chains to the firm's SSO).
     *   3. Code redeemed for access token:
     *      POST https://{customer}.imanage.work/auth/oauth2/token
     *        grant_type=authorization_code
     *        code={auth-code}
     *        redirect_uri={app-callback-url}
     *        client_id={app-client-id}
     *        code_verifier={pkce-verifier}
     *
     *   The returned access_token is a Bearer for /work/api/v2/* calls.
     *   Refresh tokens follow the standard OAuth refresh grant.
     */
    return {
      connectorId: 'imanage',
      authMode: 'oauth2-pkce',
      accessToken: `mock-imanage-token-for-${ctx.userEmail}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context: {
        baseUrl: MOCK_BASE_URL,
        library: MOCK_LIBRARY,
        userEmail: ctx.userEmail,
      },
    };
  },

  async listFolders(session, parentRef): Promise<FolderRef[]> {
    /* REAL:
     *   When parentRef is omitted (top-level):
     *     GET {baseUrl}/customers/{customerId}/libraries/{library}/clients
     *
     *   When parentRef points at a client/matter/folder:
     *     GET {baseUrl}/customers/{customerId}/libraries/{library}/folders/{folderId}/children
     *       ?type=folder
     *
     *   Authorization: Bearer {session.accessToken}
     *   X-Auth-Token: {session.accessToken}   (some endpoints accept either)
     */
    void session;
    return MOCK_FOLDERS.filter((f) => f.parentId === (parentRef ?? null));
  },

  async listDocuments(session, folderRef): Promise<DocumentRef[]> {
    /* REAL:
     *   GET {baseUrl}/customers/{customerId}/libraries/{library}/folders/{folderRef}/children
     *     ?type=document
     *     &fields=id,name,extension,size,edit_date,filed_by
     *   Authorization: Bearer {session.accessToken}
     */
    void session;
    return MOCK_DOCS.filter((d) => d.folderId === folderRef).map(toRef);
  },

  async fetchDocument(session, ref): Promise<FetchedDocument> {
    /* REAL:
     *   GET {baseUrl}/customers/{customerId}/libraries/{library}/documents/{ref}/download
     *   Authorization: Bearer {session.accessToken}
     *
     *   Document IDs are colon-separated `LIBRARY!NUMBER.VERSION` —
     *   passing only `LIBRARY!NUMBER` retrieves the latest version.
     */
    void session;
    const doc = MOCK_DOCS.find((d) => d.id === ref);
    if (!doc) throw new Error(`imanage: document not found: ${ref}`);
    return { bytes: doc.payload, mime: doc.mimeType, name: doc.name };
  },

  async pushDocument(session, target: PushTarget): Promise<DocumentRef> {
    /* REAL:
     *   1. Reserve the document slot:
     *      POST {baseUrl}/customers/{customerId}/libraries/{library}/documents
     *      body: { folder_id: target.folderRef, name: target.name, ... }
     *   2. Upload the file body:
     *      PUT {baseUrl}/customers/{customerId}/libraries/{library}/documents/{newId}/upload
     *      Content-Type: target.mime
     *      Authorization: Bearer {session.accessToken}
     */
    const id = `${MOCK_LIBRARY}!${Math.floor(Math.random() * 900000) + 100000}.1`;
    const doc: StoredDoc = {
      id,
      name: target.name,
      mimeType: target.mime ?? 'application/octet-stream',
      payload: target.bytes,
      modifiedAt: new Date(),
      folderId: target.folderRef,
    };
    MOCK_DOCS.push(doc);
    void session;
    return toRef(doc);
  },
};

registerConnector(imanageConnector);
