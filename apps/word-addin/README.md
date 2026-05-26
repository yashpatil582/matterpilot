# @matterpilot/word-addin

Office.js task pane for **Word desktop**. Built with Vite + React +
`@types/office-js`. Served by the main Next.js app under `/addins/word/*`
(see the rewrite in `next.config.ts`).

## Build

```bash
pnpm --filter @matterpilot/word-addin build
```

Produces `apps/word-addin/dist/`. The Next.js production build picks
those assets up via the `/addins/word/*` rewrite, so a single
`vercel --prod` ships everything.

## Local dev (standalone preview)

```bash
pnpm --filter @matterpilot/word-addin dev
```

Opens at `http://localhost:5102`. `Word.*` APIs will be `undefined`
outside the host, so any `Word.run` calls should be guarded.

## Sideload into Word desktop

The manifest at `public/addins/manifests/word.xml` points at the
production Vercel URL. Sideload steps:

1. Make sure the Next.js app is deployed at the URL referenced by the
   manifest, and that `/addins/word/taskpane.html` serves the bundled
   task pane.
2. Word (Windows): **Insert → Add-ins → My Add-ins → Upload My
   Add-in…** → pick `public/addins/manifests/word.xml`.
3. Word (Mac): **Insert → Add-ins → My Add-ins → Upload My Add-in…**
4. The **MatterPilot** group should appear on the **Home** tab → click
   **Open MatterPilot** → task pane opens.

If the manifest URL is wrong or the task pane URL returns non-HTTPS,
Word will silently refuse to load the pane. Check the deployed URL
and the SSL cert before debugging the code.

## Planned wiring (Step 11)

`Apply playbook` →
1. POST the document body to `/api/addins/contract-review` with the
   selected `playbookId`.
2. The server returns clause-level diff instructions:
   `{ rangeAnchor, action: 'replace', newText, reason }[]`.
3. Inside `Word.run`, set
   `context.document.changeTrackingMode = "TrackAll"`, then iterate
   instructions, locating each `rangeAnchor` via
   `body.search(rangeAnchor)` and inserting `newText` with
   `range.insertText(..., 'Replace')`. Word records each insertion as
   a tracked change the attorney can accept or reject.

A fallback path (no Office host) returns a `.docx` with pre-baked
`w:ins`/`w:del` nodes generated server-side via the `docx` library.
