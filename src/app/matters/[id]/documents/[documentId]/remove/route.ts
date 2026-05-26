import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { db, schema } from '@/db';
import { requireRole } from '@/lib/workspace/context';

async function redirectToMatter(request: NextRequest, matterId: string) {
  revalidatePath(`/matters/${matterId}`);
  return NextResponse.redirect(new URL(`/matters/${matterId}`, request.url), 303);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const ctx = await requireRole(['admin', 'attorney', 'paralegal']);
  const { id: matterId, documentId } = await params;
  if (!matterId || !documentId) {
    return redirectToMatter(request, matterId);
  }

  const [doc] = await db
    .select({
      id: schema.documents.id,
      kind: schema.documents.kind,
      name: schema.documents.name,
      sourceConnector: schema.documents.sourceConnector,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.workspaceId, ctx.workspaceId),
        eq(schema.documents.matterId, matterId),
      ),
    )
    .limit(1);

  if (!doc) {
    return redirectToMatter(request, matterId);
  }
  if (doc.kind === 'contract') {
    return redirectToMatter(request, matterId);
  }

  await db
    .delete(schema.documentChunks)
    .where(
      and(
        eq(schema.documentChunks.documentId, documentId),
        eq(schema.documentChunks.workspaceId, ctx.workspaceId),
      ),
    );

  await db
    .delete(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.workspaceId, ctx.workspaceId),
      ),
    );

  await db.insert(schema.auditEvents).values({
    workspaceId: ctx.workspaceId,
    entity: 'matter',
    entityId: matterId,
    actor: ctx.userEmail,
    action: 'document_removed',
    before: {
      documentId,
      name: doc.name,
      kind: doc.kind,
      sourceConnector: doc.sourceConnector,
    },
    after: {},
  });

  return redirectToMatter(request, matterId);
}
