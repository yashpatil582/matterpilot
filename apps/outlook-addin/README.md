# @matterpilot/outlook-addin

Office.js task pane for **Outlook desktop**. Built with Vite + React +
`@types/office-js`. Served by the main Next.js app under `/addins/outlook/*`
(see the rewrite in `next.config.ts`).

## Build

```bash
pnpm --filter @matterpilot/outlook-addin build
```

Produces `apps/outlook-addin/dist/`. The Next.js production build picks
those assets up via the `/addins/outlook/*` rewrite, so a single
`vercel --prod` ships everything.

## Local dev (standalone preview)

```bash
pnpm --filter @matterpilot/outlook-addin dev
```

Opens at `http://localhost:5101`. This is a fast feedback loop for the
React UI in isolation — `Office.context` will be `undefined`, so any
Office.* calls should be guarded.

## Sideload into Outlook desktop

The manifest at `public/addins/manifests/outlook.xml` points at the
production Vercel URL. Sideload steps:

1. Make sure the Next.js app is deployed at the URL referenced by
   `<SourceLocation DefaultValue=…>` in the manifest, and that
   `/addins/outlook/taskpane.html` serves the bundled task pane.
2. Outlook (Windows): **File → Manage Add-ins → My Add-ins → Add a custom
   add-in → Add from file…** → pick `public/addins/manifests/outlook.xml`.
3. Outlook (Mac): **Tools → Get Add-ins → My Add-ins → Add Custom Add-in →
   from file…**
4. Open any message in the reading pane → the **MatterPilot** ribbon
   group should appear → click **Open MatterPilot** → task pane opens.

If the manifest URL is wrong or the task pane URL returns non-HTTPS,
Outlook will silently refuse to load the pane. Check the deployed
URL and the SSL cert before debugging the code.

## Planned wiring (Step 11)

- `Summarize thread` → reads `Office.context.mailbox.item.body.getAsync()`
  and posts to `/api/addins/summarize-thread`.
- `Extract deadlines` → same body, asks for deadlines only, surfaces
  them as suggested tasks.
- `File to matter…` → matter picker pulls from the workspace, then POSTs
  the message body + attachments to the ingest path so it becomes a
  matter document.
