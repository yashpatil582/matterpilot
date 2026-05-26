/**
 * Pack 2 eval — Contract Playbook Review.
 *
 * Runs every labeled contract fixture through analyseContractLlm + the
 * matching playbook, then computes:
 *
 *   - Clause-type classification recall: for each expected clauseType, did
 *     the model produce a clause of that type?
 *   - Playbook-rule match accuracy: of expected (clauseType, ruleId) pairs,
 *     how many did the model produce?
 *   - Risk-level accuracy: of matched clauses, what fraction had the right
 *     riskLevel?
 *   - Review-status accuracy: did the document's reviewStatus match?
 *   - Flagged-count MAE: |observed - expected| flagged clauses.
 *   - Median per-fixture latency.
 *
 * No DB writes — pure functional pipeline over fixture text + playbook.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyseContractLlm,
  aggregateContractConfidence,
  countFlagged,
  type ExtractResult,
} from '../../src/lib/packs/contract-review/extract';
import { getPlaybook } from '../../src/lib/packs/contract-review/playbooks';
import type {
  ClauseType,
  RiskLevel,
} from '../../src/lib/packs/contract-review/schema';
import { CONTRACT_LABELS, type ContractLabel, type ExpectedClause } from './labels';

const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'contracts');

type PerFixtureRow = {
  fixture: string;
  playbookId: string;
  expectedReviewStatus: ContractLabel['expectedReviewStatus'];
  observedReviewStatus: 'needs_review' | 'auto_approved' | 'rejected' | 'errored';
  expectedFlaggedCount: number;
  observedFlaggedCount: number;
  clauseTypeRecall: number;
  ruleMatchRate: number;
  riskAccuracy: number;
  durationMs: number;
  overallConfidence: number | null;
  errors: string[];
  matchedClauses: number;
  expectedClauseCount: number;
  observedClauseCount: number;
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Pair each expected clause with one observed clause of the same clauseType
 * (best-effort: prefer one that also matches the expected ruleId).
 * Returns the pairing + leftover-observed indices.
 */
function pairClauses(
  expected: ExpectedClause[],
  observed: ExtractResult['clauses'],
): Array<{ expected: ExpectedClause; observed: ExtractResult['clauses'][number] | null }> {
  const used = new Set<number>();
  const pairs: Array<{
    expected: ExpectedClause;
    observed: ExtractResult['clauses'][number] | null;
  }> = [];

  for (const exp of expected) {
    // Prefer same type + same rule.
    let bestIdx = -1;
    for (let i = 0; i < observed.length; i++) {
      if (used.has(i)) continue;
      if (observed[i].clauseType !== exp.clauseType) continue;
      if (observed[i].matchedPlaybookRuleId === exp.matchedRuleId) {
        bestIdx = i;
        break;
      }
      if (bestIdx === -1) bestIdx = i; // fall back to same-type
    }
    if (bestIdx === -1) {
      pairs.push({ expected: exp, observed: null });
    } else {
      used.add(bestIdx);
      pairs.push({ expected: exp, observed: observed[bestIdx] });
    }
  }
  return pairs;
}

async function evalFixture(stem: string, text: string): Promise<PerFixtureRow> {
  const label = CONTRACT_LABELS[stem];
  if (!label) throw new Error(`No label for contract fixture ${stem}`);

  const playbook = getPlaybook(label.expectedPlaybookId);
  if (!playbook) throw new Error(`Unknown playbook ${label.expectedPlaybookId} for ${stem}`);

  const startedAt = Date.now();
  const row: PerFixtureRow = {
    fixture: stem,
    playbookId: label.expectedPlaybookId,
    expectedReviewStatus: label.expectedReviewStatus,
    observedReviewStatus: 'errored',
    expectedFlaggedCount: label.expectedFlaggedCount,
    observedFlaggedCount: 0,
    clauseTypeRecall: 0,
    ruleMatchRate: 0,
    riskAccuracy: 0,
    durationMs: 0,
    overallConfidence: null,
    errors: [],
    matchedClauses: 0,
    expectedClauseCount: label.expectedClauses.length,
    observedClauseCount: 0,
  };

  try {
    const llm = await analyseContractLlm({ text, playbook });
    row.observedClauseCount = llm.data.clauses.length;
    row.overallConfidence = aggregateContractConfidence(llm.data);
    row.observedFlaggedCount = countFlagged(llm.data);

    // Determine observed review status using same threshold as the pack
    // (AUTO_APPROVE_FLAGGED_THRESHOLD = 0 in contract-review/index.ts).
    row.observedReviewStatus =
      row.observedFlaggedCount > 0 ? 'needs_review' : 'auto_approved';

    const pairs = pairClauses(label.expectedClauses, llm.data.clauses);
    const typeHits = pairs.filter((p) => p.observed != null).length;
    const ruleHits = pairs.filter(
      (p) => p.observed != null && p.observed.matchedPlaybookRuleId === p.expected.matchedRuleId,
    ).length;
    const riskHits = pairs.filter(
      (p) => p.observed != null && p.observed.riskLevel === p.expected.riskLevel,
    ).length;

    row.matchedClauses = typeHits;
    row.clauseTypeRecall = label.expectedClauses.length === 0 ? 1 : typeHits / label.expectedClauses.length;
    row.ruleMatchRate = label.expectedClauses.length === 0 ? 1 : ruleHits / label.expectedClauses.length;
    row.riskAccuracy = label.expectedClauses.length === 0 ? 1 : riskHits / label.expectedClauses.length;
  } catch (err) {
    row.errors.push(err instanceof Error ? err.message : String(err));
  }

  row.durationMs = Date.now() - startedAt;
  return row;
}

function buildSection(rows: PerFixtureRow[]): string {
  const total = rows.length;
  const errored = rows.filter((r) => r.errors.length > 0);
  const success = rows.filter((r) => r.errors.length === 0);

  const macro = (key: 'clauseTypeRecall' | 'ruleMatchRate' | 'riskAccuracy') =>
    success.length === 0 ? 0 : success.reduce((a, r) => a + r[key], 0) / success.length;

  const reviewStatusMatches = success.filter(
    (r) => r.observedReviewStatus === r.expectedReviewStatus,
  ).length;
  const reviewStatusRate = success.length === 0 ? 0 : reviewStatusMatches / success.length;

  const flaggedMae =
    success.length === 0
      ? 0
      : success.reduce(
          (a, r) => a + Math.abs(r.observedFlaggedCount - r.expectedFlaggedCount),
          0,
        ) / success.length;

  const medianLatency = median(success.map((r) => r.durationMs));

  const byClauseType: Record<string, { tp: number; expected: number }> = {};
  for (const r of success) {
    const label = CONTRACT_LABELS[r.fixture];
    if (!label) continue;
    for (const exp of label.expectedClauses) {
      const slot = byClauseType[exp.clauseType] ?? { tp: 0, expected: 0 };
      slot.expected += 1;
      byClauseType[exp.clauseType] = slot;
    }
  }
  for (const r of success) {
    const label = CONTRACT_LABELS[r.fixture];
    if (!label) continue;
    // Recompute the per-fixture pairs to attribute per-type hits.
    // (Cheap because clause counts are small.)
    // We approximate using clauseTypeRecall * expected count.
    for (const exp of label.expectedClauses) {
      const slot = byClauseType[exp.clauseType];
      if (slot) {
        // proportional attribution
        slot.tp += r.clauseTypeRecall * (1 / label.expectedClauses.length);
      }
    }
  }

  const lines: string[] = [];
  lines.push('## Pack 2 — Contract Playbook Review');
  lines.push('');
  lines.push(
    `Fixtures: **${total}** (errored ${errored.length}) · model \`${process.env.LLM_MODEL_CLASSIFY ?? 'llama-3.3-70b-versatile'}\` via Groq · playbooks: 3 (Mutual NDA, MSA, Service Agreement)`,
  );
  lines.push('');
  lines.push('### Headline metrics');
  lines.push('');
  lines.push('| Metric | Result | Target |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Clause-type recall (macro) | **${pct(macro('clauseTypeRecall'))}** | ≥ 85% |`);
  lines.push(`| Playbook-rule match accuracy (macro) | **${pct(macro('ruleMatchRate'))}** | ≥ 75% |`);
  lines.push(`| Risk-level accuracy (macro) | **${pct(macro('riskAccuracy'))}** | ≥ 75% |`);
  lines.push(`| Review-status accuracy | **${pct(reviewStatusRate)}** | ≥ 85% |`);
  lines.push(`| Flagged-count MAE | **${flaggedMae.toFixed(2)}** | ≤ 1.0 |`);
  lines.push(`| Median per-fixture latency | **${(medianLatency / 1000).toFixed(2)}s** | < 10s |`);
  lines.push('');
  lines.push('### Per-fixture detail');
  lines.push('');
  lines.push(
    '| Fixture | Playbook | Status | Clauses (matched/expected/observed) | Rule match | Risk acc. | Flagged (obs/exp) | Conf. | Lat (s) |',
  );
  lines.push(
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const r of rows) {
    const statusCell =
      r.observedReviewStatus === r.expectedReviewStatus
        ? `✓ ${r.observedReviewStatus.replace('_', ' ')}`
        : `✗ ${r.observedReviewStatus.replace('_', ' ')} (exp ${r.expectedReviewStatus.replace('_', ' ')})`;
    const confCell =
      r.overallConfidence != null ? `${Math.round(r.overallConfidence * 100)}%` : '—';
    lines.push(
      `| \`${r.fixture}\` | ${r.playbookId} | ${statusCell} | ${r.matchedClauses}/${r.expectedClauseCount}/${r.observedClauseCount} | ${pct(r.ruleMatchRate)} | ${pct(r.riskAccuracy)} | ${r.observedFlaggedCount}/${r.expectedFlaggedCount} | ${confCell} | ${(r.durationMs / 1000).toFixed(1)} |`,
    );
  }
  if (errored.length > 0) {
    lines.push('');
    lines.push('### Errors');
    lines.push('');
    for (const r of errored) {
      lines.push(`- \`${r.fixture}\`: ${r.errors.join('; ')}`);
    }
  }
  lines.push('');
  lines.push('### Methodology');
  lines.push('');
  lines.push(
    '- Eval set: 8 synthetic contracts covering Mutual NDA, MSA, and Service Agreement archetypes.',
  );
  lines.push(
    '- LLM stage uses Groq `llama-3.3-70b-versatile` tool-use with temperature 0 — one combined call returns clauses + classification + playbook match + risk + redline.',
  );
  lines.push(
    '- Clause pairing: each expected clause is matched to one observed clause of the same `clauseType`, preferring matches that also share `matchedPlaybookRuleId`. Surplus observed clauses do not penalise recall but show up in the observed-count column.',
  );
  lines.push(
    '- Review status mirrors the pack threshold (`AUTO_APPROVE_FLAGGED_THRESHOLD = 0`): any clause with risk medium or high routes the document to `needs_review`.',
  );
  lines.push(
    '- All contract text, parties, and clause language are synthetic. Real third-party contract corpora should be added before any public performance claim.',
  );
  return lines.join('\n');
}

export type ContractEvalResult = {
  section: string;
  fixtureCount: number;
};

export async function runContractEval(
  opts: {
    onFixture?: (
      stem: string,
      status: string,
      clauseRecall: number,
      ruleRate: number,
    ) => void;
  } = {},
): Promise<ContractEvalResult> {
  const fixtures = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
    .sort();

  const rows: PerFixtureRow[] = [];
  for (const stem of fixtures) {
    if (!CONTRACT_LABELS[stem]) {
      // Skip unlabeled fixtures (e.g. demo-only PDFs).
      continue;
    }
    const text = readFileSync(join(FIXTURES_DIR, `${stem}.txt`), 'utf8');
    const row = await evalFixture(stem, text);
    rows.push(row);
    opts.onFixture?.(stem, row.observedReviewStatus, row.clauseTypeRecall, row.ruleMatchRate);
  }

  return { section: buildSection(rows), fixtureCount: rows.length };
}
