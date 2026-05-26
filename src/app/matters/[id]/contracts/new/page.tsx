import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db, schema } from '@/db';
import { listPlaybooks } from '@/lib/packs/contract-review';
import { requireWorkspaceCtx } from '@/lib/workspace/context';
import { ContractUploadForm } from './upload-form';

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

export default async function NewContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireWorkspaceCtx();
  const matter = await loadMatter(ctx.workspaceId, id);
  if (!matter) notFound();

  const playbooks = listPlaybooks().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));

  return (
    <div className="flex-1 px-8 py-8 max-w-3xl">
      <header className="pb-6">
        <div className="text-xs text-muted-foreground mb-1">
          <Link href={`/matters/${matter.id}`} className="hover:underline">
            ← {matter.name}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Review a contract</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a contract, pick a playbook, and Pack 2 will run the same
          deterministic + LLM pipeline that ingests court notices.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New contract</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractUploadForm matterId={matter.id} playbooks={playbooks} />
        </CardContent>
      </Card>
    </div>
  );
}
