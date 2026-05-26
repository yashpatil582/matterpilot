/**
 * Add-in authentication.
 *
 * Office task panes cannot share a session cookie with the main MatterPilot
 * app (different origin context, sandboxed iframe, CSP restrictions). The
 * demo accepts an `X-MatterPilot-User` request header carrying the workspace
 * member's email and resolves to a full WorkspaceCtx server-side. The header
 * is stored in `Office.context.roamingSettings` by the add-in after a
 * one-time setup step.
 *
 * In a real August deployment this would be replaced by an MSAL SSO call
 * (Office.auth.getAccessToken({ allowSignInPrompt: true })) returning the
 * user's Entra ID token, which the server validates + maps to a workspace
 * member. The header-based path is sufficient for sideloaded demo recording.
 *
 * Always tenant-scope downstream queries with the returned ctx.workspaceId.
 */

import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { WorkspaceCtx } from '@/lib/workspace/context';

export class AddinAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function requireAddinCtx(req: Request): Promise<WorkspaceCtx> {
  const email = req.headers.get('x-matterpilot-user')?.toLowerCase().trim();
  if (!email) {
    throw new AddinAuthError('Missing X-MatterPilot-User header', 401);
  }

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

  if (!member || !member.workspaceId) {
    throw new AddinAuthError(`No workspace member: ${email}`, 403);
  }

  return {
    userId: member.id,
    userEmail: member.email,
    userName: member.name,
    workspaceId: member.workspaceId,
    role: member.role,
  };
}

/** Wrap an add-in route handler so AddinAuthError becomes the right HTTP response. */
export function withAddinAuth<T>(
  handler: (req: Request, ctx: WorkspaceCtx) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    let ctx: WorkspaceCtx;
    try {
      ctx = await requireAddinCtx(req);
    } catch (err) {
      const status = err instanceof AddinAuthError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'auth failed';
      return jsonResponse({ error: message }, status);
    }
    try {
      return await handler(req, ctx);
    } catch (err) {
      console.error('addin route error', err);
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'route failed' },
        500,
      );
    }
  };
  // ts: keep the generic so callers can narrow per-route response types later.
  void {} as T;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // Loose CORS so the Vite dev server (localhost:5101/5102) and the
      // Office runtime origins can both call us. In prod, the add-in calls
      // same-origin via the public/ build, so this header is a no-op.
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-matterpilot-user',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}

/** OPTIONS preflight helper so Vite dev calls work without extra setup. */
export function corsPreflight(): Response {
  return jsonResponse({ ok: true }, 200);
}
