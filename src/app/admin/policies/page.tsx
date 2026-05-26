import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listPlaybooks } from '@/lib/packs/contract-review';

export const dynamic = 'force-dynamic';

function severityVariant(s: string): 'destructive' | 'secondary' | 'outline' {
  if (s === 'high') return 'destructive';
  if (s === 'medium') return 'secondary';
  return 'outline';
}

export default async function AdminPoliciesPage() {
  const playbooks = listPlaybooks();

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Playbooks encode the firm&apos;s negotiating positions and feed Pack 2
        (Contract Playbook Review). They live in code today; per-workspace
        edits via an admin UI is a planned follow-up.
      </p>
      {playbooks.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{p.name}</CardTitle>
              <span className="text-xs font-mono text-muted-foreground">{p.id}</span>
            </div>
            <CardDescription>{p.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Applicable clause types:{' '}
              <span className="font-mono">{p.applicableClauseTypes.join(', ')}</span>
            </div>
            <div className="space-y-2">
              {p.rules.map((r) => (
                <div key={r.id} className="border rounded-md p-3 text-sm space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
                      <span className="font-medium capitalize">
                        {r.clauseType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <Badge variant={severityVariant(r.severity)} className="capitalize">
                      {r.severity}
                    </Badge>
                  </div>
                  <p className="text-sm">{r.description}</p>
                  <div className="text-xs space-y-1">
                    {r.must.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">must contain: </span>
                        <span className="font-mono">{r.must.join(', ')}</span>
                      </div>
                    )}
                    {r.mustNot.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">must not contain: </span>
                        <span className="font-mono">{r.mustNot.join(', ')}</span>
                      </div>
                    )}
                  </div>
                  <div className="rounded border border-amber-400/40 bg-amber-50/30 dark:bg-amber-950/20 p-2 text-xs">
                    <span className="font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400 mr-1">
                      Suggested redline
                    </span>
                    {r.suggestedRedline}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
