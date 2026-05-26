'use client';

/**
 * Dev-credentials sign-in form.
 *
 * Client component on purpose: next-auth v5 beta's server-action signIn()
 * path for the Credentials provider hits MissingCSRF on the first POST
 * because the CSRF cookie isn't issued until /api/auth/csrf runs. The
 * `next-auth/react` signIn helper performs the GET /api/auth/csrf →
 * POST /api/auth/callback/{id} dance with the right cookie + token, so
 * the flow just works.
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DevCredentialsForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState('admin@matterpilot.dev');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await signIn('dev', {
        email: email.trim(),
        redirect: false,
        callbackUrl,
      });
      if (result?.error) {
        setError(
          result.error === 'CredentialsSignin'
            ? 'No workspace member with that email.'
            : result.error,
        );
        setPending(false);
        return;
      }
      // Hard navigate so the new session cookie is honored on every server
      // component on the destination page.
      window.location.assign(result?.url ?? callbackUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-in failed');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="email">Workspace member email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          placeholder="admin@matterpilot.dev"
        />
        <p className="text-xs text-muted-foreground">
          Dev sign-in: any seeded workspace member. No password.
        </p>
        <p className="text-xs text-muted-foreground">
          Seeded: <span className="font-mono">admin@matterpilot.dev</span>,{' '}
          <span className="font-mono">attorney@matterpilot.dev</span>,{' '}
          <span className="font-mono">paralegal@matterpilot.dev</span>
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
