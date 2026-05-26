import Link from 'next/link';
import { eq, sql } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
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

async function loadByRetention(workspaceId: string) {
  return db
    .select({
      retentionPolicy: schema.matters.retentionPolicy,
      matterCount: sql<number>`count(*)::int`,
      legalHoldCount: sql<number>`count(*) filter (where ${schema.matters.legalHold} = true)::int`,
    })
    .from(schema.matters)
    .where(eq(schema.matters.workspaceId, workspaceId))
    .groupBy(schema.matters.retentionPolicy)
    .orderBy(schema.matters.retentionPolicy);
}

async function loadLegalHoldMatters(workspaceId: string) {
  return db
    .select({
      id: schema.matters.id,
      name: schema.matters.name,
      clientName: schema.matters.clientName,
      retentionPolicy: schema.matters.retentionPolicy,
    })
    .from(schema.matters)
    .where(eq(schema.matters.workspaceId, workspaceId))
    .orderBy(schema.matters.name)
    .limit(50);
}

export default async function AdminRetentionPage() {
  const ctx = await requireWorkspaceCtx();
  const [rollup, all] = await Promise.all([
    loadByRetention(ctx.workspaceId),
    loadLegalHoldMatters(ctx.workspaceId),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention policy rollup</CardTitle>
        </CardHeader>
        <CardContent>
          {rollup.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matters yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead className="text-right">Matters</TableHead>
                  <TableHead className="text-right">Legal hold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rollup.map((r) => (
                  <TableRow key={r.retentionPolicy}>
                    <TableCell className="font-mono text-sm">{r.retentionPolicy}</TableCell>
                    <TableCell className="text-right text-sm">{r.matterCount}</TableCell>
                    <TableCell className="text-right">
                      {r.legalHoldCount > 0 ? (
                        <Badge variant="destructive">{r.legalHoldCount}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Retention controls the auto-purge horizon for matter documents.
            Legal hold pins a matter open regardless of retention; release
            requires admin or attorney role and is audit-logged.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All matters (with current policy)</CardTitle>
        </CardHeader>
        <CardContent>
          {all.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matters yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Matter</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Policy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">
                      <Link href={`/matters/${m.id}`} className="hover:underline">
                        {m.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{m.clientName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{m.retentionPolicy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
