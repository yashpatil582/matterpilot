/**
 * Seed default workspace + tenancy backfill + sender policies.
 *
 * Idempotent — safe to run multiple times. Run after `pnpm db:push`.
 *
 *   1. Ensures the default workspace row exists (stable UUID).
 *   2. Backfills `workspace_id` on every existing tenant row where it is NULL.
 *   3. Creates one matter per case (idempotent on `case_id`) and backfills
 *      `matter_id` on notices and tasks via their `case_id`.
 *   4. Seeds the default sender-policy rules into the default workspace.
 *
 * After this runs, every column added in the MatterPilot migration is
 * populated and can be flipped to NOT NULL in a follow-up migration.
 *
 * Run: `pnpm db:seed`
 */
import './_loadenv';
import { db, schema } from '../src/db';
import { sql } from 'drizzle-orm';

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_WORKSPACE_SLUG = 'default';
const DEFAULT_WORKSPACE_NAME = 'Default Workspace';

const ALLOW = [
  { domain: 'uscourts.gov', notes: 'U.S. Courts CM-ECF system (all districts)' },
  { domain: 'pacer.gov', notes: 'PACER public access' },
  { domain: 'bnc-mail.com', notes: 'Bankruptcy Noticing Center' },
  { domain: 'noticingcenter.com', notes: 'Bankruptcy Noticing Center' },
  { domain: 'zoomgov.com', notes: 'FedRAMP Zoom for Government — virtual hearings' },
];

const BLOCK = [
  { domain: 'uscourts.com', notes: 'phishing: uscourts on non-gov TLD' },
  { domain: 'uscourts.net', notes: 'phishing: uscourts on non-gov TLD' },
  { domain: 'uscoorts.gov', notes: 'phishing: look-alike of uscourts.gov' },
];

async function ensureDefaultWorkspace() {
  await db
    .insert(schema.workspaces)
    .values({
      id: DEFAULT_WORKSPACE_ID,
      slug: DEFAULT_WORKSPACE_SLUG,
      name: DEFAULT_WORKSPACE_NAME,
    })
    .onConflictDoNothing();
}

async function backfillWorkspaceIds() {
  const tables = [
    'cases',
    'notices',
    'parse_runs',
    'extracted_events',
    'tasks',
    'review_decisions',
    'audit_events',
    'sender_policies',
    'workspace_members',
  ];
  for (const t of tables) {
    await db.execute(
      sql.raw(`update ${t} set workspace_id = '${DEFAULT_WORKSPACE_ID}' where workspace_id is null`),
    );
  }
}

async function backfillMatters() {
  // Create one matter per case (idempotent: insert only where no matter yet links to that case).
  await db.execute(sql.raw(`
    insert into matters (workspace_id, case_id, name, client_name, status, retention_policy, legal_hold)
    select
      '${DEFAULT_WORKSPACE_ID}'::uuid,
      c.id,
      coalesce(c.case_number, 'Untitled matter'),
      c.debtor_name,
      'open',
      '7y',
      false
    from cases c
    where not exists (
      select 1 from matters m where m.case_id = c.id
    )
  `));

  // Backfill notices.matter_id via case_id.
  await db.execute(sql.raw(`
    update notices n
    set matter_id = m.id
    from matters m
    where n.case_id = m.case_id
      and n.matter_id is null
  `));

  // Backfill tasks.matter_id via case_id.
  await db.execute(sql.raw(`
    update tasks t
    set matter_id = m.id
    from matters m
    where t.case_id = m.case_id
      and t.matter_id is null
  `));
}

async function seedSenderPolicies() {
  let upserted = 0;
  for (const row of ALLOW) {
    await db
      .insert(schema.senderPolicies)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        domain: row.domain,
        trustLevel: 'allow',
        notes: row.notes,
      })
      .onConflictDoNothing();
    upserted++;
  }
  for (const row of BLOCK) {
    await db
      .insert(schema.senderPolicies)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        domain: row.domain,
        trustLevel: 'block',
        notes: row.notes,
      })
      .onConflictDoNothing();
    upserted++;
  }
  return upserted;
}

async function main() {
  await ensureDefaultWorkspace();
  await backfillWorkspaceIds();
  await backfillMatters();
  const upserted = await seedSenderPolicies();

  const [{ count: policyCount }] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from sender_policies`,
  );
  const [{ count: matterCount }] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from matters where workspace_id = ${DEFAULT_WORKSPACE_ID}::uuid`,
  );

  console.log(`workspace ready: ${DEFAULT_WORKSPACE_SLUG} (${DEFAULT_WORKSPACE_ID})`);
  console.log(`matters in default workspace: ${matterCount}`);
  console.log(`seeded ${upserted} sender policy rules; total in DB: ${policyCount}`);
  console.log(
    'note: the parser currently uses the hard-coded lists in src/lib/parsing/sender.ts;\n' +
      '      DB-driven lookup is a planned follow-up (see DESIGN.md).',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
