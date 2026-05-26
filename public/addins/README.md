# Office add-ins — sideload assets

This directory holds the Office add-in **manifests** (committed) and the
**built task-pane bundles** (generated, gitignored).

```
public/addins/
├── README.md                  ← this file (committed)
├── manifests/
│   ├── outlook.xml            ← committed, sideloaded into Outlook desktop
│   └── word.xml               ← committed, sideloaded into Word desktop
├── outlook/                   ← gitignored, written by `pnpm addins:build`
│   ├── taskpane.html
│   └── assets/…
└── word/                      ← gitignored, written by `pnpm addins:build`
    ├── taskpane.html
    └── assets/…
```

## Build

```bash
pnpm install               # picks up the apps/* workspaces
pnpm addins:build          # builds both add-ins and copies into public/addins/
pnpm build                 # next build only (Vercel default)
pnpm build:full            # add-ins + next build, for deliberate Vercel deploys
```

## Why this layout

The bundled HTML + assets live under `public/` instead of behind a Next.js
`rewrites()` route because public files are served directly by the Vercel
edge with no middleware hop. The Office task pane loads N small asset
files; a rewrite per asset would be wasteful.

Vite emits `dist/index.html`; `scripts/build-addins.ts` renames it to
`taskpane.html` on copy because that's the filename the manifests
reference (the Microsoft convention).

## Manifest URLs

Each manifest in `manifests/` references the production task pane URL,
e.g. `https://matterpilot-demo.vercel.app/addins/outlook/taskpane.html`.
If you fork and redeploy under a different Vercel URL, search-and-replace
that host in both manifest files (and re-sideload).
