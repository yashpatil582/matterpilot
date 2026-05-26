/**
 * Pack 1 eval — U.S. bankruptcy court notice intake.
 *
 * Runs every labeled notice fixture through the deterministic +
 * LLM-classify-and-extract pipeline and emits a markdown section
 * with headline metrics, per-field F1, and a per-fixture table.
 *
 * No DB writes — pure functional pipeline over fixture text.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNotice } from '../src/lib/parsing';
import {
  analyseNoticeLlm,
  aggregateConfidence,
  NOTICE_TYPES,
  type NoticeType,
} from '../src/lib/notice-pipeline/analyse';
import { LABELS, type ExpectedFields } from './labels';

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'notices');
const REVIEW_THRESHOLD = Number(process.env.REVIEW_CONFIDENCE_THRESHOLD ?? 0.75);

type FieldName = keyof ExpectedFields;
const FIELD_NAMES: FieldName[] = [
  'hearingAt',
  'courtroom',
  'virtualUrl',
  'trustee',
  'judge',
  'deadline',
];

type FieldCounts = { tp: number; fp: number; fn: number };
type PerFixtureRow = {
  fixture: string;
  expectedCaseNumber: string;
  observedCaseNumber: string | null;
  caseMatch: boolean;
  expectedType: NoticeType | null;
  observedType: NoticeType | null;
  typeMatch: boolean;
  expectedStatus: string;
  observedStatus: string;
  statusMatch: boolean;
  overallConfidence: number | null;
  classifyConfidence: number | null;
  durationMs: number;
  fieldHits: Record<FieldName, 'tp' | 'fp' | 'fn' | 'tn' | 'skipped'>;
  errors: string[];
};

function extractSenderHeader(text: string): string | null {
  const m = text.match(/^From:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

function normaliseString(v: string): string {
  return v.toLowerCase().replace(/[\s\W]+/g, ' ').trim();
}

function stringFieldMatches(expected: string, observed: string | null): boolean {
  if (observed == null) return false;
  const e = normaliseString(expected);
  const o = normaliseString(observed);
  return o.includes(e) || e.includes(o);
}

function datetimeFieldMatches(expected: string, observed: string | null): boolean {
  if (observed == null) return false;
  const e = new Date(expected).getTime();
  const o = new Date(observed).getTime();
  if (Number.isNaN(e) || Number.isNaN(o)) return false;
  return Math.abs(e - o) <= 5 * 60 * 1000;
}

function dateFieldMatches(expected: string, observed: string | null): boolean {
  if (observed == null) return false;
  const e = expected.slice(0, 10);
  const o = new Date(observed).toISOString().slice(0, 10);
  return e === o;
}

function evalField(
  name: FieldName,
  expected: ExpectedFields[FieldName],
  observed: string | null,
): 'tp' | 'fp' | 'fn' | 'tn' {
  if (expected === null && observed == null) return 'tn';
  if (expected === null && observed != null) return 'fp';
  if (expected !== null && observed == null) return 'fn';

  if (name === 'virtualUrl') {
    if (expected === '*') return 'tp';
    return stringFieldMatches(expected as string, observed) ? 'tp' : 'fn';
  }
  if (name === 'hearingAt') {
    return datetimeFieldMatches(expected as string, observed) ? 'tp' : 'fn';
  }
  if (name === 'deadline') {
    return dateFieldMatches(expected as string, observed) ? 'tp' : 'fn';
  }
  return stringFieldMatches(expected as string, observed) ? 'tp' : 'fn';
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function evalFixture(stem: string, content: string): Promise<PerFixtureRow> {
  const label = LABELS[stem];
  if (!label) throw new Error(`No label for fixture ${stem}`);

  const senderEmail = extractSenderHeader(content);
  const det = analyseNotice({ text: content, senderEmail });
  const startedAt = Date.now();

  const row: PerFixtureRow = {
    fixture: stem,
    expectedCaseNumber: label.expectedCaseNumber,
    observedCaseNumber: det.caseNumber?.caseNumber ?? null,
    caseMatch: det.caseNumber?.caseNumber === label.expectedCaseNumber,
    expectedType: label.expectedType,
    observedType: null,
    typeMatch: false,
    expectedStatus: label.expectedStatus,
    observedStatus: 'received',
    statusMatch: false,
    overallConfidence: null,
    classifyConfidence: null,
    durationMs: 0,
    fieldHits: Object.fromEntries(
      FIELD_NAMES.map((f) => [f, 'skipped']),
    ) as PerFixtureRow['fieldHits'],
    errors: [],
  };

  if (det.verdict === 'suspicious') {
    row.observedStatus = 'suspicious';
    row.statusMatch = row.observedStatus === label.expectedStatus;
    row.typeMatch = label.expectedType === null;
    row.durationMs = Date.now() - startedAt;
    return row;
  }

  try {
    const llm = await analyseNoticeLlm(content);

    row.observedType = llm.data.type;
    row.classifyConfidence = llm.data.classifyConfidence;
    row.typeMatch = label.expectedType !== null && llm.data.type === label.expectedType;
    row.overallConfidence = aggregateConfidence(llm.data, row.caseMatch);
    row.observedStatus =
      row.overallConfidence >= REVIEW_THRESHOLD && llm.data.type !== 'unknown'
        ? 'routed'
        : 'needs_review';
    row.statusMatch = row.observedStatus === label.expectedStatus;

    for (const f of FIELD_NAMES) {
      row.fieldHits[f] = evalField(
        f,
        label.expectedFields[f],
        (llm.data as Record<FieldName, string | null>)[f],
      );
    }
  } catch (err) {
    row.errors.push(err instanceof Error ? err.message : String(err));
  }

  row.durationMs = Date.now() - startedAt;
  return row;
}

function aggregateFieldCounts(rows: PerFixtureRow[]): Record<FieldName, FieldCounts> {
  const counts: Record<FieldName, FieldCounts> = Object.fromEntries(
    FIELD_NAMES.map((f) => [f, { tp: 0, fp: 0, fn: 0 }]),
  ) as Record<FieldName, FieldCounts>;
  for (const r of rows) {
    for (const f of FIELD_NAMES) {
      const hit = r.fieldHits[f];
      if (hit === 'tp') counts[f].tp++;
      else if (hit === 'fp') counts[f].fp++;
      else if (hit === 'fn') counts[f].fn++;
    }
  }
  return counts;
}

function f1(c: FieldCounts) {
  const p = c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp);
  const r = c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn);
  const f = p + r === 0 ? 0 : (2 * p * r) / (p + r);
  return { precision: p, recall: r, f1: f };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function buildSection(rows: PerFixtureRow[]): string {
  const total = rows.length;
  const legit = rows.filter((r) => r.expectedType !== null);
  const phishing = rows.filter((r) => r.expectedType === null);

  const caseMatchRate = rows.filter((r) => r.caseMatch).length / total;
  const typeMatches = legit.filter((r) => r.typeMatch).length;
  const typeRate = legit.length === 0 ? 0 : typeMatches / legit.length;
  const statusMatches = rows.filter((r) => r.statusMatch).length;
  const statusRate = statusMatches / total;
  const straightThrough =
    legit.length === 0 ? 0 : legit.filter((r) => r.observedStatus === 'routed').length / legit.length;
  const phishingDetected = phishing.filter((r) => r.observedStatus === 'suspicious').length;
  const phishingRecall = phishing.length === 0 ? 0 : phishingDetected / phishing.length;
  const falsePositiveRate =
    legit.length === 0
      ? 0
      : legit.filter((r) => r.observedStatus === 'suspicious').length / legit.length;

  const fieldCounts = aggregateFieldCounts(rows);
  const fieldMetrics = Object.fromEntries(
    (Object.entries(fieldCounts) as [FieldName, FieldCounts][]).map(([f, c]) => [f, f1(c)]),
  ) as Record<FieldName, ReturnType<typeof f1>>;

  const medianLatency = median(
    rows
      .filter((r) => !r.errors.length && r.observedStatus !== 'suspicious')
      .map((r) => r.durationMs),
  );

  const lines: string[] = [];
  lines.push('## Pack 1 — Court Notice Intake');
  lines.push('');
  lines.push(
    `Fixtures: **${total}** (legit ${legit.length}, phishing ${phishing.length}) · model \`${process.env.LLM_MODEL_CLASSIFY ?? 'llama-3.3-70b-versatile'}\` via Groq`,
  );
  lines.push('');
  lines.push('### Headline metrics');
  lines.push('');
  lines.push('| Metric | Result | Target |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Case-number match accuracy | **${pct(caseMatchRate)}** | ≥ 98% |`);
  lines.push(`| Notice-type classification accuracy (legit only) | **${pct(typeRate)}** | ≥ 90% |`);
  lines.push(`| Final-status accuracy | **${pct(statusRate)}** | ≥ 90% |`);
  lines.push(`| Straight-through rate (legit → routed) | **${pct(straightThrough)}** | ≥ 60% |`);
  lines.push(`| Phishing detection recall | **${pct(phishingRecall)}** | ≥ 95% |`);
  lines.push(`| Phishing false-positive rate (legit → suspicious) | **${pct(falsePositiveRate)}** | ≤ 5% |`);
  lines.push(`| Median ingest latency (LLM stages) | **${(medianLatency / 1000).toFixed(2)}s** | < 8s |`);
  lines.push('');
  lines.push('### Field extraction (F1 per field)');
  lines.push('');
  lines.push('| Field | Precision | Recall | F1 | TP | FP | FN |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const f of FIELD_NAMES) {
    const m = fieldMetrics[f];
    const c = fieldCounts[f];
    lines.push(
      `| ${f} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${c.tp} | ${c.fp} | ${c.fn} |`,
    );
  }
  const macroF1 = Object.values(fieldMetrics).reduce((a, b) => a + b.f1, 0) / FIELD_NAMES.length;
  lines.push('');
  lines.push(`**Macro-F1 across fields**: ${pct(macroF1)} (target ≥ 85%)`);
  lines.push('');
  lines.push('### Per-fixture detail');
  lines.push('');
  lines.push('| Fixture | Case | Type | Status | Conf. | Lat (s) | Errors |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | --- |');
  for (const r of rows) {
    const caseCell = r.caseMatch
      ? `✓ ${r.observedCaseNumber}`
      : `✗ ${r.observedCaseNumber ?? '(none)'} (expected ${r.expectedCaseNumber})`;
    const typeCell = r.typeMatch
      ? `✓ ${r.observedType ?? '(suspicious)'}`
      : `✗ ${r.observedType ?? '(none)'} (expected ${r.expectedType ?? 'suspicious'})`;
    const statusCell = r.statusMatch
      ? `✓ ${r.observedStatus}`
      : `✗ ${r.observedStatus} (expected ${r.expectedStatus})`;
    const conf =
      r.overallConfidence != null ? `${Math.round(r.overallConfidence * 100)}%` : '—';
    const errs = r.errors.length ? r.errors.join('; ') : '';
    lines.push(
      `| \`${r.fixture}\` | ${caseCell} | ${typeCell} | ${statusCell} | ${conf} | ${(r.durationMs / 1000).toFixed(1)} | ${errs} |`,
    );
  }
  lines.push('');
  lines.push('### Methodology');
  lines.push('');
  lines.push('- Eval set: 20 synthetic notices modeled on official bankruptcy forms (309A, 122A, B 318, etc.).');
  lines.push('  Real PACER and BNC samples should be added before any public claim about performance.');
  lines.push('- Deterministic stage (case number regex, sender allowlist, link host check) runs first.');
  lines.push('- Notices flagged `suspicious` skip the LLM stage entirely (saves tokens).');
  lines.push('- LLM stage uses Groq `llama-3.3-70b-versatile` tool-use with temperature 0.');
  lines.push(
    '- Status routing threshold (`REVIEW_CONFIDENCE_THRESHOLD`): **' + REVIEW_THRESHOLD + '**.',
  );
  lines.push('- Field matches use case/punctuation-normalized contains; datetimes ±5 minutes; dates same YYYY-MM-DD.');
  lines.push('- All notice text, names, trustees, and judges are synthetic. Notice types are seven enum values.');
  return lines.join('\n');
}

export type NoticeEvalResult = {
  section: string;
  fixtureCount: number;
};

export async function runNoticeEval(opts: {
  onFixture?: (stem: string, status: string, caseMatch: boolean, typeMatch: boolean) => void;
} = {}): Promise<NoticeEvalResult> {
  const fixtures = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
    .sort();

  const rows: PerFixtureRow[] = [];
  for (const stem of fixtures) {
    const text = readFileSync(join(FIXTURES_DIR, `${stem}.txt`), 'utf8');
    const row = await evalFixture(stem, text);
    rows.push(row);
    opts.onFixture?.(stem, row.observedStatus, row.caseMatch, row.typeMatch);
  }

  return { section: buildSection(rows), fixtureCount: rows.length };
}

// Avoid an unused-import warning for NOTICE_TYPES (kept for narrowing safety).
void NOTICE_TYPES;
