'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { uploadContract, type UploadResult } from './actions';

type PlaybookOption = {
  id: string;
  name: string;
  description: string;
};

export function ContractUploadForm({
  matterId,
  playbooks,
}: {
  matterId: string;
  playbooks: PlaybookOption[];
}) {
  const boundAction = uploadContract.bind(null, matterId);
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(
    boundAction,
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="playbookId">Playbook</Label>
        <select
          id="playbookId"
          name="playbookId"
          required
          disabled={pending}
          defaultValue={playbooks[0]?.id ?? ''}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {playbooks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          The playbook encodes your firm&apos;s negotiating positions. The LLM
          applies its rules clause-by-clause.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="file">Contract file</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,.pdf,text/plain,.txt"
          required
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          PDF or .txt up to 10MB. The clauses are extracted, classified, and
          run through the selected playbook in a single round-trip.
        </p>
      </div>

      {state?.error ? (
        <div className="text-sm text-destructive">{state.error}</div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Reviewing…' : 'Run contract review'}
        </Button>
      </div>
    </form>
  );
}
