import { useEffect, useState } from 'react';

/**
 * Word task pane — placeholder UI.
 *
 * One core action: apply a playbook to the current document. The pack
 * server returns clause-level diff instructions; this client iterates them
 * and uses Word.run + Word.Range.insertText under changeTrackingMode =
 * "TrackAll" to insert tracked changes inline. That logic lands in Step 11.
 *
 * For now, the picker and the action button are scaffolded so the sideload
 * + Office bootstrap flow is testable.
 */

const PLAYBOOK_FALLBACK: Array<{ id: string; name: string }> = [
  { id: 'mutual-nda', name: 'Mutual NDA' },
  { id: 'msa', name: 'Master Services Agreement' },
  { id: 'service-agreement', name: 'Standard Service Agreement' },
];

function Banner({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  const bg = tone === 'warn' ? 'var(--mp-amber-bg)' : 'var(--mp-border)';
  const fg = tone === 'warn' ? 'var(--mp-amber-fg)' : 'var(--mp-fg)';
  return (
    <div
      style={{
        background: bg,
        color: fg,
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
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
        background: disabled ? 'transparent' : 'var(--mp-accent)',
        color: disabled ? 'var(--mp-muted)' : '#fff',
        border: `1px solid var(--mp-border)`,
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

async function readSelectionSnippet(): Promise<string | null> {
  if (typeof Word === 'undefined') return null;
  try {
    let snippet: string | null = null;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.load('text');
      await context.sync();
      snippet = (range.text ?? '').trim() || null;
    });
    return snippet;
  } catch {
    return null;
  }
}

export function App() {
  const [playbookId, setPlaybookId] = useState<string>(PLAYBOOK_FALLBACK[0].id);
  const [status, setStatus] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);

  const inWord = typeof Office !== 'undefined' && !!Office?.context?.document;

  useEffect(() => {
    if (!inWord) return;
    readSelectionSnippet().then(setSelection);
  }, [inWord]);

  return (
    <div style={{ padding: 16 }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>MatterPilot</div>
        <div style={{ color: 'var(--mp-muted)', fontSize: 12 }}>
          Word add-in · v0.1 (scaffold)
        </div>
      </header>

      {!inWord && (
        <Banner tone="warn">
          Office host not detected. Open this task pane from Word desktop
          (sideload via Insert → Add-ins → Upload My Add-in) to wire up the
          document context.
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
            border: `1px solid var(--mp-border)`,
            background: 'var(--mp-bg)',
            color: 'var(--mp-fg)',
            fontSize: 13,
          }}
        >
          {PLAYBOOK_FALLBACK.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {selection && (
        <Banner tone="info">
          Selection: <em>{selection.slice(0, 80)}{selection.length > 80 ? '…' : ''}</em>
        </Banner>
      )}

      <ActionButton
        label="Apply playbook"
        onClick={() => setStatus('Wired up in Step 11.')}
        disabled={!inWord}
      />

      {status && (
        <div
          style={{
            marginTop: 16,
            padding: 10,
            background: 'var(--mp-border)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--mp-fg)',
          }}
        >
          {status}
        </div>
      )}

      <footer
        style={{
          marginTop: 24,
          paddingTop: 12,
          borderTop: `1px solid var(--mp-border)`,
          fontSize: 11,
          color: 'var(--mp-muted)',
        }}
      >
        MatterPilot is a Forward Deployed Engineer demo. This add-in is
        sideloaded against a developer build and not yet signed for the
        Office Store.
      </footer>
    </div>
  );
}
