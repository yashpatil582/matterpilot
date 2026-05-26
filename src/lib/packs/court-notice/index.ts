/**
 * Pack 1 — U.S. bankruptcy court notice intake.
 *
 * Wraps the existing deterministic + LLM logic in `src/lib/parsing/` and
 * `src/lib/notice-pipeline/` behind the generic WorkflowPack interface so
 * the engine treats it identically to Pack 2 (contract review, planned).
 *
 * Domain-specific behaviour kept here:
 *   - "suspicious" short-circuits the LLM and quarantines the notice
 *   - normal path: insert notice + extracted events + parse run, then
 *     auto-create a follow-up task if confidence is high enough
 */

import { db, schema } from '@/db';
import { analyseNotice, type DeterministicResult } from '@/lib/parsing';
import { findOrCreateCase } from '@/lib/case-lookup';
import {
  analyseNoticeLlm,
  aggregateConfidence,
  type AnalyseResult,
} from '@/lib/notice-pipeline/analyse';
import { buildTaskTitle, taskDueDate } from '@/lib/notice-pipeline/task';
import { registerPack } from '@/lib/workflow/registry';
import type {
  DeterministicContinue,
  DeterministicShortCircuit,
  LlmStage,
  PersistResult,
  WorkflowPack,
} from '@/lib/workflow/types';

export type IngestInput = {
  text: string;
  rawFileUrl: string;
  senderEmail?: string | null;
};

export type IngestResult = {
  noticeId: string;
  status: 'received' | 'needs_review' | 'routed' | 'suspicious';
  caseNumber: string | null;
  type: string | null;
  confidence: number | null;
  hearingAt: Date | null;
  deterministicReasons: string[];
};

function parseIso(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDeterministicMeta(analysis: DeterministicResult): Record<string, unknown> {
  return {
    caseNumberMatch: analysis.caseNumber,
    senderDomain: analysis.sender?.domain ?? null,
    senderTrust: analysis.sender?.trust ?? null,
  };
}

export const courtNoticePack: WorkflowPack<IngestInput, AnalyseResult, IngestResult> = {
  id: 'court-notice',
  displayName: 'Court Notice Intake',
  documentKinds: ['bankruptcy-notice'],

  deterministic(input) {
    const analysis = analyseNotice({
      text: input.text,
      senderEmail: input.senderEmail ?? null,
    });
    const meta = toDeterministicMeta(analysis);
    if (analysis.verdict === 'suspicious') {
      return { kind: 'short_circuit', reasons: analysis.reasons, meta };
    }
    return {
      kind: 'continue',
      reasons: analysis.reasons,
      requiresReview: analysis.requiresReview,
      meta,
    };
  },

  async persistShortCircuit({
    ctx,
    input,
    det,
  }: {
    ctx: { workspaceId: string; matterId: string | null; actor: string; reviewThreshold: number };
    input: IngestInput;
    det: DeterministicShortCircuit;
  }): Promise<PersistResult<IngestResult>> {
    const senderDomain = (det.meta.senderDomain as string | null) ?? null;
    const caseMatch = det.meta.caseNumberMatch as DeterministicResult['caseNumber'];
    const caseId = caseMatch ? await findOrCreateCase(caseMatch, ctx.workspaceId) : null;

    const [notice] = await db
      .insert(schema.notices)
      .values({
        workspaceId: ctx.workspaceId,
        matterId: ctx.matterId,
        caseId,
        source: 'pdf',
        status: 'suspicious',
        rawText: input.text,
        rawFileUrl: input.rawFileUrl,
        senderEmail: input.senderEmail ?? null,
        senderDomain,
      })
      .returning({ id: schema.notices.id });

    const outcome: IngestResult = {
      noticeId: notice.id,
      status: 'suspicious',
      caseNumber: caseMatch?.caseNumber ?? null,
      type: null,
      confidence: null,
      hearingAt: null,
      deterministicReasons: det.reasons,
    };

    return {
      outcome,
      audit: {
        entity: 'notice',
        entityId: notice.id,
        action: 'ingested',
        after: {
          verdict: 'suspicious',
          caseNumber: caseMatch?.caseNumber ?? null,
          reasons: det.reasons,
          llmSkipped: true,
        },
      },
    };
  },

  async llm(input): Promise<LlmStage<AnalyseResult>> {
    return analyseNoticeLlm(input.text);
  },

  aggregateConfidence(llm: LlmStage<AnalyseResult>, det: DeterministicContinue): number {
    const caseMatch = det.meta.caseNumberMatch as DeterministicResult['caseNumber'];
    return aggregateConfidence(llm.data, Boolean(caseMatch));
  },

  async persist({
    ctx,
    input,
    det,
    llm,
    overallConfidence,
  }): Promise<PersistResult<IngestResult>> {
    const senderDomain = (det.meta.senderDomain as string | null) ?? null;
    const caseMatch = det.meta.caseNumberMatch as DeterministicResult['caseNumber'];
    const caseId = caseMatch ? await findOrCreateCase(caseMatch, ctx.workspaceId) : null;

    // A deterministic requiresReview signal (flagged sender, unknown link)
    // overrides any LLM confidence — the LLM cannot grant trust the
    // deterministic stage didn't already give.
    const status: 'routed' | 'needs_review' =
      !det.requiresReview &&
      overallConfidence >= ctx.reviewThreshold &&
      llm.data.type !== 'unknown'
        ? 'routed'
        : 'needs_review';

    const [notice] = await db
      .insert(schema.notices)
      .values({
        workspaceId: ctx.workspaceId,
        matterId: ctx.matterId,
        caseId,
        source: 'pdf',
        type: llm.data.type,
        status,
        rawText: input.text,
        rawFileUrl: input.rawFileUrl,
        senderEmail: input.senderEmail ?? null,
        senderDomain,
        confidence: overallConfidence,
        classificationReasoning: llm.data.classifyReasoning,
      })
      .returning({ id: schema.notices.id });

    const hearingAt = parseIso(llm.data.hearingAt);
    const deadline = parseIso(llm.data.deadline);

    await db.insert(schema.extractedEvents).values({
      workspaceId: ctx.workspaceId,
      noticeId: notice.id,
      type: llm.data.type,
      hearingAt,
      courtroom: llm.data.courtroom,
      virtualUrl: llm.data.virtualUrl,
      trustee: llm.data.trustee,
      judge: llm.data.judge,
      deadline,
      docketSummary: llm.data.docketSummary,
      fieldConfidences: llm.data.fieldConfidences,
    });

    // Auto-route notices get their follow-up Task immediately. needs_review
    // notices wait for the paralegal to approve them.
    if (status === 'routed' && caseId) {
      const event = { hearingAt, deadline, trustee: llm.data.trustee };
      await db.insert(schema.tasks).values({
        workspaceId: ctx.workspaceId,
        matterId: ctx.matterId,
        caseId,
        noticeId: notice.id,
        title: buildTaskTitle(llm.data.type, event),
        description: llm.data.docketSummary,
        dueAt: taskDueDate(event),
        assignee: 'auto-route',
        status: 'open',
      });
    }

    await db.insert(schema.parseRuns).values({
      workspaceId: ctx.workspaceId,
      noticeId: notice.id,
      model: llm.model,
      stage: 'analyse',
      // Persist the actual prompt + raw tool args so a reviewer can
      // reconstruct exactly what was asked and what came back.
      prompt: `[system]\n${llm.prompt.system}\n\n[user]\n${llm.prompt.user}\n\n[tool=${llm.prompt.toolName}]`,
      rawOutput: { args: llm.rawArgs, parsed: llm.data },
      durationMs: llm.durationMs,
      inputTokens: llm.usage.inputTokens,
      outputTokens: llm.usage.outputTokens,
    });

    const outcome: IngestResult = {
      noticeId: notice.id,
      status,
      caseNumber: caseMatch?.caseNumber ?? null,
      type: llm.data.type,
      confidence: overallConfidence,
      hearingAt,
      deterministicReasons: det.reasons,
    };

    return {
      outcome,
      audit: {
        entity: 'notice',
        entityId: notice.id,
        action: 'ingested',
        after: {
          verdict: 'continue',
          caseNumber: caseMatch?.caseNumber ?? null,
          type: llm.data.type,
          classifyConfidence: llm.data.classifyConfidence,
          overallConfidence,
          status,
          reasons: det.reasons,
        },
      },
    };
  },
};

registerPack(courtNoticePack);
