/**
 * Run before `pnpm db:push` whenever the schema introduces a new Postgres
 * extension. Today: the pgvector extension required by the documentChunks
 * embedding column.
 *
 * Drizzle Kit doesn't expose pre-push hooks, so we run the extension
 * statements here and rely on `pnpm db:bootstrap && pnpm db:push` being
 * the canonical setup chain in DEPLOY.md.
 *
 * Idempotent: CREATE EXTENSION IF NOT EXISTS is safe to re-run.
 */

import './_loadenv';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Enabling Postgres extensions...');
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  console.log('  ✓ vector (pgvector)');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
