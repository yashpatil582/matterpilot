/**
 * Index a document for matter-scoped retrieval.
 *
 * Pipeline: chunk → embedMany → batch insert documentChunks rows scoped by
 * (workspaceId, matterId, documentId). Idempotent on (documentId, ordinal)
 * via a manual delete-then-insert so re-indexing doesn't pile up duplicates.
 *
 * Returns null if embeddings are disabled (OPENAI_API_KEY missing). Callers
 * should treat that as "RAG quietly off" and continue — the rest of the
 * upload path still works.
 */

// No `import 'server-only'`: this module is also reachable from CLI
// scripts (e.g. mcp/server.ts via retrieve.ts re-exports). DB access
// makes client-side import a non-starter anyway.
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { chunkText } from './chunk';
import { embedMany, isEmbeddingEnabled } from './embed';

export type IndexResult = {
  chunkCount: number;
  tokenCount: number;
  status: 'indexed' | 'skipped_disabled' | 'skipped_empty';
};

export async function indexDocument(args: {
  workspaceId: string;
  matterId: string | null;
  documentId: string;
  text: string;
}): Promise<IndexResult> {
  if (!isEmbeddingEnabled()) {
    return { chunkCount: 0, tokenCount: 0, status: 'skipped_disabled' };
  }
  const trimmed = args.text.trim();
  if (trimmed.length === 0) {
    return { chunkCount: 0, tokenCount: 0, status: 'skipped_empty' };
  }

  const chunks = chunkText(trimmed);
  if (chunks.length === 0) {
    return { chunkCount: 0, tokenCount: 0, status: 'skipped_empty' };
  }

  const embeddings = await embedMany(chunks.map((c) => c.content));
  if (!embeddings) {
    return { chunkCount: 0, tokenCount: 0, status: 'skipped_disabled' };
  }

  // Clear any prior chunks for this document so a re-index produces a
  // fresh, ordered set rather than appending.
  await db
    .delete(schema.documentChunks)
    .where(
      and(
        eq(schema.documentChunks.documentId, args.documentId),
        eq(schema.documentChunks.workspaceId, args.workspaceId),
      ),
    );

  const rows = chunks.map((c, i) => ({
    workspaceId: args.workspaceId,
    matterId: args.matterId,
    documentId: args.documentId,
    ordinal: c.ordinal,
    content: c.content,
    tokenCount: embeddings[i]?.tokens ?? c.approxTokens,
    embedding: embeddings[i]?.embedding ?? null,
  }));

  await db.insert(schema.documentChunks).values(rows);

  return {
    chunkCount: rows.length,
    tokenCount: rows.reduce((a, r) => a + (r.tokenCount ?? 0), 0),
    status: 'indexed',
  };
}
