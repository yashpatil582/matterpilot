/**
 * Build every Office add-in workspace and copy the output into
 * `public/addins/<id>/` so Next.js serves the task pane at
 * `https://<vercel-url>/addins/<id>/taskpane.html`.
 *
 * Why copy instead of rewrites: Next.js' public/ convention already serves
 * arbitrary static assets at predictable URLs, and Vercel caches them
 * aggressively at the edge. Rewrites would add a middleware hop for every
 * task-pane asset request — unnecessary when the files can sit on disk.
 *
 * Vite emits `dist/index.html`; we rename it to `taskpane.html` on copy
 * because the Office manifests point at that exact filename (the Microsoft
 * convention) and renaming on the dest side keeps the Vite config standard.
 *
 * Run: `pnpm addins:build`
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

const APPS = [
  { id: 'outlook', pkg: '@matterpilot/outlook-addin', appDir: 'apps/outlook-addin' },
  { id: 'word', pkg: '@matterpilot/word-addin', appDir: 'apps/word-addin' },
];

async function buildOne(app: (typeof APPS)[number]): Promise<void> {
  console.log(`Building ${app.pkg} ...`);
  const result = spawnSync('pnpm', ['--filter', app.pkg, 'build'], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (result.status !== 0) {
    throw new Error(`${app.pkg} build failed (exit ${result.status})`);
  }

  const distDir = join(ROOT, app.appDir, 'dist');
  if (!existsSync(distDir)) {
    throw new Error(`Expected build output missing: ${distDir}`);
  }

  const targetDir = join(ROOT, 'public', 'addins', app.id);
  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true });
  }
  await mkdir(targetDir, { recursive: true });
  await cp(distDir, targetDir, { recursive: true });

  const indexHtml = join(targetDir, 'index.html');
  const taskpaneHtml = join(targetDir, 'taskpane.html');
  if (existsSync(indexHtml)) {
    await rename(indexHtml, taskpaneHtml);
  }
  console.log(`  → public/addins/${app.id}/taskpane.html`);
}

async function main(): Promise<void> {
  for (const app of APPS) {
    await buildOne(app);
  }
  console.log(`\naddins:build — OK (${APPS.length}/${APPS.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
