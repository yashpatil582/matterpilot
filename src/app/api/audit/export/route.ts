/**
 * Workspace-scoped audit log export.
 *
 *   GET /api/audit/export                  → CSV of every audit_event in the workspace
 *   GET /api/audit/export?since=2026-01-01 → events at-or-after the given ISO date
 *   GET /api/audit/export?entity=notice    → events for a specific entity type
 *
 * admin-only. The returned CSV has columns:
 *   at, entity, entity_id, actor, action, before, after
 * `before` and `after` are JSON-stringified; commas, quotes, and newlines
 * are escaped per RFC 4180. Stream as a single Response — the workspace
 * audit table is small enough for a one-shot dump in v1.
 */

import { and, asc, eq, gte } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireRole } from '@/lib/workspace/context';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'string') s = v;
  else if (v instanceof Date) s = v.toISOString();
  else s = JSON.stringify(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const ctx = await requireRole(['admin']);
  const url = new URL(req.url);
  const since = url.searchParams.get('since');
  const entity = url.searchParams.get('entity');

  const filters = [eq(schema.auditEvents.workspaceId, ctx.workspaceId)];
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      filters.push(gte(schema.auditEvents.at, sinceDate));
    }
  }
  if (entity) {
    filters.push(eq(schema.auditEvents.entity, entity));
  }

  const rows = await db
    .select({
      at: schema.auditEvents.at,
      entity: schema.auditEvents.entity,
      entityId: schema.auditEvents.entityId,
      actor: schema.auditEvents.actor,
      action: schema.auditEvents.action,
      before: schema.auditEvents.before,
      after: schema.auditEvents.after,
    })
    .from(schema.auditEvents)
    .where(and(...filters))
    .orderBy(asc(schema.auditEvents.at));

  const header = ['at', 'entity', 'entity_id', 'actor', 'action', 'before', 'after']
    .map(csvEscape)
    .join(',');
  const body = rows
    .map((r) =>
      [r.at, r.entity, r.entityId, r.actor, r.action, r.before, r.after]
        .map(csvEscape)
        .join(','),
    )
    .join('\n');

  const filename = `audit-${ctx.workspaceId.slice(0, 8)}-${isoDate(new Date())}.csv`;
  return new Response(`${header}\n${body}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
