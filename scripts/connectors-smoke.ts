/**
 * Connector SDK smoke test.
 *
 * Imports every adapter (which self-registers via registerConnector), then
 * walks each registered connector through the full Connector interface:
 *
 *   describe → authenticate → listFolders → drill to a folder with docs →
 *   listDocuments → fetchDocument → pushDocument.
 *
 * Verifies the shapes returned are non-empty / well-formed. Exits non-zero
 * on the first failure. Used as a guardrail when the interface evolves so
 * a deferred adapter doesn't quietly drift out of contract.
 *
 * Run: `pnpm connectors:smoke`
 */

import './_loadenv';

// Side-effect imports — each adapter calls registerConnector() at load.
import '../src/lib/connectors/adapters/local-mock';
import '../src/lib/connectors/adapters/sharepoint';
import '../src/lib/connectors/adapters/imanage';
import '../src/lib/connectors/adapters/netdocs';

import {
  listConnectors,
} from '../src/lib/connectors/registry';
import type { ConnectorSession, FolderRef } from '../src/lib/connectors/types';

const SMOKE_CTX = {
  workspaceId: '00000000-0000-0000-0000-000000000001',
  userEmail: 'smoke@matterpilot.dev',
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function findFolderWithDocs(
  connector: ReturnType<typeof listConnectors>[number],
  session: ConnectorSession,
): Promise<FolderRef | null> {
  const queue: (string | undefined)[] = [undefined];
  const seen = new Set<string | undefined>();
  while (queue.length > 0) {
    const parent = queue.shift();
    if (seen.has(parent)) continue;
    seen.add(parent);
    const folders = await connector.listFolders(session, parent);
    for (const folder of folders) {
      const docs = await connector.listDocuments(session, folder.id);
      if (docs.length > 0) return folder;
      queue.push(folder.id);
    }
  }
  return null;
}

async function smokeOne(
  connector: ReturnType<typeof listConnectors>[number],
): Promise<void> {
  const id = connector.id;
  console.log(`\n--- ${id} (${connector.authMode}) ---`);

  const description = connector.describe();
  assert(typeof description === 'string' && description.length > 0, `${id}: describe() returned empty`);
  console.log(`  describe: ${description}`);

  const session = await connector.authenticate(SMOKE_CTX);
  assert(session.connectorId === id, `${id}: session.connectorId mismatch (${session.connectorId})`);
  assert(typeof session.accessToken === 'string' && session.accessToken.length > 0, `${id}: empty accessToken`);
  assert(session.expiresAt instanceof Date && session.expiresAt > new Date(), `${id}: expiresAt not in future`);
  console.log(`  authenticate: ok (token \`${session.accessToken.slice(0, 32)}…\`)`);

  const folder = await findFolderWithDocs(connector, session);
  assert(folder, `${id}: no folder with documents reachable from root`);
  console.log(`  drilled to folder: ${folder.path}`);

  const docs = await connector.listDocuments(session, folder.id);
  assert(docs.length > 0, `${id}: listDocuments returned empty for ${folder.id}`);
  for (const d of docs) {
    assert(typeof d.id === 'string' && d.id.length > 0, `${id}: doc missing id`);
    assert(typeof d.name === 'string' && d.name.length > 0, `${id}: doc missing name`);
    assert(d.modifiedAt instanceof Date, `${id}: doc.modifiedAt not a Date`);
  }
  console.log(`  listDocuments: ${docs.length} doc(s)`);

  const first = docs[0];
  const fetched = await connector.fetchDocument(session, first.id);
  assert(fetched.bytes instanceof Uint8Array && fetched.bytes.byteLength > 0, `${id}: fetchDocument empty bytes`);
  assert(fetched.mime === first.mimeType, `${id}: fetch mime mismatch (${fetched.mime})`);
  assert(fetched.name === first.name, `${id}: fetch name mismatch (${fetched.name})`);
  console.log(`  fetchDocument: ${fetched.bytes.byteLength} bytes (${fetched.mime})`);

  const pushed = await connector.pushDocument(session, {
    folderRef: folder.id,
    name: `smoke-${Date.now()}.txt`,
    bytes: new TextEncoder().encode('connector smoke test payload'),
    mime: 'text/plain',
  });
  assert(typeof pushed.id === 'string' && pushed.id.length > 0, `${id}: pushDocument returned no id`);
  assert(pushed.folderId === folder.id, `${id}: pushDocument folderId drift`);
  console.log(`  pushDocument: ok (new id ${pushed.id})`);
}

async function main() {
  const connectors = listConnectors();
  console.log(`Found ${connectors.length} registered connector(s): ${connectors.map((c) => c.id).join(', ')}`);
  let failed = 0;
  for (const c of connectors) {
    try {
      await smokeOne(c);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed > 0) {
    console.error(`\nconnectors:smoke — FAIL (${failed}/${connectors.length})`);
    process.exit(1);
  }
  console.log(`\nconnectors:smoke — OK (${connectors.length}/${connectors.length})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
