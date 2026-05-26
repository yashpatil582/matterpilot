'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { saveNoticeEdits, approveNotice, rejectNotice } from './actions';

type Field = { label: string; key: keyof FormState; type: 'text' | 'datetime' | 'date' | 'textarea'; confidence: number | null };

type FormState = {
  hearingAt: string;
  courtroom: string;
  virtualUrl: string;
  trustee: string;
  judge: string;
  deadline: string;
  docketSummary: string;
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  // Convert ISO to local datetime-local input format (YYYY-MM-DDTHH:MM)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60_000);
  return local.toISOString().slice(0, 16);
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Convert a datetime-local input value (timezone-naive) back to an ISO-8601
 * string in the *browser's* timezone. The server stores ISO-8601 with offset,
 * so we must include the offset before posting — otherwise the server's
 * `new Date(...)` would interpret the string in the server's timezone
 * (UTC on Vercel) and a Pacific user editing 7am PT would store 7am UTC.
 */
function datetimeLocalToIso(local: string): string {
  // `new Date('YYYY-MM-DDTHH:MM')` is parsed in the local TZ. Calling
  // `.toISOString()` then produces the correct UTC instant.
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function ReviewForm({
  noticeId,
  initial,
  confidences,
  approveDisabled,
}: {
  noticeId: string;
  initial: {
    hearingAt: string | null;
    courtroom: string | null;
    virtualUrl: string | null;
    trustee: string | null;
    judge: string | null;
    deadline: string | null;
    docketSummary: string;
  };
  confidences: {
    hearingAt: number;
    courtroom: number;
    virtualUrl: number;
    trustee: number;
    judge: number;
    deadline: number;
  };
  approveDisabled: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({
    hearingAt: toDatetimeLocal(initial.hearingAt),
    courtroom: initial.courtroom ?? '',
    virtualUrl: initial.virtualUrl ?? '',
    trustee: initial.trustee ?? '',
    judge: initial.judge ?? '',
    deadline: toDateInput(initial.deadline),
    docketSummary: initial.docketSummary,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const fields: Field[] = [
    { label: 'Hearing date / time', key: 'hearingAt', type: 'datetime', confidence: confidences.hearingAt },
    { label: 'Courtroom', key: 'courtroom', type: 'text', confidence: confidences.courtroom },
    { label: 'Virtual hearing URL', key: 'virtualUrl', type: 'text', confidence: confidences.virtualUrl },
    { label: 'Trustee', key: 'trustee', type: 'text', confidence: confidences.trustee },
    { label: 'Judge', key: 'judge', type: 'text', confidence: confidences.judge },
    { label: 'Deadline', key: 'deadline', type: 'date', confidence: confidences.deadline },
  ];

  const buildFormData = (): FormData => {
    const fd = new FormData();
    // Convert the datetime-local hearing value back to ISO with the browser's
    // timezone offset so the server stores the correct UTC instant.
    const hearingIso = state.hearingAt ? datetimeLocalToIso(state.hearingAt) : '';
    fd.append('hearingAt', hearingIso);
    for (const [k, v] of Object.entries(state)) {
      if (k === 'hearingAt') continue;
      fd.append(k, v);
    }
    return fd;
  };

  const onSave = () => {
    setError(null);
    setSavedMsg(null);
    startTransition(async () => {
      const result = await saveNoticeEdits(noticeId, buildFormData());
      if (result.ok) setSavedMsg('Saved.');
      else setError(result.error);
    });
  };

  const onApprove = () => {
    setError(null);
    setSavedMsg(null);
    startTransition(async () => {
      const saved = await saveNoticeEdits(noticeId, buildFormData());
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      const result = await approveNotice(noticeId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push('/');
    });
  };

  const onReject = () => {
    setError(null);
    setSavedMsg(null);
    const reason = window.prompt('Reason for rejecting this notice?') ?? '';
    if (!reason) return;
    startTransition(async () => {
      const result = await rejectNotice(noticeId, reason);
      if (result.ok) router.push('/');
      else setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} state={state} setState={setState} />
      ))}

      <div className="flex flex-col gap-2">
        <Label htmlFor="docketSummary">Docket summary</Label>
        <Textarea
          id="docketSummary"
          value={state.docketSummary}
          rows={3}
          onChange={(e) => setState((s) => ({ ...s, docketSummary: e.target.value }))}
          disabled={pending}
        />
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      {savedMsg ? <div className="text-sm text-emerald-600">{savedMsg}</div> : null}

      <div className="flex gap-2 pt-2">
        <Button onClick={onSave} variant="secondary" disabled={pending}>
          Save edits
        </Button>
        <Button onClick={onApprove} disabled={pending || approveDisabled}>
          Approve &amp; create task
        </Button>
        <Button onClick={onReject} variant="destructive" disabled={pending}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  state,
  setState,
}: {
  field: Field;
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const value = state[field.key];
  const confidence = field.confidence ?? 0;
  const confPct = Math.round(confidence * 100);
  const confColor =
    confidence >= 0.85 ? 'bg-emerald-500' : confidence >= 0.6 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={field.key}>{field.label}</Label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-16 h-1 rounded bg-muted overflow-hidden">
            <div className={`h-full ${confColor}`} style={{ width: `${confPct}%` }} />
          </div>
          <span className="font-mono">{confPct}%</span>
        </div>
      </div>
      <Input
        id={field.key}
        type={field.type === 'datetime' ? 'datetime-local' : field.type === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => setState((s) => ({ ...s, [field.key]: e.target.value }))}
      />
    </div>
  );
}
