import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/auth";
import { getWorkspaceCtx } from "@/lib/workspace/context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MatterPilot",
  description:
    "Multi-tenant legal AI matter platform. Multi-workflow ingest (court notices + contract playbooks), Office add-ins, matter-scoped memory, OIDC, auditable.",
};

const nav = [
  { href: "/", label: "Inbox" },
  { href: "/matters", label: "Matters" },
  { href: "/review", label: "Review Queue" },
  { href: "/cases", label: "Cases" },
  { href: "/metrics", label: "Metrics" },
];

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/sign-in" });
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const ctx = await getWorkspaceCtx();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r bg-muted/30 px-4 py-6 flex flex-col gap-1">
            <div className="px-2 pb-6">
              <div className="font-semibold tracking-tight">MatterPilot</div>
              <div className="text-xs text-muted-foreground">
                Legal AI matter platform
              </div>
            </div>
            <nav className="flex flex-col gap-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-2 py-1.5 text-sm rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto px-2 pt-6">
              {ctx ? (
                <div className="space-y-2">
                  <div className="text-xs">
                    <div className="font-medium truncate" title={ctx.userEmail}>
                      {ctx.userEmail}
                    </div>
                    <div className="text-muted-foreground capitalize">
                      {ctx.role}
                    </div>
                  </div>
                  <form action={signOutAction}>
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start px-2"
                    >
                      Sign out
                    </Button>
                  </form>
                </div>
              ) : null}
              <div className="pt-4 text-xs text-muted-foreground">
                <div>August FDE application</div>
                <div className="font-mono">matterpilot v0.2.0</div>
              </div>
            </div>
          </aside>
          <main className="flex-1 flex flex-col">{children}</main>
        </div>
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
