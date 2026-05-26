import Link from 'next/link';
import { requireRole } from '@/lib/workspace/context';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/audit', label: 'Audit log' },
  { href: '/admin/retention', label: 'Retention' },
  { href: '/admin/policies', label: 'Playbooks' },
  { href: '/admin/members', label: 'Members' },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(['admin']);

  return (
    <div className="flex-1 px-8 py-8 max-w-6xl">
      <header className="pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Workspace-wide governance: audit, retention, playbooks, members.
        </p>
      </header>
      <nav className="border-b mb-6 flex gap-1">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="px-3 py-2 text-sm rounded-t-md hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
