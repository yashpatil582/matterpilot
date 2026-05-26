/**
 * SharePoint adapter — Microsoft Graph (mocked).
 *
 * Real production code would call Microsoft Graph endpoints with a
 * delegated access token obtained via OAuth 2.0 On-Behalf-Of (OBO).
 * Every mocked response below is marked with a `REAL:` comment pointing
 * at the exact Graph endpoint + scopes the production call would use.
 *
 * grep -rn "REAL:" src/lib/connectors/adapters/sharepoint/ to audit
 * fidelity against vendor docs.
 *
 * See ./README.md for the full OAuth + Graph flow this mock simulates.
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

const MOCK_SITE_ID = 'mp.sharepoint.com,11111111-aaaa-bbbb-cccc-222222222222,33333333-dddd-eeee-ffff-444444444444';
const MOCK_DRIVE_ID = 'b!ABCDEFG_mockDriveIdForMatterPilotDemoEnvironment-1234567890';

const MOCK_FOLDERS: FolderRef[] = [
  { id: 'root', name: 'Documents', path: '/Documents', parentId: null },
  { id: '01ACME', name: 'Acme v. Smith', path: '/Documents/Acme v. Smith', parentId: 'root' },
  { id: '01ACME_CONTRACTS', name: 'Contracts', path: '/Documents/Acme v. Smith/Contracts', parentId: '01ACME' },
  { id: '01ACME_PLEADINGS', name: 'Pleadings', path: '/Documents/Acme v. Smith/Pleadings', parentId: '01ACME' },
  { id: '01FIRM', name: 'Firm Precedents', path: '/Documents/Firm Precedents', parentId: 'root' },
];

type StoredDoc = Omit<DocumentRef, 'bytes'> & { payload: Uint8Array };

const MOCK_DOCS: StoredDoc[] = [
  {
    id: 'g-01ACME-1',
    name: 'Acme Master Services Agreement v4.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    payload: new TextEncoder().encode('Mock binary content for Acme MSA v4'),
    modifiedAt: new Date('2026-01-22T14:15:00Z'),
    folderId: '01ACME_CONTRACTS',
  },
  {
    id: 'g-01ACME-2',
    name: 'Smith Counter-Proposal Redlines.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    payload: new TextEncoder().encode('Mock content for Smith counter-proposal'),
    modifiedAt: new Date('2026-02-04T09:42:00Z'),
    folderId: '01ACME_CONTRACTS',
  },
  {
    id: 'g-01FIRM-1',
    name: 'Mutual NDA Template - Firm Standard.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    payload: new TextEncoder().encode('Mock firm-standard mutual NDA template'),
    modifiedAt: new Date('2025-09-12T16:00:00Z'),
    folderId: '01FIRM',
  },
];

function toRef(d: StoredDoc): DocumentRef {
  const { id, name, mimeType, payload, modifiedAt, folderId } = d;
  return { id, name, mimeType, bytes: payload.byteLength, modifiedAt, folderId };
}

export const sharepointConnector: Connector = {
  id: 'sharepoint',
  displayName: 'Microsoft SharePoint (Graph)',
  authMode: 'oauth2-obo',

  describe(): string {
    return 'Microsoft 365 SharePoint document libraries via Microsoft Graph. OAuth 2.0 OBO with delegated scopes Sites.Read.All + Files.ReadWrite.All. (Mocked.)';
  },

  async authenticate(ctx: ConnectorCtx): Promise<ConnectorSession> {
    /* REAL:
     *   POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
     *   grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
     *   client_id={app-client-id}
     *   client_secret={app-client-secret}
     *   assertion={user-id-token-from-Auth.js-session}
     *   scope=https://graph.microsoft.com/Sites.Read.All
     *         https://graph.microsoft.com/Files.ReadWrite.All offline_access
     *   requested_token_use=on_behalf_of
     *
     * Production flow: the server (this adapter) exchanges the user's
     * Entra ID token from the Auth.js session for a Graph access token
     * scoped to that user. No app-only token, so SharePoint permissions
     * remain the user's own — sealing matter walls.
     */
    return {
      connectorId: 'sharepoint',
      authMode: 'oauth2-obo',
      accessToken: `mock-graph-token-for-${ctx.userEmail}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context: {
        siteId: MOCK_SITE_ID,
        driveId: MOCK_DRIVE_ID,
        userEmail: ctx.userEmail,
      },
    };
  },

  async listFolders(session, parentRef): Promise<FolderRef[]> {
    /* REAL:
     *   GET https://graph.microsoft.com/v1.0/sites/{siteId}/drives/{driveId}/items/{parent}/children
     *     ?$filter=folder ne null
     *     &$select=id,name,parentReference,folder
     *   Authorization: Bearer {session.accessToken}
     *
     * Pagination via @odata.nextLink (not modeled in this mock).
     */
    void session;
    const parent = parentRef ?? 'root';
    return MOCK_FOLDERS.filter((f) => f.parentId === parent);
  },

  async listDocuments(session, folderRef): Promise<DocumentRef[]> {
    /* REAL:
     *   GET https://graph.microsoft.com/v1.0/sites/{siteId}/drives/{driveId}/items/{folderRef}/children
     *     ?$filter=file ne null
     *     &$select=id,name,file,size,lastModifiedDateTime,parentReference
     *   Authorization: Bearer {session.accessToken}
     */
    void session;
    return MOCK_DOCS.filter((d) => d.folderId === folderRef).map(toRef);
  },

  async fetchDocument(session, ref): Promise<FetchedDocument> {
    /* REAL:
     *   GET https://graph.microsoft.com/v1.0/sites/{siteId}/drives/{driveId}/items/{ref}/content
     *   Authorization: Bearer {session.accessToken}
     *
     * Returns the binary content; for SharePoint Office files prefer
     * /items/{ref}/content?format=pdf to get a PDF rendering for review.
     */
    void session;
    const doc = MOCK_DOCS.find((d) => d.id === ref);
    if (!doc) throw new Error(`sharepoint: item not found: ${ref}`);
    return { bytes: doc.payload, mime: doc.mimeType, name: doc.name };
  },

  async pushDocument(session, target: PushTarget): Promise<DocumentRef> {
    /* REAL:
     *   PUT https://graph.microsoft.com/v1.0/sites/{siteId}/drives/{driveId}/items/{folderRef}:/{name}:/content
     *   Authorization: Bearer {session.accessToken}
     *   Content-Type: {target.mime ?? 'application/octet-stream'}
     *   {raw bytes}
     *
     * For files >4 MB use the upload session endpoint:
     *   POST /items/{folderRef}:/{name}:/createUploadSession
     *   then PUT byte ranges to the returned uploadUrl.
     */
    const id = `g-${session.context.workspaceId ?? 'ws'}-${Date.now()}`;
    const doc: StoredDoc = {
      id,
      name: target.name,
      mimeType: target.mime ?? 'application/octet-stream',
      payload: target.bytes,
      modifiedAt: new Date(),
      folderId: target.folderRef,
    };
    MOCK_DOCS.push(doc);
    return toRef(doc);
  },
};

registerConnector(sharepointConnector);
