/**
 * Word add-in API client. Mirrors the Outlook add-in client.
 *
 * X-MatterPilot-User auth header carries the workspace member email. Stored
 * in Office.context.roamingSettings; demo defaults to admin@matterpilot.dev.
 * Production replaces this with an MSAL/Entra ID token via
 * Office.auth.getAccessToken(...).
 */

export type ClauseDiff = {
  ordinal: number;
  clauseType: string;
  riskLevel: 'low' | 'medium' | 'high';
  matchedRuleId: string | null;
  anchorText: string;
  action: 'replace';
  newText: string;
  reason: string;
  confidence: number;
};

export type ContractReviewResponse = {
  summary: string;
  playbookName: string;
  clauseCount: number;
  clauseDiffs: ClauseDiff[];
};

const USER_EMAIL_KEY = 'matterpilotUserEmail';

export function getUserEmail(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = (Office?.context as any)?.roamingSettings;
  const stored = settings?.get(USER_EMAIL_KEY) as string | undefined;
  if (stored && stored.includes('@')) return stored;
  return 'admin@matterpilot.dev';
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

export function reviewContract(args: {
  documentText: string;
  playbookId: string;
  matterId?: string;
}): Promise<ContractReviewResponse> {
  return fetchJson('/api/addins/contract-review', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}
