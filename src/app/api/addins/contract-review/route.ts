import { db, schema } from '@/db';
import { analyseContractLlm } from '@/lib/packs/contract-review/extract';
import { getPlaybook } from '@/lib/packs/contract-review/playbooks';
import {
  corsPreflight,
  jsonResponse,
  withAddinAuth,
} from '@/lib/addins/auth';

export const OPTIONS = corsPreflight;

/**
 * Word add-in clause-review endpoint.
 *
 * Returns clause diff instructions the Word client iterates inside
 * Word.run(async (context) => { ... }) with
 * `context.document.changeTrackingMode = "TrackAll"`. For each diff:
 *
 *   const body = context.document.body;
 *   const ranges = body.search(diff.anchorText, { matchCase: false });
 *   ranges.load('items');
 *   await context.sync();
 *   if (ranges.items.length) {
 *     ranges.items[0].insertText(diff.newText, 'Replace');
 *   }
 *   await context.sync();
 *
 * Word records each insertion as a tracked change. The attorney accepts or
 * rejects them via the standard Review ribbon. Diffs whose anchor isn't
 * found return as `not_found` on the client so the task pane can surface
 * what was skipped.
 */
export const POST = withAddinAuth(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as
    | { documentText?: string; playbookId?: string; matterId?: string | null }
    | null;
  if (!body || typeof body.documentText !== 'string' || typeof body.playbookId !== 'string') {
    return jsonResponse(
      { error: 'Body required: { documentText, playbookId, matterId? }' },
      400,
    );
  }
  const playbook = getPlaybook(body.playbookId);
  if (!playbook) {
    return jsonResponse({ error: `Unknown playbook: ${body.playbookId}` }, 400);
  }
  if (body.documentText.trim().length < 200) {
    return jsonResponse({ error: 'Document too short for meaningful review.' }, 400);
  }

  const llm = await analyseContractLlm({
    text: body.documentText,
    playbook,
  });

  // Convert clauses into the Word-shaped diff instructions. Each diff carries
  // an anchorText (the original verbatim clause text — the same string the
  // model returned) the client can pass to body.search(). The redline
  // suggestion (if any) is the newText to insertText('Replace') with.
  const clauseDiffs = llm.data.clauses
    .filter((c) => c.redlineSuggestion && c.redlineSuggestion.trim().length > 0)
    .map((c) => ({
      ordinal: c.ordinal,
      clauseType: c.clauseType,
      riskLevel: c.riskLevel,
      matchedRuleId: c.matchedPlaybookRuleId,
      anchorText: c.text,
      action: 'replace' as const,
      newText: c.redlineSuggestion ?? '',
      reason: c.reasoning,
      confidence: c.confidence,
    }));

  await db.insert(schema.auditEvents).values({
    workspaceId: ctx.workspaceId,
    entity: 'addin_contract',
    entityId: crypto.randomUUID(),
    actor: ctx.userEmail,
    action: 'reviewed_contract_from_word',
    after: {
      playbookId: playbook.id,
      clauseCount: llm.data.clauses.length,
      diffCount: clauseDiffs.length,
      summary: llm.data.summary,
      matterId: body.matterId ?? null,
      model: llm.model,
      durationMs: llm.durationMs,
      inputTokens: llm.usage.inputTokens,
      outputTokens: llm.usage.outputTokens,
    },
  });

  return jsonResponse({
    summary: llm.data.summary,
    playbookName: playbook.name,
    clauseCount: llm.data.clauses.length,
    clauseDiffs,
  });
});
