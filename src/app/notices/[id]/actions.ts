'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { buildTaskTitle, taskDueDate } from '@/lib/notice-pipeline/task';
import { requireWorkspaceCtx } from '@/lib/workspace/context';

export type ActionResult = { ok: true } | { ok: false; error: string };

type FieldChanges = {
  hearingAt: string | null;
  courtroom: string | null;
  virtualUrl: string | null;
  trustee: string | null;
  judge: string | null;
  deadline: string | null;
  docketSummary: string;
};

function parseIso(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function readFields(formData: FormData): FieldChanges {
  const get = (k: string): string | null => {
    const v = formData.get(k);
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    hearingAt: get('hearingAt'),
    courtroom: get('courtroom'),
    virtualUrl: get('virtualUrl'),
    trustee: get('trustee'),
    judge: get('judge'),
    deadline: get('deadline'),
    docketSummary: get('docketSummary') ?? '',
  };
}

async function loadNoticeScoped(workspaceId: string, noticeId: string) {
  const [row] = await db
    .select({
      id: schema.notices.id,
      workspaceId: schema.notices.workspaceId,
      matterId: schema.notices.matterId,
      caseId: schema.notices.caseId,
      type: schema.notices.type,
      status: schema.notices.status,
    })
    .from(schema.notices)
    .where(
      and(eq(schema.notices.id, noticeId), eq(schema.notices.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

async function loadEvent(workspaceId: string, noticeId: string) {
  const [ev] = await db
    .select()
    .from(schema.extractedEvents)
    .where(
      and(
        eq(schema.extractedEvents.noticeId, noticeId),
        eq(schema.extractedEvents.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return ev ?? null;
}

async function diffEvent(workspaceId: string, noticeId: string, next: FieldChanges) {
  const before = await loadEvent(workspaceId, noticeId);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (!before) return { changes, before: null };

  const beforeIso = (d: Date | null) => (d ? d.toISOString() : null);
  const compare: Record<string, [unknown, unknown]> = {
    hearingAt: [beforeIso(before.hearingAt), next.hearingAt],
    courtroom: [before.courtroom, next.courtroom],
    virtualUrl: [before.virtualUrl, next.virtualUrl],
    trustee: [before.trustee, next.trustee],
    judge: [before.judge, next.judge],
    deadline: [beforeIso(before.deadline), next.deadline],
    docketSummary: [before.docketSummary, next.docketSummary],
  };
  for (const [k, [a, b]] of Object.entries(compare)) {
    if (a !== b) changes[k] = { before: a, after: b };
  }
  return { changes, before };
}

export async function saveNoticeEdits(
  noticeId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceCtx();
    const notice = await loadNoticeScoped(ctx.workspaceId, noticeId);
    if (!notice) return { ok: false, error: 'Notice not found' };

    const next = readFields(formData);
    const { changes } = await diffEvent(ctx.workspaceId, noticeId, next);

    await db
      .update(schema.extractedEvents)
      .set({
        hearingAt: parseIso(next.hearingAt),
        courtroom: next.courtroom,
        virtualUrl: next.virtualUrl,
        trustee: next.trustee,
        judge: next.judge,
        deadline: parseIso(next.deadline),
        docketSummary: next.docketSummary,
      })
      .where(
        and(
          eq(schema.extractedEvents.noticeId, noticeId),
          eq(schema.extractedEvents.workspaceId, ctx.workspaceId),
        ),
      );

    if (Object.keys(changes).length > 0) {
      await db.insert(schema.reviewDecisions).values({
        workspaceId: ctx.workspaceId,
        noticeId,
        reviewerEmail: ctx.userEmail,
        fieldChanges: changes,
        notes: null,
      });

      await db.insert(schema.auditEvents).values({
        workspaceId: ctx.workspaceId,
        entity: 'notice',
        entityId: noticeId,
        actor: ctx.userEmail,
        action: 'edited',
        before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before])),
        after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after])),
      });
    }

    revalidatePath('/');
    revalidatePath(`/notices/${noticeId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'save failed' };
  }
}

export async function approveNotice(noticeId: string): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceCtx();
    const notice = await loadNoticeScoped(ctx.workspaceId, noticeId);
    if (!notice) return { ok: false, error: 'Notice not found' };
    if (notice.status === 'suspicious')
      return { ok: false, error: 'Suspicious notices cannot be approved' };
    if (notice.status === 'routed') return { ok: true };

    await db
      .update(schema.notices)
      .set({ status: 'routed' })
      .where(
        and(eq(schema.notices.id, noticeId), eq(schema.notices.workspaceId, ctx.workspaceId)),
      );

    // Generate follow-up Task only if one doesn't already exist (the ingest
    // path auto-creates a task for high-confidence routes; manual approve
    // covers the needs_review → routed path).
    const event = await loadEvent(ctx.workspaceId, noticeId);
    if (event && notice.caseId) {
      const [existing] = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.noticeId, noticeId),
            eq(schema.tasks.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);
      if (!existing) {
        await db.insert(schema.tasks).values({
          workspaceId: ctx.workspaceId,
          matterId: notice.matterId,
          caseId: notice.caseId,
          noticeId,
          title: buildTaskTitle(notice.type, event),
          description: event.docketSummary,
          dueAt: taskDueDate(event),
          assignee: ctx.userEmail,
          status: 'open',
        });
      }
    }

    await db.insert(schema.auditEvents).values({
      workspaceId: ctx.workspaceId,
      entity: 'notice',
      entityId: noticeId,
      actor: ctx.userEmail,
      action: 'approved',
      after: { status: 'routed' },
    });

    revalidatePath('/');
    revalidatePath('/review');
    revalidatePath(`/notices/${noticeId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'approve failed' };
  }
}

export async function rejectNotice(
  noticeId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceCtx();
    const notice = await loadNoticeScoped(ctx.workspaceId, noticeId);
    if (!notice) return { ok: false, error: 'Notice not found' };

    await db
      .update(schema.notices)
      .set({ status: 'suspicious' })
      .where(
        and(eq(schema.notices.id, noticeId), eq(schema.notices.workspaceId, ctx.workspaceId)),
      );

    // Cancel any tasks the ingest path auto-created. A rejected notice
    // shouldn't leave dangling work on the case timeline.
    await db
      .update(schema.tasks)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(schema.tasks.noticeId, noticeId),
          eq(schema.tasks.status, 'open'),
          eq(schema.tasks.workspaceId, ctx.workspaceId),
        ),
      );

    await db.insert(schema.reviewDecisions).values({
      workspaceId: ctx.workspaceId,
      noticeId,
      reviewerEmail: ctx.userEmail,
      fieldChanges: {},
      notes: reason,
    });

    await db.insert(schema.auditEvents).values({
      workspaceId: ctx.workspaceId,
      entity: 'notice',
      entityId: noticeId,
      actor: ctx.userEmail,
      action: 'rejected',
      after: { status: 'suspicious', reason },
    });

    revalidatePath('/');
    revalidatePath('/review');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'reject failed' };
  }
}

export async function redirectToInbox() {
  redirect('/');
}
