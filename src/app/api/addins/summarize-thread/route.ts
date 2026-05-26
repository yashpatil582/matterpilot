import { db, schema } from '@/db';
import { summariseThreadLlm } from '@/lib/addins/summarize';
import {
  corsPreflight,
  jsonResponse,
  withAddinAuth,
} from '@/lib/addins/auth';

export const OPTIONS = corsPreflight;

export const POST = withAddinAuth(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as
    | { subject?: string; body?: string }
    | null;
  if (!body || typeof body.body !== 'string') {
    return jsonResponse({ error: 'Body required: { subject, body }' }, 400);
  }
  const subject = (body.subject ?? '').slice(0, 500);
  const threadBody = body.body.slice(0, 32000);

  const llm = await summariseThreadLlm({ subject, body: threadBody });

  // Audit the call against the workspace so a firm admin can see what the
  // Outlook add-in is doing on each user's behalf. No entity yet (the thread
  // hasn't been filed) — use a synthetic entity id derived from the prompt
  // hash so duplicate calls don't pile up identical rows.
  await db.insert(schema.auditEvents).values({
    workspaceId: ctx.workspaceId,
    entity: 'addin_thread',
    entityId: crypto.randomUUID(),
    actor: ctx.userEmail,
    action: 'summarised_thread',
    after: {
      subject,
      summary: llm.data.summary,
      deadlineCount: llm.data.deadlines.length,
      partyCount: llm.data.parties.length,
      matterRelevance: llm.data.matterRelevance,
      model: llm.model,
      durationMs: llm.durationMs,
      inputTokens: llm.usage.inputTokens,
      outputTokens: llm.usage.outputTokens,
    },
  });

  return jsonResponse({
    summary: llm.data.summary,
    deadlines: llm.data.deadlines,
    parties: llm.data.parties,
    matterRelevance: llm.data.matterRelevance,
  });
});
