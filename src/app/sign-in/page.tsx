/**
 * Sign-in page.
 *
 * Renders one button per configured provider. Microsoft Entra + Google appear
 * only when the corresponding env vars are set; the dev credentials form
 * appears when AUTH_DEV_LOGIN=true or in non-production environments. This
 * keeps the demo workable end-to-end without external OAuth setup.
 */

import { signIn, listConfiguredProviders } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

async function devSignIn(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  const callbackUrl = String(formData.get('callbackUrl') ?? '/');
  await signIn('dev', { email, redirectTo: callbackUrl });
}

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
              <form action={devSignIn} className="space-y-3">
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <div className="space-y-1">
                  <Label htmlFor="email">Workspace member email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="admin@matterpilot.dev"
                  />
                  <p className="text-xs text-muted-foreground">
                    Dev sign-in: any seeded workspace member. No password.
                  </p>
                </div>
                <Button type="submit" className="w-full">
                  Sign in
                </Button>
              </form>
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
