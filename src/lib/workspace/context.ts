/**
 * Workspace context — the data-access-layer primitive every server action,
 * route handler, and server component should call before touching tenant data.
 *
 * Reads the Auth.js session, looks up the workspace_member row by email,
 * and returns the tenant-scoped context the workflow engine + packs need.
 *
 * Cached per render via React's `cache()` so a single request hitting
 * multiple server components reuses the same DB lookup.
 *
 * Throws (and the proxy redirects to /sign-in) for unauthenticated requests
 * so callers can assume a valid ctx by the time they receive it.
 */

import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db, schema } from '@/db';
import type { PackContext } from '@/lib/workflow/types';
import { DEFAULT_REVIEW_THRESHOLD } from '@/lib/workflow/default-ctx';

export type WorkspaceCtx = {
  userId: string;
  userEmail: string;
  userName: string | null;
  workspaceId: string;
  role: 'paralegal' | 'attorney' | 'admin';
};

export const getWorkspaceCtx = cache(async (): Promise<WorkspaceCtx | null> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;

  const [member] = await db
    .select({
      id: schema.workspaceMembers.id,
      email: schema.workspaceMembers.email,
      name: schema.workspaceMembers.name,
      role: schema.workspaceMembers.role,
      workspaceId: schema.workspaceMembers.workspaceId,
    })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.email, email))
    .limit(1);

  if (!member || !member.workspaceId) return null;

  return {
    userId: member.id,
    userEmail: member.email,
    userName: member.name,
    workspaceId: member.workspaceId,
    role: member.role,
  };
});

export async function requireWorkspaceCtx(): Promise<WorkspaceCtx> {
  const ctx = await getWorkspaceCtx();
  if (!ctx) redirect('/sign-in');
  return ctx;
}

export async function requireRole(
  allowed: WorkspaceCtx['role'][],
): Promise<WorkspaceCtx> {
  const ctx = await requireWorkspaceCtx();
  if (!allowed.includes(ctx.role)) {
    throw new Error(`Forbidden: requires role in [${allowed.join(', ')}], got ${ctx.role}`);
  }
  return ctx;
}

export function toPackContext(
  ctx: WorkspaceCtx,
  overrides: Partial<Pick<PackContext, 'matterId' | 'reviewThreshold'>> = {},
): PackContext {
  return {
    workspaceId: ctx.workspaceId,
    matterId: overrides.matterId ?? null,
    actor: ctx.userEmail,
    reviewThreshold: overrides.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD,
  };
}
