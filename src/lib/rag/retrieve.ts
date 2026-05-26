/**
 * Matter-scoped retrieval over document_chunks.
 *
 * 1. Embed the query.
 * 2. Cosine-similarity SQL: order by `embedding <=> $1` scoped by
 *    (workspaceId, matterId). The two scope predicates are non-negotiable —
 *    cross-matter retrieval is an ethical-wall breach in a legal product.
 * 3. Record each returned chunk as a retrieval_citations row so admins can
 *    audit "what did MatterPilot show this attorney, when, and why?"
 *
 * Returns an empty result with status='disabled' when embeddings are off
 * so the UI can surface "RAG disabled — set OPENAI_API_KEY" without
 * exploding.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { embedOne, isEmbeddingEnabled } from './embed';

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentName: string | null;
  ordinal: number;
  content: string;
  score: number;
  reason: string;
};

export type RetrieveResult = {
  queryId: string;
  status: 'ok' | 'disabled' | 'empty';
  chunks: RetrievedChunk[];
};

export async function retrieveForMatter(args: {
  workspaceId: string;
  matterId: string;
  query: string;
  k?: number;
}): Promise<RetrieveResult> {
  const queryId = randomUUID();
  if (!isEmbeddingEnabled()) {
    return { queryId, status: 'disabled', chunks: [] };
  }
  const query = args.query.trim();
  if (!query) {
    return { queryId, status: 'empty', chunks: [] };
  }
  const embedded = await embedOne(query);
  if (!embedded) {
    return { queryId, status: 'disabled', chunks: [] };
  }
  const k = Math.max(1, Math.min(args.k ?? 5, 20));

  // pgvector cosine distance: smaller = more similar. We convert to a
  // similarity score (1 - distance) so the UI can render percent-style.
  // Drizzle doesn't have first-class cosine-distance helpers; raw SQL is
  // the cleanest path here.
  const vectorLiteral = `[${embedded.embedding.join(',')}]`;
  const rows = await db.execute<{
    chunk_id: string;
    document_id: string;
    document_name: string | null;
    ordinal: number;
    content: string;
    distance: number;
  }>(sql`
    select
      c.id          as chunk_id,
      c.document_id as document_id,
      d.name        as document_name,
      c.ordinal     as ordinal,
      c.content     as content,
      c.embedding <=> ${vectorLiteral}::vector as distance
    from document_chunks c
    left join documents d on d.id = c.document_id
    where c.workspace_id = ${args.workspaceId}::uuid
      and c.matter_id    = ${args.matterId}::uuid
      and c.embedding is not null
    order by c.embedding <=> ${vectorLiteral}::vector asc
    limit ${k}
  `);

  const chunks: RetrievedChunk[] = rows.map((r) => {
    const distance = Number(r.distance);
    const score = Math.max(0, Math.min(1, 1 - distance));
    return {
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentName: r.document_name,
      ordinal: r.ordinal,
      content: r.content,
      score,
      reason: `cosine similarity ${(score * 100).toFixed(1)}%`,
    };
  });

  if (chunks.length > 0) {
    await db.insert(schema.retrievalCitations).values(
      chunks.map((c) => ({
        workspaceId: args.workspaceId,
        matterId: args.matterId,
        queryId,
        chunkId: c.chunkId,
        score: c.score,
        reason: c.reason,
      })),
    );
  }

  return { queryId, status: 'ok', chunks };
}
