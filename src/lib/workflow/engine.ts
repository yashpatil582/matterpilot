/**
 * Workflow engine.
 *
 * Drives the four-stage pipeline: deterministic → (short-circuit | LLM + persist).
 * Owns audit writes and workspace scoping; packs own everything else.
 */

import { db, schema } from '@/db';
import type { AuditPayload, PackContext, WorkflowPack } from './types';

export async function runWorkflow<Input, LlmData, Outcome>(
  pack: WorkflowPack<Input, LlmData, Outcome>,
  input: Input,
  ctx: PackContext,
): Promise<Outcome> {
  const det = await pack.deterministic(input);

  if (det.kind === 'short_circuit') {
    const { outcome, audit } = await pack.persistShortCircuit({ ctx, input, det });
    await writeAudit(ctx, audit);
    return outcome;
  }

  const llm = await pack.llm(input, det);
  const overallConfidence = pack.aggregateConfidence(llm, det);
  const { outcome, audit } = await pack.persist({ ctx, input, det, llm, overallConfidence });
  await writeAudit(ctx, audit);
  return outcome;
}

async function writeAudit(ctx: PackContext, payload: AuditPayload) {
  await db.insert(schema.auditEvents).values({
    workspaceId: ctx.workspaceId,
    entity: payload.entity,
    entityId: payload.entityId,
    actor: ctx.actor,
    action: payload.action,
    after: payload.after,
  });
}
