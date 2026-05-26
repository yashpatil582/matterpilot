import Link from 'next/link';
import { eq, sql } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db, schema } from '@/db';
import { requireWorkspaceCtx } from '@/lib/workspace/context';

export const dynamic = 'force-dynamic';

async function getCount(table: typeof schema.matters | typeof schema.workspaceMembers | typeof schema.documents | typeof schema.auditEvents, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.workspaceId, workspaceId));
  return row?.count ?? 0;
}

export default async function AdminHome() {
  const ctx = await requireWorkspaceCtx();
  const [matterCount, memberCount, documentCount, auditCount] = await Promise.all([
    getCount(schema.matters, ctx.workspaceId),
    getCount(schema.workspaceMembers, ctx.workspaceId),
    getCount(schema.documents, ctx.workspaceId),
    getCount(schema.auditEvents, ctx.workspaceId),
  ]);

  const tiles = [
    { label: 'Matters', value: matterCount, href: '/matters' },
    { label: 'Members', value: memberCount, href: '/admin/members' },
    { label: 'Documents', value: documentCount, href: '/admin/audit' },
    { label: 'Audit events', value: auditCount, href: '/admin/audit' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {tiles.map((t) => (
        <Link key={t.label} href={t.href}>
          <Card className="hover:bg-accent/30 transition-colors">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground font-normal">
                {t.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight">{t.value}</div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
