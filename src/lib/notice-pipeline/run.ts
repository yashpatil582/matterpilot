/**
 * Back-compat entry point for court-notice ingest.
 *
 * Calls the generic workflow engine with Pack 1 and the default workspace
 * context. New code should call `runWorkflow(courtNoticePack, input, ctx)`
 * directly with a context derived from the session — see
 * `src/lib/workflow/default-ctx.ts` for the transitional default.
 */

import { runWorkflow } from '@/lib/workflow/engine';
import { getDefaultPackContext } from '@/lib/workflow/default-ctx';
import { courtNoticePack, type IngestInput, type IngestResult } from '@/lib/packs/court-notice';

export type { IngestInput, IngestResult };

export async function ingestNotice(input: IngestInput): Promise<IngestResult> {
  const ctx = getDefaultPackContext();
  return runWorkflow(courtNoticePack, input, ctx);
}
