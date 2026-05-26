'use server';

import { and, eq } from 'drizzle-orm';
import { put } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { getConnectorSession } from '@/lib/connectors/all';
import { indexDocument } from '@/lib/rag/index';
import { requireWorkspaceCtx } from '@/lib/workspace/context';

async function ensureMatter(workspaceId: string, matterId: string) {
  const [m] = await db
    .select({ id: schema.matters.id, name: schema.matters.name })
    .from(schema.matters)
    .where(
      and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, workspaceId)),
    )
    .limit(1);
  return m ?? null;
}

function isTextLike(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/pdf' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

function decoderForMime(mime: string): TextDecoder | null {
  // Embeddings need plain text. For the mocked adapters, payloads are
  // synthetic UTF-8; we decode and feed to RAG. Real .docx / .pdf would
  // need OCR / docx text extraction in a future iteration.
  if (mime.startsWith('text/')) return new TextDecoder('utf-8');
  return null;
}

/**
 * Pull a document from a registered connector into the matter:
 * fetchDocument → upload to private Vercel Blob → insert documents row →
 * audit_events row → best-effort RAG indexing for text payloads.
 */
export async function pullDocumentIntoMatter(formData: FormData) {
  const ctx = await requireWorkspaceCtx();
  const matterId = String(formData.get('matterId') ?? '');
  const connectorId = String(formData.get('connectorId') ?? '');
  const ref = String(formData.get('ref') ?? '');
  if (!matterId || !connectorId || !ref) {
    throw new Error('matterId, connectorId, and ref are required');
  }

  const matter = await ensureMatter(ctx.workspaceId, matterId);
  if (!matter) throw new Error('Matter not found in this workspace');

  const { connector, session } = await getConnectorSession(connectorId, ctx);
  const fetched = await connector.fetchDocument(session, ref);

  const blob = await put(
    `connectors/${connectorId}/${Date.now()}-${encodeURIComponent(fetched.name)}`,
    new Blob([fetched.bytes as BlobPart], { type: fetched.mime }),
    { access: 'private', addRandomSuffix: true, contentType: fetched.mime },
  );

  const [doc] = await db
    .insert(schema.documents)
    .values({
      workspaceId: ctx.workspaceId,
      matterId,
      kind: 'connector_import',
      sourceConnector: connectorId,
      sourceRef: ref,
      blobUrl: blob.url,
      name: fetched.name,
      mimeType: fetched.mime,
      bytes: fetched.bytes.byteLength,
    })
    .returning({ id: schema.documents.id });

  await db.insert(schema.auditEvents).values({
    workspaceId: ctx.workspaceId,
    entity: 'document',
    entityId: doc.id,
    actor: ctx.userEmail,
    action: 'pulled_from_connector',
    after: {
      connectorId,
      sourceRef: ref,
      matterId,
      bytes: fetched.bytes.byteLength,
      mime: fetched.mime,
    },
  });

  if (isTextLike(fetched.mime)) {
    const decoder = decoderForMime(fetched.mime);
    if (decoder) {
      try {
        const text = decoder.decode(fetched.bytes);
        await indexDocument({
          workspaceId: ctx.workspaceId,
          matterId,
          documentId: doc.id,
          text,
        });
      } catch (e) {
        console.warn(
          'RAG indexing failed for connector import (non-fatal):',
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  revalidatePath(`/matters/${matterId}`);
  redirect(`/matters/${matterId}`);
}
