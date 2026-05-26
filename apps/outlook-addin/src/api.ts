/**
 * Outlook add-in API client.
 *
 * In dev the Vite server (localhost:5101) proxies /api/* to the Next.js
 * dev server (localhost:3000) — see vite.config.ts. In production the
 * add-in is served from the same origin as the Next.js app, so the
 * relative paths just work.
 *
 * The X-MatterPilot-User header carries the workspace member email. It is
 * stored in Office.context.roamingSettings the first time the task pane is
 * opened and persists across sessions. See getUserEmail() for the lookup.
 *
 * In a real August deployment this header is replaced by the result of
 * Office.auth.getAccessToken(...) — an MSAL/Entra ID token the server
 * validates and maps to a workspace member.
 */

export type MatterRef = { id: string; name: string; clientName: string | null };

export type Deadline = {
  what: string;
  whenIso: string | null;
  whenText: string | null;
  confidence: number;
};

export type SummariseResponse = {
  summary: string;
  deadlines: Deadline[];
  parties: string[];
  matterRelevance: number;
};

export type FileToMatterResponse = {
  matterId: string;
  matterName: string;
  documentIds: string[];
};

const USER_EMAIL_KEY = 'matterpilotUserEmail';

export function getUserEmail(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = (Office?.context as any)?.roamingSettings;
  const stored = settings?.get(USER_EMAIL_KEY) as string | undefined;
  if (stored && stored.includes('@')) return stored;
  // Fallback to the seeded demo user. Add-in shows a banner pointing at the
  // settings flow we add in Step 12; for now the demo defaults to admin.
  return 'admin@matterpilot.dev';
}

export async function setUserEmail(email: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = (Office?.context as any)?.roamingSettings;
  if (!settings) return;
  settings.set(USER_EMAIL_KEY, email);
  await new Promise<void>((resolve, reject) =>
    settings.saveAsync((res: { status: string; error?: { message: string } }) =>
      res.status === 'succeeded' ? resolve() : reject(new Error(res.error?.message ?? 'saveAsync failed')),
    ),
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-matterpilot-user': getUserEmail(),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const message =
      typeof parsed === 'object' && parsed && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export function listMatters(): Promise<{ matters: MatterRef[] }> {
  return fetchJson('/api/addins/matters');
}

export function summariseThread(args: { subject: string; body: string }): Promise<SummariseResponse> {
  return fetchJson('/api/addins/summarize-thread', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

export function fileToMatter(args: {
  matterId: string;
  subject: string;
  bodyText: string;
  attachments: Array<{ name: string; mime: string; base64: string }>;
}): Promise<FileToMatterResponse> {
  return fetchJson('/api/addins/file-to-matter', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}
