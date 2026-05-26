/**
 * Next.js 16 Proxy (formerly Middleware).
 *
 * Optimistic auth gate only — redirects unauthenticated requests to /sign-in.
 * The actual session validation + workspace membership lookup happens in
 * src/lib/workspace/context.ts (the DAL), per Next.js 16 guidance:
 *
 *   "While Proxy can be useful for initial checks, it should not be your only
 *   line of defense in protecting your data. The majority of security checks
 *   should be performed as close as possible to your data source."
 *
 * The matcher below excludes /sign-in, /api/auth (Auth.js handlers), static
 * assets, and the Next.js internals.
 */

import { auth } from '@/auth';

export default auth((req) => {
  const { nextUrl } = req;
  const isSignedIn = !!req.auth;
  const path = nextUrl.pathname;

  // Public surfaces — always pass through. /api/addins/* uses its own
  // header-based auth (see src/lib/addins/auth.ts) because Office task
  // panes can't share session cookies with the main app.
  if (
    path.startsWith('/sign-in') ||
    path.startsWith('/api/auth') ||
    path.startsWith('/api/addins') ||
    path.startsWith('/addins') ||
    path.startsWith('/_next') ||
    path === '/favicon.ico'
  ) {
    return;
  }

  if (!isSignedIn) {
    const url = nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('callbackUrl', path + nextUrl.search);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)'],
};
