import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db, schema } from '@/db';
import { requireWorkspaceCtx } from '@/lib/workspace/context';
import { setLegalHold, setRetentionPolicy } from '../actions';

export const dynamic = 'force-dynamic';

const RETENTION_OPTIONS = ['30d', '90d', '1y', '7y', 'forever'] as const;

async function loadMatter(workspaceId: string, matterId: string) {
  const [row] = await db
    .select({
      id: schema.matters.id,
      name: schema.matters.name,
      clientName: schema.matters.clientName,
      status: schema.matters.status,
      retentionPolicy: schema.matters.retentionPolicy,
      legalHold: schema.matters.legalHold,
      createdAt: schema.matters.createdAt,
      caseId: schema.matters.caseId,
      caseNumber: schema.cases.caseNumber,
      debtorName: schema.cases.debtorName,
    })
    .from(schema.matters)
    .leftJoin(schema.cases, eq(schema.cases.id, schema.matters.caseId))
    .where(
      and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

async function loadNotices(workspaceId: string, matterId: string) {
  return db
    .select({
      id: schema.notices.id,
      type: schema.notices.type,
      status: schema.notices.status,
      confidence: schema.notices.confidence,
      receivedAt: schema.notices.receivedAt,
    })
    .from(schema.notices)
    .where(
      and(
        eq(schema.notices.matterId, matterId),
        eq(schema.notices.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(schema.notices.receivedAt))
    .limit(50);
}

async function loadTasks(workspaceId: string, matterId: string) {
  return db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      status: schema.tasks.status,
      dueAt: schema.tasks.dueAt,
      assignee: schema.tasks.assignee,
    })
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.matterId, matterId), eq(schema.tasks.workspaceId, workspaceId)),
    )
    .orderBy(desc(schema.tasks.dueAt))
    .limit(50);
}

async function loadAuditTrail(
  workspaceId: string,
  matterId: string,
  noticeIds: string[],
) {
  const ids = [matterId, ...noticeIds];
  if (ids.length === 0) return [];
  return db
    .select({
      id: schema.auditEvents.id,
      entity: schema.auditEvents.entity,
      entityId: schema.auditEvents.entityId,
      action: schema.auditEvents.action,
      actor: schema.auditEvents.actor,
      at: schema.auditEvents.at,
      after: schema.auditEvents.after,
    })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.workspaceId, workspaceId),
        inArray(schema.auditEvents.entityId, ids),
      ),
    )
    .orderBy(desc(schema.auditEvents.at))
    .limit(30);
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'routed') return 'default';
  if (status === 'suspicious') return 'destructive';
  if (status === 'needs_review') return 'secondary';
  return 'outline';
}

export default async function MatterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireWorkspaceCtx();
  const matter = await loadMatter(ctx.workspaceId, id);
  if (!matter) notFound();

  const [notices, tasks] = await Promise.all([
    loadNotices(ctx.workspaceId, matter.id),
    loadTasks(ctx.workspaceId, matter.id),
  ]);
  const audit = await loadAuditTrail(
    ctx.workspaceId,
    matter.id,
    notices.map((n) => n.id),
  );

  const canEdit = ctx.role === 'admin' || ctx.role === 'attorney';

  return (
    <div className="flex-1 px-8 py-8 max-w-6xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{matter.name}</h1>
            {matter.legalHold && <Badge variant="destructive">Legal hold</Badge>}
            <Badge variant="secondary" className="capitalize">
              {matter.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {matter.clientName ?? 'Unassigned client'}
            {matter.caseNumber ? ` · case ${matter.caseNumber}` : ''}
            {matter.debtorName ? ` · ${matter.debtorName}` : ''}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground space-y-1">
          <div>
            Opened{' '}
            {new Date(matter.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
          <div className="font-mono">retention: {matter.retentionPolicy}</div>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Governance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={setLegalHold} className="flex items-center gap-3">
            <input type="hidden" name="matterId" value={matter.id} />
            <input
              type="hidden"
              name="next"
              value={matter.legalHold ? 'false' : 'true'}
            />
            <div className="flex-1 text-sm">
              <div className="font-medium">Legal hold</div>
              <div className="text-xs text-muted-foreground">
                Prevents purge of any document on this matter, regardless of
                retention policy.
              </div>
            </div>
            <Button
              type="submit"
              variant={matter.legalHold ? 'destructive' : 'outline'}
              size="sm"
              disabled={!canEdit}
            >
              {matter.legalHold ? 'Release hold' : 'Place hold'}
            </Button>
          </form>

          <form
            action={setRetentionPolicy}
            className="flex items-center gap-3 border-t pt-4"
          >
            <input type="hidden" name="matterId" value={matter.id} />
            <div className="flex-1 text-sm">
              <div className="font-medium">Retention policy</div>
              <div className="text-xs text-muted-foreground">
                Auto-purge horizon for matter documents (overridden by legal
                hold).
              </div>
            </div>
            <select
              name="policy"
              defaultValue={matter.retentionPolicy}
              disabled={!canEdit}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {RETENTION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm" disabled={!canEdit}>
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Notices <span className="text-xs text-muted-foreground">({notices.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {notices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notices on this matter yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notices.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="text-sm">
                      <Link href={`/notices/${n.id}`} className="hover:underline">
                        {n.type ?? '—'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(n.status)} className="capitalize">
                        {n.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      {n.confidence != null ? n.confidence.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(n.receivedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Tasks <span className="text-xs text-muted-foreground">({tasks.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks on this matter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">{t.title}</TableCell>
                    <TableCell className="text-xs capitalize">
                      {t.status.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.assignee ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {t.dueAt
                        ? new Date(t.dueAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Audit trail{' '}
            <span className="text-xs text-muted-foreground">(last {audit.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit events yet.</p>
          ) : (
            <ol className="space-y-2">
              {audit.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-4 text-sm border-b pb-2 last:border-b-0"
                >
                  <div>
                    <div className="font-mono text-xs">
                      <span className="text-muted-foreground">{e.entity}</span>
                      <span className="px-1 text-muted-foreground">·</span>
                      <span className="font-medium">{e.action}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      by {e.actor}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
