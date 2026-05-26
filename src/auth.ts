/**
 * Auth.js v5 (next-auth@beta) configuration.
 *
 * Three sign-in paths, registered conditionally:
 *
 *   1. Microsoft Entra ID — for firms on Microsoft 365 (the production path
 *      a real August deployment would land on). Requires AUTH_MICROSOFT_ENTRA_ID
 *      and AUTH_MICROSOFT_ENTRA_SECRET; if either is missing the provider is
 *      omitted from the sign-in page.
 *   2. Google — convenience option for the demo recording and for legal teams
 *      on Workspace. Requires AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET.
 *   3. Credentials (dev only) — signs in as any seeded workspace member by
 *      email. Active when NODE_ENV !== 'production' or AUTH_DEV_LOGIN=true.
 *      Lets the demo work end-to-end without external OAuth setup.
 *
 * Sessions are JWT (no DB adapter) so the postgres-js client stays out of the
 * edge runtime path. Workspace membership is resolved per-request in
 * src/lib/workspace/context.ts using the session email.
 */

import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

const isProd = process.env.NODE_ENV === 'production';
const devLoginEnabled = !isProd || process.env.AUTH_DEV_LOGIN === 'true';

const providers: NextAuthConfig['providers'] = [];

if (process.env.AUTH_MICROSOFT_ENTRA_ID && process.env.AUTH_MICROSOFT_ENTRA_SECRET) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ISSUER,
    }),
  );
}

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      // Auth.js v5 beta ignores `id` overrides on Credentials — the provider
      // keeps its default id `credentials`. Calling code references it by
      // that id (signIn('credentials', ...)) and the sign-in page filters
      // on it to pick the right form path.
      name: 'Dev login',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'admin@matterpilot.dev' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').trim().toLowerCase();
        if (!email) return null;

        const [member] = await db
          .select({
            id: schema.workspaceMembers.id,
            email: schema.workspaceMembers.email,
            name: schema.workspaceMembers.name,
          })
          .from(schema.workspaceMembers)
          .where(eq(schema.workspaceMembers.email, email))
          .limit(1);

        if (!member) return null;
        return { id: member.id, email: member.email, name: member.name ?? email };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  // Vercel auto-detects this in most cases, but Auth.js v5 beta's Credentials
  // path occasionally trips MissingCSRF when the host header isn't trusted
  // before the cookie is written. Pin it explicitly.
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in' },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },
    async session({ session, token }) {
      if (token.email) session.user.email = String(token.email);
      return session;
    },
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);

export function listConfiguredProviders(): Array<{ id: string; name: string }> {
  return providers.map((p) => {
    if (typeof p === 'function') {
      const ret = p();
      return { id: ret.id, name: ret.name };
    }
    return { id: p.id, name: p.name };
  });
}
