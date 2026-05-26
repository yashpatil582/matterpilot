/**
 * Pack 2 — Contract Playbook Review.
 *
 * Runs on the same WorkflowPack engine as Pack 1 (court-notice). Given a
 * contract text + a playbook id, it:
 *
 *   1. Validates deterministically (matter required, playbook must exist,
 *      text must be long enough to look like a real contract).
 *   2. Asks the LLM to extract every applicable clause and apply the playbook
 *      in one tool call.
 *   3. Persists a `documents` row (kind='contract'), N `contract_clauses`
 *      rows, the ParseRun, and an audit event. Sets reviewStatus to
 *      `needs_review` if any clause flagged, otherwise `auto_approved`.
 */

import { db, schema } from '@/db';
import { registerPack } from '@/lib/workflow/registry';
import type {
  DeterministicContinue,
  DeterministicShortCircuit,
  LlmStage,
  PersistResult,
  WorkflowPack,
} from '@/lib/workflow/types';
import {
  analyseContractLlm,
  aggregateContractConfidence,
  countFlagged,
  type ExtractResult,
} from './extract';
import { getPlaybook, type Playbook } from './playbooks';

const MIN_CONTRACT_CHARS = 500;
const AUTO_APPROVE_FLAGGED_THRESHOLD = 0;

export type ContractReviewInput = {
  text: string;
  rawFileUrl: string;
  fileName: string;
  playbookId: string;
  matterId: string;
};

export type ContractReviewOutcome = {
  documentId: string;
  matterId: string;
  playbookId: string;
  reviewStatus: 'needs_review' | 'auto_approved' | 'rejected';
  flaggedClauseCount: number;
  clauseCount: number;
  overallConfidence: number | null;
  deterministicReasons: string[];
};

export const contractReviewPack: WorkflowPack<
  ContractReviewInput,
  ExtractResult,
  ContractReviewOutcome
> = {
  id: 'contract-review',
  displayName: 'Contract Playbook Review',
  documentKinds: ['contract'],

  deterministic(input) {
    const reasons: string[] = [];
    let shortCircuitReason: string | null = null;

    const playbook = getPlaybook(input.playbookId);
    if (!playbook) {
      shortCircuitReason = `unknown playbook: ${input.playbookId}`;
      reasons.push(shortCircuitReason);
    } else if (input.text.trim().length < MIN_CONTRACT_CHARS) {
      shortCircuitReason = `contract too short (${input.text.trim().length} chars, minimum ${MIN_CONTRACT_CHARS})`;
      reasons.push(shortCircuitReason);
    } else if (!input.matterId) {
      shortCircuitReason = 'matterId required for contract review';
      reasons.push(shortCircuitReason);
    }

    if (shortCircuitReason) {
      return {
        kind: 'short_circuit',
        reasons,
        meta: { reason: shortCircuitReason, playbookId: input.playbookId },
      };
    }

    return {
      kind: 'continue',
      reasons,
      requiresReview: false,
      meta: { playbook: playbook as Playbook },
    };
  },

  async persistShortCircuit({
    ctx,
    input,
    det,
  }: {
    ctx: { workspaceId: string; matterId: string | null; actor: string; reviewThreshold: number };
    input: ContractReviewInput;
    det: DeterministicShortCircuit;
  }): Promise<PersistResult<ContractReviewOutcome>> {
    const [doc] = await db
      .insert(schema.documents)
      .values({
        workspaceId: ctx.workspaceId,
        matterId: input.matterId,
        kind: 'contract',
        sourceConnector: 'upload',
        blobUrl: input.rawFileUrl,
        name: input.fileName,
        mimeType: 'application/pdf',
        playbookId: input.playbookId,
        reviewStatus: 'rejected',
        flaggedClauseCount: 0,
      })
      .returning({ id: schema.documents.id });

    return {
      outcome: {
        documentId: doc.id,
        matterId: input.matterId,
        playbookId: input.playbookId,
        reviewStatus: 'rejected',
        flaggedClauseCount: 0,
        clauseCount: 0,
        overallConfidence: null,
        deterministicReasons: det.reasons,
      },
      audit: {
        entity: 'document',
        entityId: doc.id,
        action: 'contract_short_circuit',
        after: {
          reason: det.meta.reason ?? 'unknown',
          playbookId: input.playbookId,
          llmSkipped: true,
        },
      },
    };
  },

  async llm(input, det: DeterministicContinue): Promise<LlmStage<ExtractResult>> {
    const playbook = det.meta.playbook as Playbook;
    return analyseContractLlm({ text: input.text, playbook });
  },

  aggregateConfidence(llm: LlmStage<ExtractResult>): number {
    return aggregateContractConfidence(llm.data);
  },

  async persist({
    ctx,
    input,
    det,
    llm,
    overallConfidence,
  }): Promise<PersistResult<ContractReviewOutcome>> {
    const flaggedCount = countFlagged(llm.data);
    const reviewStatus: 'needs_review' | 'auto_approved' =
      flaggedCount > AUTO_APPROVE_FLAGGED_THRESHOLD ? 'needs_review' : 'auto_approved';

    const [doc] = await db
      .insert(schema.documents)
      .values({
        workspaceId: ctx.workspaceId,
        matterId: input.matterId,
        kind: 'contract',
        sourceConnector: 'upload',
        blobUrl: input.rawFileUrl,
        name: input.fileName,
        mimeType: 'application/pdf',
        playbookId: input.playbookId,
        reviewStatus,
        flaggedClauseCount: flaggedCount,
      })
      .returning({ id: schema.documents.id });

    if (llm.data.clauses.length > 0) {
      await db.insert(schema.contractClauses).values(
        llm.data.clauses.map((c) => ({
          workspaceId: ctx.workspaceId,
          matterId: input.matterId,
          documentId: doc.id,
          ordinal: c.ordinal,
          clauseType: c.clauseType,
          text: c.text,
          startOffset: c.startCharIndex,
          endOffset: c.endCharIndex,
          confidence: c.confidence,
          riskLevel: c.riskLevel,
          matchedPlaybookRuleId: c.matchedPlaybookRuleId,
          redlineSuggestion: c.redlineSuggestion,
          reasoning: c.reasoning,
        })),
      );
    }

    // parseRuns is foreign-keyed to notices; Pack 2 captures run metadata in
    // the audit event below. Generalising parseRuns to a polymorphic entity
    // (notice | document | clause) is a Week 4 polish item.

    return {
      outcome: {
        documentId: doc.id,
        matterId: input.matterId,
        playbookId: input.playbookId,
        reviewStatus,
        flaggedClauseCount: flaggedCount,
        clauseCount: llm.data.clauses.length,
        overallConfidence,
        deterministicReasons: det.reasons,
      },
      audit: {
        entity: 'document',
        entityId: doc.id,
        action: 'contract_reviewed',
        after: {
          playbookId: input.playbookId,
          clauseCount: llm.data.clauses.length,
          flaggedClauseCount: flaggedCount,
          overallConfidence,
          reviewStatus,
          summary: llm.data.summary,
          model: llm.model,
          durationMs: llm.durationMs,
          inputTokens: llm.usage.inputTokens,
          outputTokens: llm.usage.outputTokens,
        },
      },
    };
  },
};

registerPack(contractReviewPack);

export type { ExtractResult, ExtractedClause } from './extract';
export type { Playbook, PlaybookRule } from './playbooks';
export { listPlaybooks, getPlaybook } from './playbooks';
