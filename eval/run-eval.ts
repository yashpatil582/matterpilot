/**
 * MatterPilot eval harness — pack-aware dispatcher.
 *
 * Runs both packs by default, writes a unified eval-results.md report.
 *
 *   pnpm eval                              # both packs
 *   pnpm eval -- --pack=court-notice       # Pack 1 only
 *   pnpm eval -- --pack=contract-review    # Pack 2 only
 *
 * No DB writes — each pack runs as a pure function over its fixture set.
 */

import '../scripts/_loadenv';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runNoticeEval } from './notices';
import { runContractEval } from './contracts/run';

const OUTPUT_PATH = join(__dirname, '..', 'eval-results.md');

type PackId = 'court-notice' | 'contract-review';

function parsePack(): PackId | 'all' {
  const arg = process.argv.find((a) => a.startsWith('--pack='));
  if (!arg) return 'all';
  const v = arg.slice('--pack='.length);
  if (v === 'court-notice' || v === 'contract-review') return v;
  console.error(`Unknown pack: ${v}. Use court-notice | contract-review.`);
  process.exit(1);
}

function header(opts: { packs: string[]; fixtureCounts: Record<string, number> }): string {
  const lines: string[] = [];
  lines.push('# MatterPilot — Eval Results');
  lines.push('');
  const meta = opts.packs.map((p) => `${p} (${opts.fixtureCounts[p] ?? 0})`).join(', ');
  lines.push(`_Generated: ${new Date().toISOString()}_  ·  packs: **${meta}**`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const pack = parsePack();
  const sections: string[] = [];
  const fixtureCounts: Record<string, number> = {};
  const packs: string[] = [];

  if (pack === 'all' || pack === 'court-notice') {
    console.log('Pack 1 — court-notice');
    const result = await runNoticeEval({
      onFixture: (stem, status, caseMatch, typeMatch) => {
        console.log(
          `  ${stem} ... ${status} (case ${caseMatch ? '✓' : '✗'}, type ${typeMatch ? '✓' : '✗'})`,
        );
      },
    });
    sections.push(result.section);
    fixtureCounts['court-notice'] = result.fixtureCount;
    packs.push('court-notice');
  }

  if (pack === 'all' || pack === 'contract-review') {
    console.log('\nPack 2 — contract-review');
    const result = await runContractEval({
      onFixture: (stem, status, clauseRecall, ruleRate) => {
        console.log(
          `  ${stem} ... ${status} (clause-recall ${(clauseRecall * 100).toFixed(0)}%, rule-match ${(ruleRate * 100).toFixed(0)}%)`,
        );
      },
    });
    sections.push(result.section);
    fixtureCounts['contract-review'] = result.fixtureCount;
    packs.push('contract-review');
  }

  const report = header({ packs, fixtureCounts }) + sections.join('\n\n---\n\n') + '\n';
  writeFileSync(OUTPUT_PATH, report);
  console.log(`\nResults written to ${OUTPUT_PATH}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
