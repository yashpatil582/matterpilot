import { useState } from 'react';
import { reviewContract, type ClauseDiff, type ContractReviewResponse } from './api';
import { applyDiffs, readDocumentText, type DiffOutcome } from './word';

const PLAYBOOKS = [
  { id: 'mutual-nda', name: 'Mutual NDA' },
  { id: 'msa', name: 'Master Services Agreement' },
  { id: 'service-agreement', name: 'Standard Service Agreement' },
];

type View =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'reviewed'; data: ContractReviewResponse }
  | { kind: 'applied'; data: ContractReviewResponse; outcomes: DiffOutcome[] }
  | { kind: 'error'; message: string };

function Banner({ tone, children }: { tone: 'info' | 'warn' | 'ok'; children: React.ReactNode }) {
  const palette =
    tone === 'warn'
      ? { bg: 'var(--mp-amber-bg)', fg: 'var(--mp-amber-fg)' }
      : tone === 'ok'
        ? { bg: '#dcfce7', fg: '#166534' }
        : { bg: 'var(--mp-border)', fg: 'var(--mp-fg)' };
  return (
    <div
      style={{
        background: palette.bg,
        color: palette.fg,
        padding: '8px 10px',
        borderRadius: 6,
        fontSize: 12,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        padding: '10px 12px',
        marginBottom: 8,
        background: disabled ? 'transparent' : primary ? 'var(--mp-accent)' : 'var(--mp-bg)',
        color: disabled ? 'var(--mp-muted)' : primary ? '#fff' : 'var(--mp-fg)',
        border: '1px solid var(--mp-border)',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
      }}
    >
      {label}
    </button>
  );
}

function riskColor(risk: 'low' | 'medium' | 'high'): { bg: string; fg: string } {
  if (risk === 'high') return { bg: '#fee2e2', fg: '#991b1b' };
  if (risk === 'medium') return { bg: '#fef3c7', fg: '#92400e' };
  return { bg: '#dcfce7', fg: '#166534' };
}

function ClauseCard({
  diff,
  outcome,
}: {
  diff: ClauseDiff;
  outcome?: DiffOutcome;
}) {
  const palette = riskColor(diff.riskLevel);
  return (
    <div
      style={{
        border: '1px solid var(--mp-border)',
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>
          #{diff.ordinal + 1} · {diff.clauseType.replace(/_/g, ' ')}
        </div>
        <span
          style={{
            background: palette.bg,
            color: palette.fg,
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
            textTransform: 'uppercase',
          }}
        >
          {diff.riskLevel} risk
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mp-muted)', marginBottom: 6 }}>{diff.reason}</div>
      <div
        style={{
          fontSize: 11,
          padding: 8,
          background: 'var(--mp-amber-bg)',
          color: 'var(--mp-amber-fg)',
          borderRadius: 4,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2, textTransform: 'uppercase', fontSize: 9 }}>
          Suggested redline
        </div>
        {diff.newText}
      </div>
      {outcome && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color:
              outcome.status === 'applied'
                ? '#166534'
                : outcome.status === 'not_found'
                  ? '#92400e'
                  : 'var(--mp-muted)',
          }}
        >
          {outcome.status === 'applied'
            ? '✓ Tracked change inserted'
            : outcome.status === 'not_found'
              ? '⚠ Anchor not found in document'
              : outcome.status === 'skipped'
                ? '— skipped'
                : `✗ ${outcome.message ?? 'error'}`}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [playbookId, setPlaybookId] = useState<string>(PLAYBOOKS[0].id);
  const [view, setView] = useState<View>({ kind: 'idle' });
  const inWord = typeof Office !== 'undefined' && !!Office?.context?.document;

  async function withLoading<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setView({ kind: 'loading', label });
    try {
      return await fn();
    } catch (err) {
      setView({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  const onReview = async () => {
    const text = await withLoading('Reading document…', () => readDocumentText());
    if (text === null) return;
    if (!text || text.trim().length < 200) {
      setView({ kind: 'error', message: 'Document is too short to review.' });
      return;
    }
    const data = await withLoading('Running playbook review…', () =>
      reviewContract({ documentText: text, playbookId }),
    );
    if (data) setView({ kind: 'reviewed', data });
  };

  const onApply = async () => {
    if (view.kind !== 'reviewed') return;
    const data = view.data;
    const outcomes = await withLoading('Applying tracked changes…', () =>
      applyDiffs(data.clauseDiffs),
    );
    if (outcomes) setView({ kind: 'applied', data, outcomes });
  };

  return (
    <div style={{ padding: 16 }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>MatterPilot</div>
        <div style={{ color: 'var(--mp-muted)', fontSize: 12 }}>Word add-in · v0.1</div>
      </header>

      {!inWord && (
        <Banner tone="warn">
          Office host not detected. Open this task pane from Word desktop.
        </Banner>
      )}

      <div style={{ marginBottom: 12 }}>
        <label
          htmlFor="playbookId"
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          Playbook
        </label>
        <select
          id="playbookId"
          value={playbookId}
          onChange={(e) => setPlaybookId(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--mp-border)',
            background: 'var(--mp-bg)',
            color: 'var(--mp-fg)',
            fontSize: 13,
          }}
        >
          {PLAYBOOKS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <ActionButton
        label="Run playbook review"
        primary
        onClick={onReview}
        disabled={!inWord || view.kind === 'loading'}
      />

      {view.kind === 'reviewed' && view.data.clauseDiffs.length > 0 && (
        <ActionButton
          label={`Apply ${view.data.clauseDiffs.length} tracked change${view.data.clauseDiffs.length === 1 ? '' : 's'}`}
          onClick={onApply}
          disabled={view.kind === 'loading'}
        />
      )}

      {view.kind === 'loading' && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mp-muted)' }}>
          {view.label}
        </div>
      )}

      {view.kind === 'error' && <Banner tone="warn">Error: {view.message}</Banner>}

      {(view.kind === 'reviewed' || view.kind === 'applied') && (
        <div style={{ marginTop: 16 }}>
          <Banner tone="info">
            <strong>{view.data.playbookName}</strong> ·{' '}
            {view.data.clauseCount} clauses extracted ·{' '}
            {view.data.clauseDiffs.length} redline{view.data.clauseDiffs.length === 1 ? '' : 's'}
          </Banner>
          <div style={{ fontSize: 12, marginBottom: 12 }}>{view.data.summary}</div>
          {view.kind === 'applied' && (
            <Banner tone="ok">
              {view.outcomes.filter((o) => o.status === 'applied').length} tracked
              changes inserted ·{' '}
              {view.outcomes.filter((o) => o.status === 'not_found').length} anchor
              not found. Accept or reject via Word&apos;s Review ribbon.
            </Banner>
          )}
          {view.data.clauseDiffs.map((d) => {
            const outcome =
              view.kind === 'applied'
                ? view.outcomes.find((o) => o.ordinal === d.ordinal)
                : undefined;
            return <ClauseCard key={d.ordinal} diff={d} outcome={outcome} />;
          })}
        </div>
      )}
    </div>
  );
}
