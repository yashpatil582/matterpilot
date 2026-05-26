/**
 * local-mock connector — fully working in-memory adapter.
 *
 * The canonical reference implementation of the Connector interface.
 * Holds a hierarchical folder/file tree in memory, so server actions can
 * exercise the full surface without ever leaving the process. Useful for:
 *
 *   - smoke-testing the SDK contract (scripts/connectors-smoke.ts)
 *   - local dev when no real vault is reachable
 *   - the demo recording (matter detail "Browse" lands here by default)
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

type StoredFolder = { id: string; name: string; path: string; parentId: string | null };
type StoredDoc = Omit<DocumentRef, 'bytes'> & { payload: Uint8Array };

const FOLDERS: StoredFolder[] = [
  { id: 'root', name: 'Root', path: '/', parentId: null },
  { id: 'matters', name: 'Matters', path: '/Matters', parentId: 'root' },
  { id: 'acme-v-smith', name: 'Acme v. Smith', path: '/Matters/Acme v. Smith', parentId: 'matters' },
  { id: 'precedents', name: 'Precedents', path: '/Precedents', parentId: 'root' },
];

const DOCS: StoredDoc[] = [
  {
    id: 'doc-acme-prior-nda',
    name: 'Prior NDA — Acme 2024.pdf',
    mimeType: 'application/pdf',
    payload: new TextEncoder().encode('SAMPLE — Acme NDA 2024.\nMutual confidentiality; 3-year term; NY law.'),
    modifiedAt: new Date('2025-08-12T15:30:00Z'),
    folderId: 'acme-v-smith',
  },
  {
    id: 'doc-precedent-msa',
    name: 'Firm MSA Template v3.pdf',
    mimeType: 'application/pdf',
    payload: new TextEncoder().encode('SAMPLE — Firm MSA template. Liability capped at fees paid.'),
    modifiedAt: new Date('2025-11-03T09:00:00Z'),
    folderId: 'precedents',
  },
];

function toRef(d: StoredDoc): DocumentRef {
  return {
    id: d.id,
    name: d.name,
    mimeType: d.mimeType,
    bytes: d.payload.byteLength,
    modifiedAt: d.modifiedAt,
    folderId: d.folderId,
  };
}

export const localMockConnector: Connector = {
  id: 'local-mock',
  displayName: 'Local Mock Vault',
  authMode: 'mock',

  describe(): string {
    return 'In-process fixture vault — for development and demo recording.';
  },

  async authenticate(ctx: ConnectorCtx): Promise<ConnectorSession> {
    return {
      connectorId: 'local-mock',
      authMode: 'mock',
      accessToken: `mock-${ctx.workspaceId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context: { workspaceId: ctx.workspaceId, userEmail: ctx.userEmail },
    };
  },

  async listFolders(_session, parentRef): Promise<FolderRef[]> {
    const parent = parentRef ?? 'root';
    return FOLDERS.filter((f) => f.parentId === parent).map(({ id, name, path, parentId }) => ({
      id,
      name,
      path,
      parentId,
    }));
  },

  async listDocuments(_session, folderRef): Promise<DocumentRef[]> {
    return DOCS.filter((d) => d.folderId === folderRef).map(toRef);
  },

  async fetchDocument(_session, ref): Promise<FetchedDocument> {
    const doc = DOCS.find((d) => d.id === ref);
    if (!doc) throw new Error(`local-mock: document not found: ${ref}`);
    return { bytes: doc.payload, mime: doc.mimeType, name: doc.name };
  },

  async pushDocument(session, target: PushTarget): Promise<DocumentRef> {
    const folder = FOLDERS.find((f) => f.id === target.folderRef);
    if (!folder) throw new Error(`local-mock: folder not found: ${target.folderRef}`);
    const id = `doc-${session.context.workspaceId}-${Date.now()}`;
    const doc: StoredDoc = {
      id,
      name: target.name,
      mimeType: target.mime ?? 'application/octet-stream',
      payload: target.bytes,
      modifiedAt: new Date(),
      folderId: target.folderRef,
    };
    DOCS.push(doc);
    return toRef(doc);
  },
};

registerConnector(localMockConnector);
