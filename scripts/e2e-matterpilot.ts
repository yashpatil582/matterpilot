/**
 * Workspace-scoped end-to-end smoke for MatterPilot.
 *
 * Exercises both packs on the same WorkflowPack engine and asserts the
 * tenancy invariant after: every row inserted by the engine carries a
 * non-null workspace_id. A single NULL row fails the run.
 *
 *   1. Ensure default workspace + default member exist (idempotent).
 *   2. Create a fresh "e2e-…" matter so other runs don't collide.
 *   3. Pack 1 (court-notice): runWorkflow on a notice fixture.
 *   4. Pack 2 (contract-review): runWorkflow on a contract fixture.
 *   5. Best-effort RAG index the contract (no-ops without OPENAI_API_KEY).
 *   6. Tenancy audit: count NULL workspace_id rows across audit_events,
 *      documents, contract_clauses, notices, tasks — must all be 0.
 *
 * Requires: DATABASE_URL + GROQ_API_KEY. OPENAI_API_KEY optional (RAG
 * indexing falls back to skipped_disabled cleanly).
 *
 * Run: `pnpm e2e:matterpilot`
 */

import './_loadenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { runWorkflow } from '../src/lib/workflow/engine';
import { courtNoticePack } from '../src/lib/packs/court-notice';
import { contractReviewPack } from '../src/lib/packs/contract-review';
import { indexDocument } from '../src/lib/rag/index';
import { DEFAULT_WORKSPACE_ID, DEFAULT_REVIEW_THRESHOLD } from '../src/lib/workflow/default-ctx';
import type { PackContext } from '../src/lib/workflow/types';

const ACTOR = 'e2e@matterpilot.dev';
const NOTICE_FIXTURE = '341-meeting-legit';
const CONTRACT_FIXTURE = 'msa-vendor-friendly';
const CONTRACT_PLAYBOOK = 'msa';

type Step =
  | { name: string; status: 'pass'; detail: string }
  | { name: string; status: 'fail'; detail: string };

const steps: Step[] = [];

function pass(name: string, detail: string): void {
  steps.push({ name, status: 'pass', detail });
  console.log(`  ✓ ${name} — ${detail}`);
}

function fail(name: string, detail: string): void {
  steps.push({ name, status: 'fail', detail });
  console.error(`  ✗ ${name} — ${detail}`);
}

async function ensureDefaultMember(): Promise<void> {
  await db
    .insert(schema.workspaceMembers)
    .values({
      workspaceId: DEFAULT_WORKSPACE_ID,
      email: ACTOR,
      name: 'E2E Bot',
      role: 'admin',
    })
    .onConflictDoNothing();
}

async function createE2eMatter(): Promise<{ id: string; name: string }> {
  const name = `E2E test matter — ${new Date().toISOString()}`;
  const [row] = await db
    .insert(schema.matters)
    .values({
      workspaceId: DEFAULT_WORKSPACE_ID,
      name,
      clientName: 'E2E Client',
      status: 'open',
      retentionPolicy: '7y',
      legalHold: false,
    })
    .returning({ id: schema.matters.id, name: schema.matters.name });
  return { id: row.id, name: row.name };
}

function readFixture(dir: string, stem: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', dir, `${stem}.txt`), 'utf8');
}

function buildCtx(matterId: string): PackContext {
  return {
    workspaceId: DEFAULT_WORKSPACE_ID,
    matterId,
    actor: ACTOR,
    reviewThreshold: DEFAULT_REVIEW_THRESHOLD,
  };
}

async function runPack1(matterId: string): Promise<string> {
  const text = readFixture('notices', NOTICE_FIXTURE);
  const ctx = buildCtx(matterId);
  const outcome = await runWorkflow(
    courtNoticePack,
    {
      text,
      rawFileUrl: `e2e://notices/${NOTICE_FIXTURE}.txt`,
      senderEmail: null,
    },
    ctx,
  );
  pass(
    'pack1.ingest',
    `notice ${outcome.noticeId.slice(0, 8)} status=${outcome.status} confidence=${
      outcome.confidence != null ? outcome.confidence.toFixed(2) : 'n/a'
    }`,
  );
  return outcome.noticeId;
}

async function runPack2(matterId: string): Promise<string> {
  const text = readFixture('contracts', CONTRACT_FIXTURE);
  const ctx = buildCtx(matterId);
  const outcome = await runWorkflow(
    contractReviewPack,
    {
      text,
      rawFileUrl: `e2e://contracts/${CONTRACT_FIXTURE}.txt`,
      fileName: `${CONTRACT_FIXTURE}.txt`,
      playbookId: CONTRACT_PLAYBOOK,
      matterId,
    },
    ctx,
  );
  pass(
    'pack2.review',
    `document ${outcome.documentId.slice(0, 8)} status=${outcome.reviewStatus} clauses=${outcome.clauseCount} flagged=${outcome.flaggedClauseCount}`,
  );

  const ragResult = await indexDocument({
    workspaceId: DEFAULT_WORKSPACE_ID,
    matterId,
    documentId: outcome.documentId,
    text,
  });
  pass(
    'pack2.rag',
    `${ragResult.status}${ragResult.status === 'indexed' ? ` (${ragResult.chunkCount} chunks)` : ''}`,
  );

  return outcome.documentId;
}

type CountTable = {
  audit_events: typeof schema.auditEvents;
  documents: typeof schema.documents;
  contract_clauses: typeof schema.contractClauses;
  notices: typeof schema.notices;
  tasks: typeof schema.tasks;
};
const TABLES: CountTable = {
  audit_events: schema.auditEvents,
  documents: schema.documents,
  contract_clauses: schema.contractClauses,
  notices: schema.notices,
  tasks: schema.tasks,
};

async function assertNoTenancyNulls(): Promise<void> {
  for (const [label, table] of Object.entries(TABLES) as Array<
    [keyof CountTable, CountTable[keyof CountTable]]
  >) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(isNull(table.workspaceId));
    const nullCount = row?.count ?? 0;
    if (nullCount === 0) {
      pass(`tenancy.${label}`, '0 rows with NULL workspace_id');
    } else {
      fail(`tenancy.${label}`, `${nullCount} row(s) with NULL workspace_id`);
    }
  }
}

async function assertMatterScopedRows(matterId: string): Promise<void> {
  // Confirm the rows the workflow engine wrote in THIS run are reachable
  // by (workspaceId, matterId). Any miss means a foreign key was dropped
  // somewhere upstream.
  const [docs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(schema.documents.matterId, matterId),
      ),
    );
  if ((docs?.count ?? 0) >= 1) {
    pass('matter-scope.documents', `${docs.count} document(s) linked to e2e matter`);
  } else {
    fail('matter-scope.documents', 'no documents linked to e2e matter');
  }

  const [clauses] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.contractClauses)
    .where(
      and(
        eq(schema.contractClauses.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(schema.contractClauses.matterId, matterId),
      ),
    );
  if ((clauses?.count ?? 0) >= 1) {
    pass('matter-scope.contract_clauses', `${clauses.count} clause(s) linked to e2e matter`);
  } else {
    fail('matter-scope.contract_clauses', 'no clauses linked to e2e matter');
  }

  const [audits] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.workspaceId, DEFAULT_WORKSPACE_ID));
  pass('matter-scope.audit_events', `${audits.count} workspace-scoped audit event(s)`);
}

async function main(): Promise<void> {
  console.log('matterpilot e2e — start');
  console.log(`  workspace: ${DEFAULT_WORKSPACE_ID}`);
  console.log(`  actor:     ${ACTOR}`);

  await ensureDefaultMember();
  pass('setup.member', `${ACTOR} ensured`);

  const matter = await createE2eMatter();
  pass('setup.matter', `${matter.id.slice(0, 8)} (${matter.name})`);

  console.log('\nPack 1 — court-notice');
  await runPack1(matter.id);

  console.log('\nPack 2 — contract-review');
  await runPack2(matter.id);

  console.log('\nMatter-scope checks');
  await assertMatterScopedRows(matter.id);

  console.log('\nTenancy invariant: no NULL workspace_id anywhere');
  await assertNoTenancyNulls();

  const failures = steps.filter((s) => s.status === 'fail');
  console.log(`\nmatterpilot e2e — ${failures.length === 0 ? 'OK' : 'FAIL'}`);
  console.log(`  ${steps.length} step(s) · ${failures.length} failure(s)`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('e2e fatal:', err);
  process.exit(1);
});
