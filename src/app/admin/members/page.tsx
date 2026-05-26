import { asc, eq } from 'drizzle-orm';
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

async function loadMembers(workspaceId: string) {
  return db
    .select({
      id: schema.workspaceMembers.id,
      email: schema.workspaceMembers.email,
      name: schema.workspaceMembers.name,
      role: schema.workspaceMembers.role,
      createdAt: schema.workspaceMembers.createdAt,
    })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(schema.workspaceMembers.email));
}

function roleVariant(role: string): 'default' | 'secondary' | 'outline' {
  if (role === 'admin') return 'default';
  if (role === 'attorney') return 'secondary';
  return 'outline';
}

export default async function AdminMembersPage() {
  const ctx = await requireWorkspaceCtx();
  const members = await loadMembers(ctx.workspaceId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Workspace members{' '}
          <span className="text-xs text-muted-foreground">({members.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm font-mono">{m.email}</TableCell>
                  <TableCell className="text-sm">{m.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={roleVariant(m.role)} className="capitalize">
                      {m.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(m.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Members are seeded for the demo. Invite + role-edit flows are a
          planned follow-up; today, edit via the database directly.
        </p>
      </CardContent>
    </Card>
  );
}
