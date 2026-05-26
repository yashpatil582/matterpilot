/**
 * Email-thread summarizer for the Outlook add-in.
 *
 * Single combined Groq tool-use call returning the same shape Pack 1's
 * analyseNoticeLlm returns: a one-paragraph summary, an array of extracted
 * deadlines, and a flag indicating whether the thread looks matter-relevant
 * (so the "File to matter" button can prefill confidence).
 */

import { z } from 'zod';
import { runTool } from '@/lib/llm';

export const SummariseResultSchema = z.object({
  summary: z.string().min(1),
  deadlines: z.array(
    z.object({
      what: z.string().min(1),
      whenIso: z.string().nullable(),
      whenText: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  parties: z.array(z.string()).max(20),
  matterRelevance: z.number().min(0).max(1),
});

export type SummariseResult = z.infer<typeof SummariseResultSchema>;

const TOOL = {
  name: 'summarise_thread',
  description:
    'Summarize an email thread for a legal paralegal and extract any deadlines mentioned.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Two-to-four-sentence summary an attorney would skim on a matter timeline.',
      },
      deadlines: {
        type: 'array',
        description:
          'Every concrete deadline mentioned in the thread (response dates, hearing dates, filing dates, etc.). Empty array if none.',
        items: {
          type: 'object',
          properties: {
            what: { type: 'string', description: 'What is due — short noun phrase.' },
            whenIso: {
              type: ['string', 'null'],
              description: 'ISO-8601 date or datetime if explicit; null otherwise.',
            },
            whenText: {
              type: ['string', 'null'],
              description: 'Original natural-language deadline phrasing as it appeared.',
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'How confident this is a real deadline (vs. casual mention).',
            },
          },
          required: ['what', 'whenIso', 'whenText', 'confidence'],
          additionalProperties: false,
        },
      },
      parties: {
        type: 'array',
        description: 'Distinct named people, firms, or organisations mentioned in the thread.',
        items: { type: 'string' },
      },
      matterRelevance: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description:
          'How matter-relevant the thread looks (0 = personal / spam; 1 = clearly active matter correspondence).',
      },
    },
    required: ['summary', 'deadlines', 'parties', 'matterRelevance'],
    additionalProperties: false,
  },
} as const;

const SYSTEM = `You are an expert legal paralegal triaging email threads for a busy attorney.

You produce concise, accurate summaries — no fluff, no recommendations.
You extract deadlines only when the thread explicitly states a date or time-bound obligation.
You set deadline confidence below 0.7 when the date is implied, vague, or formatted ambiguously.
You set matterRelevance to 0 for clearly off-topic mail (newsletters, internal scheduling, spam).`;

export async function summariseThreadLlm(args: { subject: string; body: string }) {
  return runTool({
    system: SYSTEM,
    user: `Summarise this email thread and extract any deadlines.

Subject: ${args.subject.slice(0, 500)}

<<<THREAD
${args.body.slice(0, 16000)}
THREAD>>>`,
    tool: TOOL,
    schema: SummariseResultSchema,
    model: process.env.LLM_MODEL_CLASSIFY,
  });
}
