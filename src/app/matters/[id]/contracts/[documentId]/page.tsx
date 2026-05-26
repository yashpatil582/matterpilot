import Link from 'next/link';
import { and, asc, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db, schema } from '@/db';
import { getPlaybook, type PlaybookRule } from '@/lib/packs/contract-review';
import { requireWorkspaceCtx } from '@/lib/workspace/context';

export const dynamic = 'force-dynamic';

const RISK_ORDER: Record<'high' | 'medium' | 'low', number> = {
  high: 0,
  medium: 1,
  low: 2,
};

async function loadDocument(workspaceId: string, matterId: string, documentId: string) {
  const [row] = await db
    .select({
      id: schema.documents.id,
      name: schema.documents.name,
      blobUrl: schema.documents.blobUrl,
      kind: schema.documents.kind,
      playbookId: schema.documents.playbookId,
      reviewStatus: schema.documents.reviewStatus,
      flaggedClauseCount: schema.documents.flaggedClauseCount,
      createdAt: schema.documents.createdAt,
      matterId: schema.documents.matterId,
      matterName: schema.matters.name,
    })
    .from(schema.documents)
    .leftJoin(schema.matters, eq(schema.matters.id, schema.documents.matterId))
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.workspaceId, workspaceId),
        eq(schema.documents.matterId, matterId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadClauses(workspaceId: string, documentId: string) {
  return db
    .select()
    .from(schema.contractClauses)
    .where(
      and(
        eq(schema.contractClauses.documentId, documentId),
        eq(schema.contractClauses.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(schema.contractClauses.ordinal));
}

async function loadAudit(workspaceId: string, documentId: string) {
  return db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      actor: schema.auditEvents.actor,
      at: schema.auditEvents.at,
      after: schema.auditEvents.after,
    })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.workspaceId, workspaceId),
        eq(schema.auditEvents.entityId, documentId),
      ),
    )
    .orderBy(desc(schema.auditEvents.at))
    .limit(30);
}

function riskVariant(risk: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (risk === 'high') return 'destructive';
  if (risk === 'medium') return 'secondary';
  if (risk === 'low') return 'outline';
  return 'default';
}

function statusVariant(
  status: string | null,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'needs_review') return 'secondary';
  if (status === 'auto_approved') return 'default';
  if (status === 'rejected') return 'destructive';
  return 'outline';
}

function formatClauseType(type: string): string {
  return type.replace(/_/g, ' ');
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id: matterId, documentId } = await params;
  const ctx = await requireWorkspaceCtx();

  const doc = await loadDocument(ctx.workspaceId, matterId, documentId);
  if (!doc) notFound();

  const [clauses, audit] = await Promise.all([
    loadClauses(ctx.workspaceId, documentId),
    loadAudit(ctx.workspaceId, documentId),
  ]);

  const playbook = doc.playbookId ? getPlaybook(doc.playbookId) : null;
  const rulesById = new Map<string, PlaybookRule>();
  if (playbook) {
    for (const r of playbook.rules) rulesById.set(r.id, r);
  }

  const sortedClauses = [...clauses].sort((a, b) => {
    const ra = RISK_ORDER[a.riskLevel as 'high' | 'medium' | 'low'] ?? 99;
    const rb = RISK_ORDER[b.riskLevel as 'high' | 'medium' | 'low'] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.ordinal - b.ordinal;
  });

  const summaryEvent = audit.find((e) => e.action === 'contract_reviewed');
  const summary =
    summaryEvent && typeof (summaryEvent.after as Record<string, unknown>)?.summary === 'string'
      ? ((summaryEvent.after as Record<string, unknown>).summary as string)
      : null;

  return (
    <div className="flex-1 px-8 py-8 max-w-5xl space-y-6">
      <header className="space-y-2">
        <div className="text-xs text-muted-foreground">
          <Link href={`/matters/${matterId}`} className="hover:underline">
            ← {doc.matterName ?? 'Matter'}
          </Link>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">
            {doc.name ?? 'Untitled contract'}
          </h1>
          <Badge variant={statusVariant(doc.reviewStatus)} className="capitalize">
            {(doc.reviewStatus ?? 'unknown').replace('_', ' ')}
          </Badge>
          {doc.flaggedClauseCount != null && doc.flaggedClauseCount > 0 && (
            <Badge variant="destructive">{doc.flaggedClauseCount} flagged</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Playbook:{' '}
          <span className="font-medium text-foreground">
            {playbook?.name ?? doc.playbookId ?? '—'}
          </span>{' '}
          · reviewed{' '}
          {new Date(doc.createdAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </header>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{summary}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Clauses{' '}
            <span className="text-xs text-muted-foreground">
              ({clauses.length} extracted, sorted high → low risk)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {clauses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clauses extracted. The LLM may have short-circuited; check the audit trail.
            </p>
          ) : (
            sortedClauses.map((c) => {
              const rule = c.matchedPlaybookRuleId
                ? rulesById.get(c.matchedPlaybookRuleId)
                : null;
              return (
                <div key={c.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">
                      #{c.ordinal}
                    </span>
                    <span className="text-sm font-medium capitalize">
                      {formatClauseType(c.clauseType)}
                    </span>
                    <Badge variant={riskVariant(c.riskLevel)} className="capitalize">
                      {c.riskLevel} risk
                    </Badge>
                    {c.confidence != null && (
                      <span className="text-xs font-mono text-muted-foreground">
                        confidence {c.confidence.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted-foreground">
                    {c.text}
                  </blockquote>

                  {c.reasoning && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Why: </span>
                      {c.reasoning}
                    </p>
                  )}

                  {rule && (
                    <p className="text-xs text-muted-foreground">
                      Matched rule:{' '}
                      <span className="font-mono">{rule.id}</span> — {rule.description}
                    </p>
                  )}

                  {c.redlineSuggestion && (
                    <div className="rounded-md border border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/30 p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
                        Suggested redline
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{c.redlineSuggestion}</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Audit trail{' '}
            <span className="text-xs text-muted-foreground">({audit.length})</span>
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
                      <span className="font-medium">{e.action}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">by {e.actor}</div>
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
