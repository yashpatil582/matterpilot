/**
 * Tenancy guardrail — fails CI when a Drizzle query against a tenant table
 * does not include a workspaceId predicate.
 *
 * Heuristic: for each .ts/.tsx file under src/, find every occurrence of
 *   db.<select|insert|update|delete>
 * extract the call expression up to its balanced closing paren plus any
 * chained .where()/.values()/.returning(), then check that:
 *
 *   1. the substring references at least one tenant table
 *   2. the substring contains "workspaceId" or "workspace_id"
 *
 * False negatives exist (indirect queries via helpers) — the heuristic is
 * pragmatic, not exhaustive. A custom ESLint rule with AST traversal is a
 * Week 4 polish item.
 *
 * Run: `pnpm tenancy:check`
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

const TENANT_TABLES = [
  'workspaces',
  'matters',
  'documents',
  'cases',
  'notices',
  'parseRuns',
  'extractedEvents',
  'tasks',
  'reviewDecisions',
  'auditEvents',
  'senderPolicies',
  'workspaceMembers',
];

const TENANT_REGEX = new RegExp(
  `\\bschema\\.(${TENANT_TABLES.join('|')})\\b`,
  'g',
);

const EXEMPT_FILES = new Set<string>([
  // schema definition itself
  'src/db/schema.ts',
  // db client export — no queries
  'src/db/index.ts',
  // default ctx is a constant, not a query
  'src/lib/workflow/default-ctx.ts',
]);

type Violation = {
  file: string;
  line: number;
  snippet: string;
  reason: string;
};

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...walkTsFiles(full));
    } else if (
      st.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract the full Drizzle chain starting at `startIdx` (which points at the
 * `db.<verb>` token). Returns the substring covering the verb + its argument
 * list + any chained method calls + up to a terminator (`;`, `\n  );`, etc.)
 */
function sliceQueryChain(source: string, startIdx: number): { end: number; chain: string } {
  let i = startIdx;
  let depth = 0;
  let seenFirstParen = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '(') {
      depth++;
      seenFirstParen = true;
    } else if (c === ')') {
      depth--;
      if (seenFirstParen && depth === 0) {
        // After the first balanced call, allow chained method calls until
        // we hit a terminator that's not a method continuation.
        let j = i + 1;
        while (j < source.length) {
          // skip whitespace
          while (j < source.length && /\s/.test(source[j])) j++;
          if (source[j] === '.') {
            // chained method — find next balanced paren
            j++;
            // skip method name
            while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
            if (source[j] === '(') {
              let d = 1;
              j++;
              while (j < source.length && d > 0) {
                if (source[j] === '(') d++;
                else if (source[j] === ')') d--;
                j++;
              }
              i = j - 1;
              break;
            }
            // no paren — end of chain
            break;
          }
          break;
        }
        if (source[i + 1] !== '.') {
          return { end: i + 1, chain: source.slice(startIdx, i + 1) };
        }
      }
    }
    i++;
  }
  return { end: source.length, chain: source.slice(startIdx, source.length) };
}

function checkFile(absPath: string): Violation[] {
  const rel = relative(ROOT, absPath).replace(/\\/g, '/');
  if (EXEMPT_FILES.has(rel)) return [];
  const source = readFileSync(absPath, 'utf8');
  if (!source.includes('db.')) return [];

  const violations: Violation[] = [];
  const verbRegex = /\bdb\.(select|insert|update|delete)\b/g;
  let m: RegExpExecArray | null;
  while ((m = verbRegex.exec(source)) !== null) {
    const { chain, end } = sliceQueryChain(source, m.index);
    verbRegex.lastIndex = end;

    // Reset our table regex per chain since regex is stateful.
    const tableRefs = new Set<string>();
    let tm: RegExpExecArray | null;
    const tableRegex = new RegExp(TENANT_REGEX.source, 'g');
    while ((tm = tableRegex.exec(chain)) !== null) {
      tableRefs.add(tm[1]);
    }
    if (tableRefs.size === 0) continue;

    const hasWorkspaceId = /\bworkspaceId\b|\bworkspace_id\b/.test(chain);
    if (hasWorkspaceId) continue;

    const lineNo = source.slice(0, m.index).split('\n').length;
    violations.push({
      file: rel,
      line: lineNo,
      snippet: chain.slice(0, 140).replace(/\s+/g, ' ').trim(),
      reason: `query against ${Array.from(tableRefs).join(', ')} lacks workspaceId predicate`,
    });
  }
  return violations;
}

function main() {
  const files = walkTsFiles(SRC);
  let total = 0;
  let scanned = 0;
  const violations: Violation[] = [];
  for (const f of files) {
    scanned++;
    violations.push(...checkFile(f));
    total++;
  }
  if (violations.length === 0) {
    console.log(`tenancy:check — OK. Scanned ${scanned} files, ${total} queries reviewed.`);
    process.exit(0);
  }
  console.error(`tenancy:check — FAIL. ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.reason}`);
    console.error(`    ${v.snippet}\n`);
  }
  process.exit(1);
}

main();
