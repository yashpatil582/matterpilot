/**
 * Text chunker for the RAG pipeline.
 *
 * Splits on paragraph boundaries first, then merges adjacent paragraphs into
 * chunks targeting roughly `targetChars` characters each. Falls back to
 * hard-splitting long single paragraphs by sentence (or by character when no
 * sentence break is reachable) so no chunk exceeds `maxChars`.
 *
 * Why character heuristic instead of a real tokenizer: the input is contract
 * + email English; ~4 characters per token is a tight enough approximation
 * for choosing chunk boundaries, and it keeps this module dependency-free.
 * Embedding token usage is reported back from OpenAI directly.
 */

export type Chunk = {
  ordinal: number;
  content: string;
  approxTokens: number;
};

const DEFAULT_TARGET = 1600; // ~400 tokens
const DEFAULT_MAX = 2400; // ~600 tokens hard cap
const OVERLAP_CHARS = 200; // ~50 tokens of overlap between adjacent chunks

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitSentences(paragraph: string): string[] {
  // Conservative sentence splitter — keeps initials like "U.S." attached.
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function hardSplit(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + maxChars));
    i += maxChars;
  }
  return out;
}

export function chunkText(
  text: string,
  opts: { targetChars?: number; maxChars?: number; overlapChars?: number } = {},
): Chunk[] {
  const targetChars = opts.targetChars ?? DEFAULT_TARGET;
  const maxChars = opts.maxChars ?? DEFAULT_MAX;
  const overlapChars = opts.overlapChars ?? OVERLAP_CHARS;

  const paragraphs = splitParagraphs(text);
  // First flatten — break any single paragraph that exceeds maxChars into
  // sentence-bounded pieces (and char-split as a last resort).
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      pieces.push(p);
      continue;
    }
    const sentences = splitSentences(p);
    let buf = '';
    for (const s of sentences) {
      if (s.length > maxChars) {
        if (buf) {
          pieces.push(buf);
          buf = '';
        }
        pieces.push(...hardSplit(s, maxChars));
        continue;
      }
      if (buf.length + s.length + 1 > maxChars) {
        pieces.push(buf);
        buf = s;
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
    }
    if (buf) pieces.push(buf);
  }

  // Now greedily merge pieces into chunks at targetChars with overlap.
  const chunks: Chunk[] = [];
  let current = '';
  let ordinal = 0;
  const push = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      ordinal: ordinal++,
      content: trimmed,
      approxTokens: Math.ceil(trimmed.length / 4),
    });
  };

  for (const piece of pieces) {
    if (!current) {
      current = piece;
      continue;
    }
    if (current.length + piece.length + 2 <= targetChars) {
      current = `${current}\n\n${piece}`;
      continue;
    }
    push(current);
    // Carry forward the last overlapChars from the previous chunk so a
    // clause that straddles the boundary stays retrievable on both sides.
    const tail = current.slice(Math.max(0, current.length - overlapChars));
    current = tail ? `${tail}\n\n${piece}` : piece;
  }
  push(current);
  return chunks;
}
