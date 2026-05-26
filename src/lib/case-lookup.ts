/**
 * Find or create a Case row for an extracted case number.
 *
 * Day 2 behaviour: exact match on case_number only. Fuzzy debtor-name
 * matching lands later when we have an LLM in the loop.
 *
 * Race-safe via INSERT ... ON CONFLICT — two concurrent ingests for the
 * same new case won't both fail; one inserts, the other reads back the row.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { CaseNumberMatch } from './parsing/case-number';

export async function findOrCreateCase(
  match: CaseNumberMatch,
  workspaceId: string,
): Promise<string> {
  await db
    .insert(schema.cases)
    .values({ workspaceId, caseNumber: match.caseNumber, district: match.district })
    .onConflictDoNothing({ target: schema.cases.caseNumber });

  const [row] = await db
    .select({ id: schema.cases.id })
    .from(schema.cases)
    .where(eq(schema.cases.caseNumber, match.caseNumber))
    .limit(1);

  if (!row) {
    // This should be impossible — we just inserted (or it already existed)
    // — but throw a clear error so the failure mode is obvious in audit logs.
    throw new Error(`findOrCreateCase: ${match.caseNumber} not found after upsert`);
  }
  return row.id;
}
