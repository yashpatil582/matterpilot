import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
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

export const dynamic = 'force-dynamic';

const ENTITY_FILTERS = [
  { value: '', label: 'All entities' },
  { value: 'notice', label: 'Notices' },
  { value: 'matter', label: 'Matters' },
  { value: 'document', label: 'Documents' },
];

async function loadEvents(workspaceId: string, entity?: string) {
  const filters = [eq(schema.auditEvents.workspaceId, workspaceId)];
  if (entity) filters.push(eq(schema.auditEvents.entity, entity));
  return db
    .select({
      id: schema.auditEvents.id,
      at: schema.auditEvents.at,
      entity: schema.auditEvents.entity,
      entityId: schema.auditEvents.entityId,
      actor: schema.auditEvents.actor,
      action: schema.auditEvents.action,
      after: schema.auditEvents.after,
    })
    .from(schema.auditEvents)
    .where(and(...filters))
    .orderBy(desc(schema.auditEvents.at))
    .limit(100);
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const ctx = await requireWorkspaceCtx();
  const { entity } = await searchParams;
  const filterValue = entity ?? '';
  const events = await loadEvents(ctx.workspaceId, filterValue || undefined);

  const exportHref = filterValue
    ? `/api/audit/export?entity=${encodeURIComponent(filterValue)}`
    : '/api/audit/export';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Recent audit events{' '}
          <span className="text-xs text-muted-foreground">(last 100)</span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <form className="flex items-center gap-2">
            <select
              name="entity"
              defaultValue={filterValue}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {ENTITY_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </form>
          <Link href={exportHref}>
            <Button size="sm">Download CSV</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit events yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead className="font-mono text-xs">Entity id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {e.entity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono">{e.action}</TableCell>
                  <TableCell className="text-xs">{e.actor}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {e.entityId.slice(0, 8)}…
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
