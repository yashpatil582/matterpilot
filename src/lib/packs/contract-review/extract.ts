/**
 * Single combined LLM stage for Pack 2 — extract clauses, classify their
 * type, AND apply the chosen playbook in one tool-use call.
 *
 * Same shape as Pack 1's analyseNoticeLlm: one prompt, one tool, one
 * round-trip. The model is given the contract text and the playbook's rules,
 * and returns an array of clauses each annotated with risk + redline.
 */

import { z } from 'zod';
import { runTool } from '@/lib/llm';
import { CLAUSE_TYPE_VALUES, RISK_LEVEL_VALUES } from './schema';
import type { Playbook } from './playbooks';

export const ExtractedClauseSchema = z.object({
  ordinal: z.number().int().min(0),
  clauseType: z.enum(CLAUSE_TYPE_VALUES),
  text: z.string().min(1),
  startCharIndex: z.number().int().nullable(),
  endCharIndex: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  matchedPlaybookRuleId: z.string().nullable(),
  riskLevel: z.enum(RISK_LEVEL_VALUES),
  redlineSuggestion: z.string().nullable(),
  reasoning: z.string().min(1),
});

export const ExtractResultSchema = z.object({
  clauses: z.array(ExtractedClauseSchema),
  summary: z.string().min(1),
});

export type ExtractedClause = z.infer<typeof ExtractedClauseSchema>;
export type ExtractResult = z.infer<typeof ExtractResultSchema>;

const TOOL = {
  name: 'analyse_contract',
  description:
    'Extract clauses from a contract, classify each by type, and apply the provided playbook rules to flag risk and propose redlines.',
  parameters: {
    type: 'object',
    properties: {
      clauses: {
        type: 'array',
        description:
          'Every clause that matches the playbook\'s applicable clause types. Quote the contract verbatim in `text`. Order them in document order.',
        items: {
          type: 'object',
          properties: {
            ordinal: {
              type: 'integer',
              minimum: 0,
              description: 'Zero-based order this clause appears in the contract.',
            },
            clauseType: {
              type: 'string',
              enum: CLAUSE_TYPE_VALUES,
              description: 'The clause type this clause is classified as.',
            },
            text: {
              type: 'string',
              description:
                'Verbatim quote of the clause text from the contract. Do not paraphrase. Trim leading/trailing whitespace.',
            },
            startCharIndex: {
              type: ['integer', 'null'],
              description:
                'Character index in the supplied contract text where this clause starts. Null if you cannot locate it precisely.',
            },
            endCharIndex: {
              type: ['integer', 'null'],
              description: 'Character index where this clause ends. Null if unknown.',
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description:
                'How confident you are this clause is correctly classified and accurately quoted (0..1).',
            },
            matchedPlaybookRuleId: {
              type: ['string', 'null'],
              description:
                'ID of the playbook rule this clause violates or matches. Null if no rule applies.',
            },
            riskLevel: {
              type: 'string',
              enum: RISK_LEVEL_VALUES,
              description:
                'Risk classification: high if the clause materially violates the playbook, medium if it deviates with negotiable impact, low if it is acceptable.',
            },
            redlineSuggestion: {
              type: ['string', 'null'],
              description:
                'Concrete replacement / insertion text. Null when no redline is needed.',
            },
            reasoning: {
              type: 'string',
              description:
                'One or two sentences explaining the risk classification and why the redline (if any) is proposed.',
            },
          },
          required: [
            'ordinal',
            'clauseType',
            'text',
            'startCharIndex',
            'endCharIndex',
            'confidence',
            'matchedPlaybookRuleId',
            'riskLevel',
            'redlineSuggestion',
            'reasoning',
          ],
          additionalProperties: false,
        },
      },
      summary: {
        type: 'string',
        description:
          'One paragraph an attorney would write on a matter timeline: how risky overall, what to fix first.',
      },
    },
    required: ['clauses', 'summary'],
    additionalProperties: false,
  },
} as const;

function buildSystem(playbook: Playbook): string {
  return `You are an expert contracts attorney reviewing a third-party contract against the firm's playbook.

You only extract clauses that match the playbook's applicable clause types: ${playbook.applicableClauseTypes.join(', ')}.
You quote the contract text verbatim in the \`text\` field — never paraphrase.
You apply the playbook rules below. For each clause, decide which rule (if any) is the most relevant match.
You set riskLevel = high when a rule's must/mustNot conditions are clearly violated, medium when partially deviated, low when acceptable.
You set confidence below 0.7 when the clause is ambiguous, fragmented, or the classification is uncertain.

Playbook: ${playbook.name}
${playbook.description}

Rules:
${playbook.rules
  .map(
    (r) =>
      `- id: ${r.id}
  clauseType: ${r.clauseType}
  description: ${r.description}
  must contain: ${r.must.length ? r.must.join(', ') : '(none)'}
  must NOT contain: ${r.mustNot.length ? r.mustNot.join(', ') : '(none)'}
  severity if violated: ${r.severity}
  suggested redline: ${r.suggestedRedline}`,
  )
  .join('\n\n')}`;
}

export async function analyseContractLlm(args: {
  text: string;
  playbook: Playbook;
}) {
  return runTool({
    system: buildSystem(args.playbook),
    user: `Review this contract against the ${args.playbook.name} playbook. Extract every clause matching the playbook's applicable types and apply the rules.

<<<CONTRACT
${args.text.slice(0, 16000)}
CONTRACT>>>`,
    tool: TOOL,
    schema: ExtractResultSchema,
    model: process.env.LLM_MODEL_CLASSIFY,
  });
}

/**
 * Aggregate clause-level confidences + flag count into a document-level
 * confidence used by the review-queue threshold (mirrors Pack 1's
 * aggregateConfidence shape).
 */
export function aggregateContractConfidence(result: ExtractResult): number {
  if (result.clauses.length === 0) return 0.5;
  const avg =
    result.clauses.reduce((sum, c) => sum + c.confidence, 0) / result.clauses.length;
  // Penalise if any high-risk clauses landed — those always need human review.
  const highRiskFraction =
    result.clauses.filter((c) => c.riskLevel === 'high').length / result.clauses.length;
  return Math.max(0, Math.min(1, avg - highRiskFraction * 0.3));
}

export function countFlagged(result: ExtractResult): number {
  return result.clauses.filter((c) => c.riskLevel !== 'low').length;
}
