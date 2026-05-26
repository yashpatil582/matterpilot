/**
 * Sign-in page.
 *
 * Renders one button per configured provider. Microsoft Entra + Google appear
 * only when the corresponding env vars are set; the dev credentials form
 * appears when AUTH_DEV_LOGIN=true or in non-production environments. This
 * keeps the demo workable end-to-end without external OAuth setup.
 *
 * Dev credentials form is a client component (see DevCredentialsForm) because
 * next-auth v5 beta's server-action signIn() path for Credentials hits
 * MissingCSRF before the CSRF cookie is issued. The next-auth/react signIn
 * helper does the GET /api/auth/csrf → POST /api/auth/callback dance with
 * the right token + cookie, so the flow just works.
 */

import { signIn, listConfiguredProviders } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DevCredentialsForm } from './dev-form';

async function providerSignIn(formData: FormData) {
  'use server';
  const providerId = String(formData.get('providerId'));
  const callbackUrl = String(formData.get('callbackUrl') ?? '/');
  await signIn(providerId, { redirectTo: callbackUrl });
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = params.callbackUrl ?? '/';
  const providers = listConfiguredProviders();
  const oidc = providers.filter((p) => p.id !== 'dev');
  const hasDev = providers.some((p) => p.id === 'dev');

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to MatterPilot</CardTitle>
          <CardDescription>
            Multi-tenant legal AI matter platform. Choose a sign-in method.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {oidc.map((p) => (
            <form key={p.id} action={providerSignIn}>
              <input type="hidden" name="providerId" value={p.id} />
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <Button type="submit" className="w-full" variant="outline">
                Continue with {p.name}
              </Button>
            </form>
          ))}

          {hasDev && (
            <>
              {oidc.length > 0 && (
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      or, for the demo
                    </span>
                  </div>
                </div>
              )}
              <DevCredentialsForm callbackUrl={callbackUrl} />
            </>
          )}

          {providers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No sign-in providers configured. Set AUTH_GOOGLE_ID/SECRET,
              AUTH_MICROSOFT_ENTRA_ID/SECRET, or AUTH_DEV_LOGIN=true.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
