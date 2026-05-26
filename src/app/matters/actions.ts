'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { requireRole, requireWorkspaceCtx } from '@/lib/workspace/context';

const RETENTION_VALUES = new Set(['30d', '90d', '1y', '7y', 'forever']);
type RetentionPolicy = '30d' | '90d' | '1y' | '7y' | 'forever';

async function writeAudit(args: {
  workspaceId: string;
  entityId: string;
  actor: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  await db.insert(schema.auditEvents).values({
    workspaceId: args.workspaceId,
    entity: 'matter',
    entityId: args.entityId,
    actor: args.actor,
    action: args.action,
    before: args.before,
    after: args.after,
  });
}

async function loadMatterScoped(workspaceId: string, matterId: string) {
  const [row] = await db
    .select({
      id: schema.matters.id,
      legalHold: schema.matters.legalHold,
      retentionPolicy: schema.matters.retentionPolicy,
      status: schema.matters.status,
    })
    .from(schema.matters)
    .where(and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function setLegalHold(formData: FormData) {
  const ctx = await requireRole(['admin', 'attorney']);
  const matterId = String(formData.get('matterId') ?? '');
  const next = String(formData.get('next') ?? '') === 'true';
  if (!matterId) return;

  const before = await loadMatterScoped(ctx.workspaceId, matterId);
  if (!before) throw new Error('Matter not found in this workspace');
  if (before.legalHold === next) return;

  await db
    .update(schema.matters)
    .set({ legalHold: next })
    .where(
      and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, ctx.workspaceId)),
    );

  await writeAudit({
    workspaceId: ctx.workspaceId,
    entityId: matterId,
    actor: ctx.userEmail,
    action: next ? 'legal_hold_placed' : 'legal_hold_released',
    before: { legalHold: before.legalHold },
    after: { legalHold: next },
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath('/matters');
}

export async function setRetentionPolicy(formData: FormData) {
  const ctx = await requireRole(['admin', 'attorney']);
  const matterId = String(formData.get('matterId') ?? '');
  const policy = String(formData.get('policy') ?? '');
  if (!matterId || !RETENTION_VALUES.has(policy)) return;

  const before = await loadMatterScoped(ctx.workspaceId, matterId);
  if (!before) throw new Error('Matter not found in this workspace');
  if (before.retentionPolicy === policy) return;

  await db
    .update(schema.matters)
    .set({ retentionPolicy: policy as RetentionPolicy })
    .where(
      and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, ctx.workspaceId)),
    );

  await writeAudit({
    workspaceId: ctx.workspaceId,
    entityId: matterId,
    actor: ctx.userEmail,
    action: 'retention_policy_updated',
    before: { retentionPolicy: before.retentionPolicy },
    after: { retentionPolicy: policy },
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath('/matters');
}

export async function createMatter(formData: FormData) {
  const ctx = await requireRole(['admin', 'attorney']);
  const name = String(formData.get('name') ?? '').trim();
  const clientName = String(formData.get('clientName') ?? '').trim() || null;
  if (!name) return;

  const [created] = await db
    .insert(schema.matters)
    .values({
      workspaceId: ctx.workspaceId,
      name,
      clientName,
      status: 'open',
      retentionPolicy: '7y',
      legalHold: false,
    })
    .returning({ id: schema.matters.id });

  await writeAudit({
    workspaceId: ctx.workspaceId,
    entityId: created.id,
    actor: ctx.userEmail,
    action: 'created',
    before: {},
    after: { name, clientName, status: 'open', retentionPolicy: '7y' },
  });

  revalidatePath('/matters');
  redirect(`/matters/${created.id}`);
}

// Re-export the ctx require for use by other matter-bound server actions.
export { requireWorkspaceCtx };
