/**
 * Word.run helpers narrowed to what the playbook flow uses.
 *
 *   readDocumentText() — pulls the full document body for the LLM call.
 *
 *   applyDiffs(diffs)  — for each diff, sets changeTrackingMode to TrackAll
 *                        then searches the body for the anchorText. If found,
 *                        inserts the newText with 'Replace' so Word records
 *                        it as a tracked change. Returns a per-diff outcome
 *                        the task pane uses to summarize what was applied.
 */

import type { ClauseDiff } from './api';

export type DiffOutcome = {
  ordinal: number;
  status: 'applied' | 'not_found' | 'skipped' | 'error';
  message?: string;
};

export async function readDocumentText(): Promise<string> {
  if (typeof Word === 'undefined') {
    throw new Error('Word host not available');
  }
  let text = '';
  await Word.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    text = body.text ?? '';
  });
  return text;
}

export async function applyDiffs(diffs: ClauseDiff[]): Promise<DiffOutcome[]> {
  if (typeof Word === 'undefined') {
    throw new Error('Word host not available');
  }
  const outcomes: DiffOutcome[] = [];

  await Word.run(async (context) => {
    // Track every insertion as a tracked change so the attorney accepts/
    // rejects them via the standard Review ribbon.
    context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
    await context.sync();

    for (const diff of diffs) {
      if (!diff.newText || diff.newText.trim().length === 0) {
        outcomes.push({ ordinal: diff.ordinal, status: 'skipped', message: 'empty redline' });
        continue;
      }
      try {
        // body.search accepts up to ~255 characters as a search string and
        // does not support real regex; if the anchor is too long, clip to a
        // distinctive prefix.
        const anchor = diff.anchorText.slice(0, 240);
        const found = context.document.body.search(anchor, {
          matchCase: false,
          matchWholeWord: false,
        });
        found.load('items');
        await context.sync();
        if (found.items.length === 0) {
          outcomes.push({ ordinal: diff.ordinal, status: 'not_found' });
          continue;
        }
        found.items[0].insertText(diff.newText, Word.InsertLocation.replace);
        await context.sync();
        outcomes.push({ ordinal: diff.ordinal, status: 'applied' });
      } catch (err) {
        outcomes.push({
          ordinal: diff.ordinal,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return outcomes;
}
