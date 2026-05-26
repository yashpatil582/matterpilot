/**
 * Connector SDK — interface every external document-store adapter implements.
 *
 * The four real adapters (sharepoint, imanage, netdocs, local-mock) are
 * mocked in this repo since the candidate project cannot provision a live
 * M365 tenant or paid law-firm-vault sandbox. Each adapter ships:
 *
 *   1. A working implementation of this interface returning the same
 *      response shapes the real vendor APIs return.
 *   2. `/* REAL: ... *​/` comments on every mocked call citing the actual
 *      endpoint + scopes the production code path would hit.
 *   3. A README documenting the OAuth / SAML / API-key flow assumed by the
 *      adapter, so a reviewer can audit fidelity against vendor docs.
 *
 * The shape mirrors a deployment engineer's reasoning: one contract that
 * every firm vault must satisfy, then a thin adapter per vault.
 */

export type ConnectorAuthMode =
  | 'oauth2-pkce'
  | 'oauth2-obo'
  | 'saml-then-oauth'
  | 'apikey'
  | 'mock';

export type ConnectorCtx = {
  workspaceId: string;
  userEmail: string;
};

export type ConnectorSession = {
  connectorId: string;
  authMode: ConnectorAuthMode;
  /** Bearer token to send on subsequent API calls. Synthetic in mocks. */
  accessToken: string;
  /** When the access token expires. Mocks use 1 hour. */
  expiresAt: Date;
  /** Per-adapter context (tenant id, site id, library id, base URL, ...). */
  context: Record<string, unknown>;
};

export type FolderRef = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
};

export type DocumentRef = {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  modifiedAt: Date;
  folderId: string;
};

export type FetchedDocument = {
  bytes: Uint8Array;
  mime: string;
  name: string;
};

export type PushTarget = {
  folderRef: string;
  name: string;
  bytes: Uint8Array;
  mime?: string;
};

export interface Connector {
  id: string;
  displayName: string;
  authMode: ConnectorAuthMode;
  /** One-line human-readable description for admin UI + audit log. */
  describe(): string;
  authenticate(ctx: ConnectorCtx): Promise<ConnectorSession>;
  /** List child folders of a parent (root if not provided). */
  listFolders(session: ConnectorSession, parentRef?: string): Promise<FolderRef[]>;
  /** List documents directly under the given folder. */
  listDocuments(session: ConnectorSession, folderRef: string): Promise<DocumentRef[]>;
  fetchDocument(session: ConnectorSession, ref: string): Promise<FetchedDocument>;
  pushDocument(session: ConnectorSession, target: PushTarget): Promise<DocumentRef>;
}
