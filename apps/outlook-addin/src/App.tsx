import { useEffect, useMemo, useState } from 'react';
import {
  fileToMatter,
  listMatters,
  summariseThread,
  type Deadline,
  type MatterRef,
  type SummariseResponse,
} from './api';
import {
  readAttachmentBase64,
  readItemSnapshot,
  type AttachmentMeta,
  type ItemSnapshot,
} from './office';

/**
 * Outlook task pane — wired to the MatterPilot add-in API.
 *
 *   Summarize thread   → /api/addins/summarize-thread → summary + deadlines
 *   Extract deadlines  → same endpoint, deadlines-only view
 *   File to matter…    → matter picker → /api/addins/file-to-matter
 *
 * Each action is guarded on the Office mailbox being present so the React
 * app still renders cleanly when opened in a plain browser tab for dev.
 */

type View =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'summary'; data: SummariseResponse }
  | { kind: 'deadlines'; data: Deadline[] }
  | { kind: 'file'; matters: MatterRef[] }
  | { kind: 'filed'; matterName: string; documentCount: number }
  | { kind: 'error'; message: string };

function Banner({ tone, children }: { tone: 'info' | 'warn' | 'ok'; children: React.ReactNode }) {
  const palette =
    tone === 'warn'
      ? { bg: '#fef3c7', fg: '#92400e' }
      : tone === 'ok'
        ? { bg: '#dcfce7', fg: '#166534' }
        : { bg: '#dbeafe', fg: '#1e3a8a' };
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

function DeadlineRow({ d }: { d: Deadline }) {
  return (
    <li
      style={{
        padding: '8px 0',
        borderBottom: '1px solid var(--mp-border)',
        listStyle: 'none',
      }}
    >
      <div style={{ fontWeight: 500 }}>{d.what}</div>
      <div style={{ fontSize: 11, color: 'var(--mp-muted)' }}>
        {d.whenText ?? '—'}
        {d.whenIso ? ` · ${d.whenIso}` : ''} ·{' '}
        confidence {Math.round(d.confidence * 100)}%
      </div>
    </li>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<ItemSnapshot | null>(null);
  const [view, setView] = useState<View>({ kind: 'idle' });

  const inOutlook = typeof Office !== 'undefined' && !!Office?.context?.mailbox;

  useEffect(() => {
    if (!inOutlook) return;
    readItemSnapshot().then(setSnapshot).catch((err) => {
      setView({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    });
  }, [inOutlook]);

  const subject = snapshot?.subject ?? '';
  const attachments: AttachmentMeta[] = snapshot?.attachments ?? [];

  async function withLoading<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setView({ kind: 'loading', label });
    try {
      return await fn();
    } catch (err) {
      setView({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  const onSummarize = async () => {
    if (!snapshot) return;
    const result = await withLoading('Summarizing…', () =>
      summariseThread({ subject: snapshot.subject, body: snapshot.bodyText }),
    );
    if (result) setView({ kind: 'summary', data: result });
  };

  const onExtractDeadlines = async () => {
    if (!snapshot) return;
    const result = await withLoading('Extracting deadlines…', () =>
      summariseThread({ subject: snapshot.subject, body: snapshot.bodyText }),
    );
    if (result) setView({ kind: 'deadlines', data: result.deadlines });
  };

  const onFileToMatter = async () => {
    const result = await withLoading('Loading matters…', () => listMatters());
    if (result) setView({ kind: 'file', matters: result.matters });
  };

  const onPickMatter = async (matterId: string) => {
    if (!snapshot) return;
    const attachmentPayloads = await withLoading(
      'Encoding attachments…',
      async () => {
        const out: Array<{ name: string; mime: string; base64: string }> = [];
        for (const a of attachments) {
          try {
            const base64 = await readAttachmentBase64(a.id);
            out.push({ name: a.name, mime: a.contentType, base64 });
          } catch {
            // Skip attachments we can't pull (URL/ical references).
          }
        }
        return out;
      },
    );
    if (attachmentPayloads === null) return;

    const result = await withLoading('Filing…', () =>
      fileToMatter({
        matterId,
        subject: snapshot.subject,
        bodyText: snapshot.bodyText,
        attachments: attachmentPayloads,
      }),
    );
    if (result) {
      setView({
        kind: 'filed',
        matterName: result.matterName,
        documentCount: result.documentIds.length,
      });
    }
  };

  const header = useMemo(
    () => (
      <header style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>MatterPilot</div>
        <div style={{ color: 'var(--mp-muted)', fontSize: 12 }}>Outlook add-in · v0.1</div>
      </header>
    ),
    [],
  );

  return (
    <div style={{ padding: 16 }}>
      {header}

      {!inOutlook && (
        <Banner tone="warn">
          Office host not detected. Open this task pane from Outlook desktop.
        </Banner>
      )}

      {inOutlook && snapshot && (
        <Banner tone="info">
          <strong>{subject || '(no subject)'}</strong>
          {attachments.length > 0 && (
            <span style={{ color: 'var(--mp-muted)' }}> · {attachments.length} attachment{attachments.length === 1 ? '' : 's'}</span>
          )}
        </Banner>
      )}

      <ActionButton
        label="Summarize thread"
        primary
        onClick={onSummarize}
        disabled={!inOutlook || !snapshot || view.kind === 'loading'}
      />
      <ActionButton
        label="Extract deadlines"
        onClick={onExtractDeadlines}
        disabled={!inOutlook || !snapshot || view.kind === 'loading'}
      />
      <ActionButton
        label="File to matter…"
        onClick={onFileToMatter}
        disabled={!inOutlook || !snapshot || view.kind === 'loading'}
      />

      {view.kind === 'loading' && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mp-muted)' }}>
          {view.label}
        </div>
      )}

      {view.kind === 'error' && <Banner tone="warn">Error: {view.message}</Banner>}

      {view.kind === 'summary' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--mp-muted)', marginBottom: 4 }}>
            Summary · matter-relevance {Math.round(view.data.matterRelevance * 100)}%
          </div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>{view.data.summary}</div>
          {view.data.deadlines.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Deadlines
              </div>
              <ul style={{ padding: 0, margin: 0 }}>
                {view.data.deadlines.map((d, i) => (
                  <DeadlineRow key={i} d={d} />
                ))}
              </ul>
            </>
          )}
          {view.data.parties.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mp-muted)' }}>
              Parties: {view.data.parties.join(', ')}
            </div>
          )}
        </div>
      )}

      {view.kind === 'deadlines' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Deadlines ({view.data.length})
          </div>
          {view.data.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--mp-muted)' }}>
              No deadlines found in this thread.
            </div>
          ) : (
            <ul style={{ padding: 0, margin: 0 }}>
              {view.data.map((d, i) => (
                <DeadlineRow key={i} d={d} />
              ))}
            </ul>
          )}
        </div>
      )}

      {view.kind === 'file' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            File to which matter?
          </div>
          {view.matters.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--mp-muted)' }}>
              No open matters in your workspace.
            </div>
          ) : (
            view.matters.map((m) => (
              <ActionButton
                key={m.id}
                label={`${m.name}${m.clientName ? ` — ${m.clientName}` : ''}`}
                onClick={() => onPickMatter(m.id)}
              />
            ))
          )}
        </div>
      )}

      {view.kind === 'filed' && (
        <Banner tone="ok">
          Filed to <strong>{view.matterName}</strong> · {view.documentCount} document
          {view.documentCount === 1 ? '' : 's'} created
        </Banner>
      )}
    </div>
  );
}
