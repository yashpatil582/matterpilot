/**
 * NetDocuments adapter — ndAuth + REST (mocked).
 *
 * Real production code would call the NetDocs API at
 * `https://api.{region}.netdocuments.com/v1/` with a Bearer access token
 * obtained via SAML-then-OAuth (ndAuth). Every mocked call carries a
 * `REAL:` comment naming the production endpoint. See ./README.md for the
 * full SAML + OAuth bridge flow this mock simulates.
 *
 * NetDocs serves 7,000+ law firms and legal departments per their public
 * materials — the second integration most likely to matter at deployment
 * time after iManage.
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

const MOCK_CABINET_ID = 'NG-CAB-MP-001';
const MOCK_BASE_URL = 'https://api.eu.netdocuments.com/v1';

const MOCK_FOLDERS: FolderRef[] = [
  { id: 'ND-WS-2027-ACME', name: 'Acme v. Smith (2027-ACME)', path: '/Acme v. Smith', parentId: null },
  { id: 'ND-FOLDER-CONTRACTS', name: 'Contracts', path: '/Acme v. Smith/Contracts', parentId: 'ND-WS-2027-ACME' },
  { id: 'ND-FOLDER-CORRESPONDENCE', name: 'Correspondence', path: '/Acme v. Smith/Correspondence', parentId: 'ND-WS-2027-ACME' },
  { id: 'ND-FOLDER-WORKPRODUCT', name: 'Work Product', path: '/Acme v. Smith/Work Product', parentId: 'ND-WS-2027-ACME' },
];

type StoredDoc = Omit<DocumentRef, 'bytes'> & { payload: Uint8Array };

const MOCK_DOCS: StoredDoc[] = [
  {
    id: 'ND-DOC-9C8F1A0',
    name: 'Acme Reseller Agreement - Final Executed.pdf',
    mimeType: 'application/pdf',
    payload: new TextEncoder().encode('Mock NetDocs file — Acme Reseller Agreement'),
    modifiedAt: new Date('2026-02-19T13:05:00Z'),
    folderId: 'ND-FOLDER-CONTRACTS',
  },
  {
    id: 'ND-DOC-3B7E2C8',
    name: 'Outside Counsel Memo - Smith Counterclaim.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    payload: new TextEncoder().encode('Mock NetDocs file — Smith Counterclaim memo'),
    modifiedAt: new Date('2026-03-08T16:48:00Z'),
    folderId: 'ND-FOLDER-WORKPRODUCT',
  },
];

function toRef(d: StoredDoc): DocumentRef {
  const { id, name, mimeType, payload, modifiedAt, folderId } = d;
  return { id, name, mimeType, bytes: payload.byteLength, modifiedAt, folderId };
}

export const netdocsConnector: Connector = {
  id: 'netdocs',
  displayName: 'NetDocuments',
  authMode: 'saml-then-oauth',

  describe(): string {
    return 'NetDocuments cabinets via ndAuth (SAML-then-OAuth) → REST. (Mocked.)';
  },

  async authenticate(ctx: ConnectorCtx): Promise<ConnectorSession> {
    /* REAL:
     *   ndAuth is a SAML-then-OAuth bridge:
     *
     *   1. Browser → GET https://vault.netvoyage.com/neWeb2/ndAuth.aspx
     *        ?Issuer={app-saml-issuer}
     *        &RelayState={state-token}
     *      NetDocs proxies the SAML AuthnRequest to the firm's IdP.
     *
     *   2. IdP returns a SAML assertion to NetDocs, which exchanges it
     *      for an OAuth authorisation code returned to the app's
     *      registered callback as ?code=...&state=...
     *
     *   3. Server exchanges the code for tokens:
     *      POST https://api.{region}.netdocuments.com/v1/OAuth
     *        grant_type=authorization_code
     *        code={auth-code}
     *        redirect_uri={app-callback-url}
     *        client_id={app-client-id}
     *        client_secret={app-client-secret}
     *
     *   The returned access_token is a Bearer for /v1/* calls.
     *   Region (us, eu, au) is firm-specific and embedded in the API host.
     */
    return {
      connectorId: 'netdocs',
      authMode: 'saml-then-oauth',
      accessToken: `mock-netdocs-token-for-${ctx.userEmail}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context: {
        baseUrl: MOCK_BASE_URL,
        cabinetId: MOCK_CABINET_ID,
        userEmail: ctx.userEmail,
      },
    };
  },

  async listFolders(session, parentRef): Promise<FolderRef[]> {
    /* REAL:
     *   When parentRef is omitted (top-level):
     *     GET {baseUrl}/Search/{cabinetId}
     *       ?q=workspace
     *       &fields=name,id,modificationDate
     *
     *   When parentRef points at a workspace or folder:
     *     GET {baseUrl}/Folder/{parentRef}/contents
     *       ?include=folders
     *       &fields=name,id,parentId
     *
     *   Authorization: Bearer {session.accessToken}
     */
    void session;
    return MOCK_FOLDERS.filter((f) => f.parentId === (parentRef ?? null));
  },

  async listDocuments(session, folderRef): Promise<DocumentRef[]> {
    /* REAL:
     *   GET {baseUrl}/Folder/{folderRef}/contents
     *     ?include=documents
     *     &fields=name,id,extension,size,modificationDate,parentId
     *   Authorization: Bearer {session.accessToken}
     */
    void session;
    return MOCK_DOCS.filter((d) => d.folderId === folderRef).map(toRef);
  },

  async fetchDocument(session, ref): Promise<FetchedDocument> {
    /* REAL:
     *   GET {baseUrl}/Document/{ref}
     *     ?download=true
     *   Authorization: Bearer {session.accessToken}
     *
     *   For Office docs, append `?renderType=pdf` to receive a PDF render.
     */
    void session;
    const doc = MOCK_DOCS.find((d) => d.id === ref);
    if (!doc) throw new Error(`netdocs: document not found: ${ref}`);
    return { bytes: doc.payload, mime: doc.mimeType, name: doc.name };
  },

  async pushDocument(session, target: PushTarget): Promise<DocumentRef> {
    /* REAL:
     *   POST {baseUrl}/Document
     *   Content-Type: multipart/form-data
     *   Authorization: Bearer {session.accessToken}
     *
     *   Multipart fields:
     *     - profile (JSON: name, location=target.folderRef, custom1..N)
     *     - content (file body)
     */
    const id = `ND-DOC-${Math.random().toString(16).slice(2, 9).toUpperCase()}`;
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

registerConnector(netdocsConnector);
