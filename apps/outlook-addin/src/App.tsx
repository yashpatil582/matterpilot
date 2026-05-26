import { useEffect, useState } from 'react';

/**
 * Outlook task pane — placeholder UI.
 *
 * Three actions a paralegal triggers on a thread:
 *   - Summarize thread          → POST /api/addins/summarize-thread
 *   - Extract deadlines         → same endpoint, returns ?deadlines
 *   - File to matter            → matter picker → POST /api/addins/file-to-matter
 *
 * Those endpoints land in Step 11. This file scaffolds the UI shell so the
 * sideload + Office bootstrap flow is testable today.
 */

type Subject = {
  subject: string | null;
  itemType: 'message' | 'appointment' | 'other';
};

function readCurrentItem(): Subject {
  // Office.context.mailbox.item is set when a message or appointment is open
  // in the reading pane or compose window. Outside of Outlook this is null.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mailbox = (Office?.context as any)?.mailbox;
  const item = mailbox?.item;
  if (!item) return { subject: null, itemType: 'other' };
  const itemType: Subject['itemType'] =
    item.itemType === Office.MailboxEnums.ItemType.Message
      ? 'message'
      : item.itemType === Office.MailboxEnums.ItemType.Appointment
        ? 'appointment'
        : 'other';
  return { subject: item.subject ?? null, itemType };
}

function Banner({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  const bg = tone === 'warn' ? '#fef3c7' : '#dbeafe';
  const fg = tone === 'warn' ? '#92400e' : '#1e3a8a';
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

export function App() {
  const [subject, setSubject] = useState<Subject>({ subject: null, itemType: 'other' });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setSubject(readCurrentItem());
  }, []);

  const inOutlook = typeof Office !== 'undefined' && !!Office?.context?.mailbox;

  return (
    <div style={{ padding: 16 }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>MatterPilot</div>
        <div style={{ color: 'var(--mp-muted)', fontSize: 12 }}>
          Outlook add-in · v0.1 (scaffold)
        </div>
      </header>

      {!inOutlook && (
        <Banner tone="warn">
          Office host not detected. Open this task pane from Outlook desktop
          (sideload via Manage Add-ins → My Add-ins) to wire up the message
          context.
        </Banner>
      )}

      {inOutlook && (
        <Banner tone="info">
          Current item:{' '}
          <strong>{subject.subject ?? '(no subject)'}</strong>{' '}
          <span style={{ color: 'var(--mp-muted)' }}>· {subject.itemType}</span>
        </Banner>
      )}

      <ActionButton
        label="Summarize thread"
        onClick={() => setStatus('Wired up in Step 11.')}
        disabled={!inOutlook}
      />
      <ActionButton
        label="Extract deadlines"
        onClick={() => setStatus('Wired up in Step 11.')}
        disabled={!inOutlook}
      />
      <ActionButton
        label="File to matter…"
        onClick={() => setStatus('Wired up in Step 11.')}
        disabled={!inOutlook}
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
