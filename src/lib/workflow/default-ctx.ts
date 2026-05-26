/**
 * Default workspace context.
 *
 * Temporary shim used while ingest is still triggered without a session
 * (uploads via the public web form, the e2e script, the eval harness).
 * Replaced in Step 3 by `requireWorkspaceCtx()` which derives the workspace
 * from the Auth.js session set by `src/middleware.ts`.
 *
 * The UUID matches the row seeded by `scripts/seed.ts`.
 */

import type { PackContext } from './types';

export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
export const DEFAULT_REVIEW_THRESHOLD = Number(
  process.env.REVIEW_CONFIDENCE_THRESHOLD ?? 0.75,
);

export function getDefaultPackContext(overrides?: Partial<PackContext>): PackContext {
  return {
    workspaceId: DEFAULT_WORKSPACE_ID,
    matterId: null,
    actor: 'system',
    reviewThreshold: DEFAULT_REVIEW_THRESHOLD,
    ...overrides,
  };
}
