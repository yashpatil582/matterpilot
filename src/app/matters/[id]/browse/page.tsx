import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db, schema } from '@/db';
import { getConnectorSession, listConnectors } from '@/lib/connectors/all';
import type { FolderRef } from '@/lib/connectors/types';
import { requireWorkspaceCtx } from '@/lib/workspace/context';
import { pullDocumentIntoMatter } from './actions';

export const dynamic = 'force-dynamic';

async function loadMatter(workspaceId: string, matterId: string) {
  const [row] = await db
    .select({ id: schema.matters.id, name: schema.matters.name })
    .from(schema.matters)
    .where(
      and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

function authBadge(mode: string): { variant: 'default' | 'secondary' | 'outline'; label: string } {
  if (mode === 'mock') return { variant: 'outline', label: 'mock' };
  if (mode === 'oauth2-obo') return { variant: 'secondary', label: 'oauth2 OBO' };
  if (mode === 'oauth2-pkce') return { variant: 'secondary', label: 'oauth2 PKCE' };
  if (mode === 'saml-then-oauth') return { variant: 'secondary', label: 'saml + oauth' };
  return { variant: 'default', label: mode };
}

function adapterPath(connectorId: string): string {
  return `src/lib/connectors/adapters/${connectorId}/`;
}

/**
 * Walk back up the folder tree by repeatedly listing the parent's children
 * and finding the matching id. The mocked adapters all carry parentId on
 * each FolderRef, so we can build a breadcrumb without an extra endpoint.
 */
async function buildBreadcrumbs(
  connector: ReturnType<typeof listConnectors>[number],
  session: Awaited<ReturnType<typeof getConnectorSession>>['session'],
  folderId: string,
): Promise<FolderRef[]> {
  const all: FolderRef[] = [];
  const seen = new Set<string | undefined>();
  const queue: (string | undefined)[] = [undefined];
  while (queue.length > 0) {
    const parent = queue.shift();
    if (seen.has(parent)) continue;
    seen.add(parent);
    const folders = await connector.listFolders(session, parent);
    for (const f of folders) {
      all.push(f);
      queue.push(f.id);
    }
  }
  const byId = new Map(all.map((f) => [f.id, f]));
  const trail: FolderRef[] = [];
  let cursor: string | null = folderId;
  while (cursor) {
    const f = byId.get(cursor);
    if (!f) break;
    trail.unshift(f);
    cursor = f.parentId;
  }
  return trail;
}

export default async function MatterBrowsePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connector?: string; folder?: string }>;
}) {
  const { id: matterId } = await params;
  const { connector: connectorId, folder } = await searchParams;

  const ctx = await requireWorkspaceCtx();
  const matter = await loadMatter(ctx.workspaceId, matterId);
  if (!matter) notFound();

  const connectors = listConnectors();

  // No connector picked yet — show the picker grid.
  if (!connectorId) {
    return (
      <div className="flex-1 px-8 py-8 max-w-4xl space-y-6">
        <header className="space-y-1">
          <div className="text-xs text-muted-foreground">
            <Link href={`/matters/${matter.id}`} className="hover:underline">
              ← {matter.name}
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Browse external vaults
          </h1>
          <p className="text-sm text-muted-foreground">
            All four vendor connectors are mocked. Code paths follow the real
            vendor API shapes — search the repo for{' '}
            <span className="font-mono">REAL:</span> comments to audit
            fidelity.
          </p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {connectors.map((c) => {
            const auth = authBadge(c.authMode);
            return (
              <Link
                key={c.id}
                href={`/matters/${matter.id}/browse?connector=${c.id}`}
              >
                <Card className="hover:bg-accent/30 transition-colors h-full">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{c.displayName}</CardTitle>
                      <Badge variant={auth.variant}>{auth.label}</Badge>
                    </div>
                    <CardDescription className="text-xs">
                      {c.describe()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs font-mono text-muted-foreground">
                      {adapterPath(c.id)}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // A connector is picked — drill into its folder tree.
  const { connector, session } = await getConnectorSession(connectorId, ctx);
  const auth = authBadge(connector.authMode);
  const folders = await connector.listFolders(session, folder);
  const docs = folder ? await connector.listDocuments(session, folder) : [];
  const trail = folder ? await buildBreadcrumbs(connector, session, folder) : [];

  const linkTo = (folderId?: string) => {
    const u = new URLSearchParams({ connector: connectorId });
    if (folderId) u.set('folder', folderId);
    return `/matters/${matter.id}/browse?${u.toString()}`;
  };

  return (
    <div className="flex-1 px-8 py-8 max-w-5xl space-y-6">
      <header className="space-y-2">
        <div className="text-xs text-muted-foreground">
          <Link href={`/matters/${matter.id}`} className="hover:underline">
            ← {matter.name}
          </Link>{' '}
          ·{' '}
          <Link href={`/matters/${matter.id}/browse`} className="hover:underline">
            change vault
          </Link>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">
            {connector.displayName}
          </h1>
          <Badge variant={auth.variant}>{auth.label}</Badge>
          <Badge variant="outline">mocked</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{connector.describe()}</p>
      </header>

      <Card>
        <CardContent className="py-3 text-xs">
          <span className="font-medium">Honest mock disclosure:</span> the
          responses below come from in-process fixtures. Every API call this
          adapter would make in production is annotated with a{' '}
          <span className="font-mono">/* REAL: ... */</span> comment in{' '}
          <span className="font-mono">{adapterPath(connectorId)}</span>. Run{' '}
          <span className="font-mono">grep -rn &quot;REAL:&quot; {adapterPath(connectorId)}</span>{' '}
          to audit against vendor docs.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-normal text-muted-foreground">
            Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm">
            <Link href={linkTo()} className="hover:underline">
              {connector.displayName}
            </Link>
            {trail.map((f) => (
              <span key={f.id}>
                <span className="text-muted-foreground"> / </span>
                <Link href={linkTo(f.id)} className="hover:underline">
                  {f.name}
                </Link>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Folders <span className="text-xs text-muted-foreground">({folders.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subfolders here.</p>
          ) : (
            <ul className="space-y-1">
              {folders.map((f) => (
                <li key={f.id}>
                  <Link
                    href={linkTo(f.id)}
                    className="text-sm hover:underline"
                  >
                    📁 {f.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {folder && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Documents{' '}
              <span className="text-xs text-muted-foreground">({docs.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No documents in this folder.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Bytes</TableHead>
                    <TableHead className="text-right">Modified</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm">{d.name}</TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {d.bytes.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(d.modifiedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <form action={pullDocumentIntoMatter}>
                          <input type="hidden" name="matterId" value={matter.id} />
                          <input
                            type="hidden"
                            name="connectorId"
                            value={connectorId}
                          />
                          <input type="hidden" name="ref" value={d.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Pull into matter
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!folder && folders.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No top-level folders exposed by this connector&apos;s mock data.
            See{' '}
            <span className="font-mono">{adapterPath(connectorId)}</span>{' '}
            to extend the fixture tree.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
