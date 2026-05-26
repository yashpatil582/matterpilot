'use client';

import { useActionState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { askMatter, type AskMatterResult } from '../actions';

export function AskMatterCard({ matterId }: { matterId: string }) {
  const bound = askMatter.bind(null, matterId);
  const [state, action, pending] = useActionState<AskMatterResult | null, FormData>(
    bound,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Ask this matter{' '}
          <span className="text-xs text-muted-foreground font-normal">
            (RAG, scoped to this matter only)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="query" className="sr-only">
              Question
            </Label>
            <Input
              id="query"
              name="query"
              required
              disabled={pending}
              placeholder="What are our existing carve-outs for IP?"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Searching…' : 'Ask'}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Searches over chunks of every document on this matter. Cross-matter
          retrieval is impossible: every query is scoped by{' '}
          <span className="font-mono">workspace_id + matter_id</span>.
        </p>

        {state?.status === 'disabled' && (
          <div className="mt-4 rounded-md border border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/30 p-3 text-sm">
            RAG is disabled. Set <span className="font-mono">OPENAI_API_KEY</span>{' '}
            to enable embeddings, then re-index existing matter documents via
            the contract-upload flow.
          </div>
        )}

        {state?.status === 'ok' && state.chunks.length === 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            No relevant chunks found for{' '}
            <em>&ldquo;{state.query}&rdquo;</em>. Try uploading more documents
            to this matter or rephrasing.
          </div>
        )}

        {state?.status === 'ok' && state.chunks.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="text-xs text-muted-foreground">
              Top {state.chunks.length} for{' '}
              <em>&ldquo;{state.query}&rdquo;</em> · query{' '}
              <span className="font-mono">{state.queryId.slice(0, 8)}</span>
            </div>
            {state.chunks.map((c) => (
              <div
                key={c.chunkId}
                className="rounded-md border p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {c.documentName ?? '(unnamed document)'}
                    <span className="font-mono text-xs text-muted-foreground ml-2">
                      #{c.ordinal}
                    </span>
                  </div>
                  <Badge variant="outline" className="font-mono">
                    {(c.score * 100).toFixed(1)}%
                  </Badge>
                </div>
                <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted-foreground">
                  {c.content.length > 800
                    ? c.content.slice(0, 800) + '…'
                    : c.content}
                </blockquote>
                <div className="text-xs text-muted-foreground">{c.reason}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
