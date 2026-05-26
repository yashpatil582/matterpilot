import { and, eq } from 'drizzle-orm';
import { put } from '@vercel/blob';
import { db, schema } from '@/db';
import {
  corsPreflight,
  jsonResponse,
  withAddinAuth,
} from '@/lib/addins/auth';

export const OPTIONS = corsPreflight;

const MAX_BYTES_PER_ATTACHMENT = 10 * 1024 * 1024;

type Attachment = {
  name: string;
  mime: string;
  base64: string;
};

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const binary = Buffer.from(b64, 'base64');
    return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
  } catch {
    return null;
  }
}

/**
 * Outlook add-in's "File to matter" endpoint.
 *
 * Posts {matterId, subject, bodyText, attachments} from the Outlook task pane:
 *   - The thread body becomes one documents row (kind='email').
 *   - Each attachment becomes another documents row tied to the same matter.
 *   - One audit_events row captures the filing action.
 *
 * Tenant-scoped: the matter is verified to belong to the X-MatterPilot-User's
 * workspace before any insert happens.
 */
export const POST = withAddinAuth(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as {
    matterId?: string;
    subject?: string;
    bodyText?: string;
    attachments?: Attachment[];
  } | null;

  if (!body || typeof body.matterId !== 'string') {
    return jsonResponse({ error: 'matterId required' }, 400);
  }

  const [matter] = await db
    .select({ id: schema.matters.id, name: schema.matters.name })
    .from(schema.matters)
    .where(
      and(
        eq(schema.matters.id, body.matterId),
        eq(schema.matters.workspaceId, ctx.workspaceId),
      ),
    )
    .limit(1);
  if (!matter) {
    return jsonResponse({ error: 'Matter not found in this workspace' }, 403);
  }

  const subject = (body.subject ?? '').slice(0, 500);
  const threadText = (body.bodyText ?? '').slice(0, 200_000);
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  const documentIds: string[] = [];

  // The email body itself.
  if (threadText.trim().length > 0) {
    const blob = await put(
      `outlook/${Date.now()}-${encodeURIComponent(subject || 'thread')}.txt`,
      threadText,
      { access: 'private', addRandomSuffix: true, contentType: 'text/plain' },
    );
    const [doc] = await db
      .insert(schema.documents)
      .values({
        workspaceId: ctx.workspaceId,
        matterId: matter.id,
        kind: 'email',
        sourceConnector: 'outlook',
        sourceRef: subject,
        blobUrl: blob.url,
        name: subject || '(no subject)',
        mimeType: 'text/plain',
        bytes: threadText.length,
      })
      .returning({ id: schema.documents.id });
    documentIds.push(doc.id);
  }

  // Each attachment.
  for (const att of attachments) {
    if (typeof att?.name !== 'string' || typeof att?.base64 !== 'string') continue;
    const bytes = decodeBase64(att.base64);
    if (!bytes) continue;
    if (bytes.byteLength > MAX_BYTES_PER_ATTACHMENT) {
      return jsonResponse(
        { error: `Attachment ${att.name} exceeds ${MAX_BYTES_PER_ATTACHMENT} bytes` },
        413,
      );
    }
    const blob = await put(
      `outlook/${Date.now()}-${encodeURIComponent(att.name)}`,
      new Blob([bytes as BlobPart], { type: att.mime || 'application/octet-stream' }),
      { access: 'private', addRandomSuffix: true, contentType: att.mime || 'application/octet-stream' },
    );
    const [doc] = await db
      .insert(schema.documents)
      .values({
        workspaceId: ctx.workspaceId,
        matterId: matter.id,
        kind: 'attachment',
        sourceConnector: 'outlook',
        sourceRef: att.name,
        blobUrl: blob.url,
        name: att.name,
        mimeType: att.mime || 'application/octet-stream',
        bytes: bytes.byteLength,
      })
      .returning({ id: schema.documents.id });
    documentIds.push(doc.id);
  }

  await db.insert(schema.auditEvents).values({
    workspaceId: ctx.workspaceId,
    entity: 'matter',
    entityId: matter.id,
    actor: ctx.userEmail,
    action: 'filed_email_thread',
    after: {
      subject,
      attachmentCount: attachments.length,
      documentIds,
      source: 'outlook-addin',
    },
  });

  return jsonResponse({
    matterId: matter.id,
    matterName: matter.name,
    documentIds,
  });
});
