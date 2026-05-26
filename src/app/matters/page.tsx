import Link from 'next/link';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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

export const dynamic = 'force-dynamic';

async function getMatters(workspaceId: string) {
  return db
    .select({
      id: schema.matters.id,
      name: schema.matters.name,
      clientName: schema.matters.clientName,
      status: schema.matters.status,
      retentionPolicy: schema.matters.retentionPolicy,
      legalHold: schema.matters.legalHold,
      createdAt: schema.matters.createdAt,
      noticeCount: sql<number>`count(${schema.notices.id})::int`.as('notice_count'),
      lastNoticeAt: sql<Date | null>`max(${schema.notices.receivedAt})`.as('last_notice_at'),
    })
    .from(schema.matters)
    .leftJoin(
      schema.notices,
      and(
        eq(schema.notices.matterId, schema.matters.id),
        eq(schema.notices.workspaceId, workspaceId),
      ),
    )
    .where(eq(schema.matters.workspaceId, workspaceId))
    .groupBy(schema.matters.id)
    .orderBy(desc(sql`max(${schema.notices.receivedAt})`), desc(schema.matters.createdAt))
    .limit(200);
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'open') return 'default';
  if (status === 'closed') return 'outline';
  return 'secondary';
}

export default async function MattersIndexPage() {
  const ctx = await requireWorkspaceCtx();
  const matters = await getMatters(ctx.workspaceId);

  return (
    <div className="flex-1 px-8 py-8 max-w-6xl">
      <header className="pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Matters</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every matter in your workspace, newest activity first.
          </p>
        </div>
      </header>

      {matters.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No matters yet. The seed creates one matter per existing case;
            ingest a notice to create a new case + matter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Matter</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Retention</TableHead>
                <TableHead className="text-right">Notices</TableHead>
                <TableHead className="text-right">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matters.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm">
                    <Link
                      href={`/matters/${m.id}`}
                      className="font-medium hover:underline"
                    >
                      {m.name}
                    </Link>
                    {m.legalHold && (
                      <Badge variant="destructive" className="ml-2 text-[10px]">
                        Legal hold
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{m.clientName ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(m.status)} className="capitalize">
                      {m.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {m.retentionPolicy}
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono">
                    {m.noticeCount}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {m.lastNoticeAt
                      ? new Date(m.lastNoticeAt).toLocaleDateString('en-US', {
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
        </Card>
      )}
    </div>
  );
}
