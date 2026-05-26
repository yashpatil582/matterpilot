# 5-minute demo script

Tight. Pick one story and tell it cleanly. Read aloud while screen-sharing.
The arc mirrors August's own customer-story shape: matter intake →
add-in workflow → vault integration → matter-scoped intelligence → admin
governance → reproducible eval.

## Setup before recording

- Local dev environment:
  - `pnpm db:bootstrap && pnpm db:push && pnpm db:seed`
  - `pnpm addins:build`
  - `pnpm dev` — leave running at `http://localhost:3000`
- Sign in as `admin@matterpilot.dev` (dev credentials login)
- Sideload the two add-in manifests:
  - Outlook desktop → File → Manage Add-ins → My Add-ins → Add a custom
    add-in → from file → `public/addins/manifests/outlook.xml`
  - Word desktop → Insert → Add-ins → Upload My Add-in →
    `public/addins/manifests/word.xml`
- Manifests point at a deployed Vercel URL. For local-only recording,
  replace the URL in both manifests with `http://localhost:3000` and
  re-sideload (Office accepts HTTPS by preference but `http://localhost`
  is allowed for dev).
- Browser tabs:
  1. `/matters` (Matters list)
  2. Finder window with `fixtures/notices/341-meeting-legit.pdf` and
     `fixtures/contracts/msa-vendor-friendly.txt` ready to drag.
- Open Outlook desktop on an email containing a sample matter thread
  (any inbox message works; the demo summarizes the visible thread).
- Open Word desktop on a copy of `fixtures/contracts/msa-vendor-friendly.txt`
  pasted into a blank document (so it's editable).
- Optional: Claude Desktop open with the MCP config pointing at the
  local server, if showcasing MCP at the end.

## 0:00 — 0:30 · Frame the platform

> _[On the Matters list page]_
>
> "Most legal-tech demos show one workflow. MatterPilot ships two on the
> same engine — court-notice intake and contract playbook review — both
> landing inside a workspace-scoped matter with audit, retention, legal
> hold, and matter-scoped retrieval. The thesis is that an FDE deployment
> turns one bespoke workflow into platform primitives, and this repo is
> the literal code shape of that arc."

_[Click into a matter — the Acme one created by the seed.]_

## 0:30 — 1:30 · Pack 1 — court-notice intake (Day-7 origin)

> "This matter inherits everything the v1 Court Notice Gateway shipped:
> deterministic parsing, single-call Groq classify + extract, confidence-
> routed review, audit trail, ICS export. The eval committed at 100% on
> case match, 100% on type classification, 94.3% macro-F1, 2.6s median
> latency."

_[Switch to Inbox tab — drag `341-meeting-legit.pdf` into upload.]_

> "Watch ingest: case-number regex picks up 25-12345, sender's *.uscourts.gov
> so the allowlist trusts it, links resolve to court-trusted hosts. One
> tool call to Groq returns notice type, hearing time, trustee, deadline.
> Confidence above threshold → auto-routed. The notice shows up on the
> matter's timeline with its audit row."

_[Click back to the matter. Show the new notice in the matter's Notices card.]_

## 1:30 — 2:30 · Pack 2 — contract playbook review

> "Same engine, second pack. The firm's negotiating position is encoded
> as a JSON playbook in code today, ready to swap to per-workspace DB
> storage. Three playbooks ship: Mutual NDA, MSA, Standard Service
> Agreement."

_[Click "Review a contract" on the matter detail. Pick MSA from the
playbook dropdown, drop `msa-vendor-friendly.txt`. Submit.]_

> "The contract-review pack chunks the doc, classifies each clause type,
> applies the playbook rules, and scores risk in one Groq tool call.
> Liability is unlimited — high risk. Indemnity is one-way — high risk.
> Net-60 payment — medium. The redline suggestion is concrete replacement
> text the attorney can either apply in-browser or push to Word as
> tracked changes."

_[Land on the clause review panel. Scroll through the cards showing risk
badges + amber redline boxes.]_

## 2:30 — 3:15 · Outlook add-in — file to matter

_[Switch to Outlook desktop. Open the prepared message thread. Click the
ribbon button "Open MatterPilot."]_

> "The task pane mounts after Office.onReady. It pulls the current
> message subject and body via Office.context.mailbox.item.body.getAsync.
> Three actions: summarize, extract deadlines, file to matter."

_[Click "Summarize thread."]_

> "One Groq tool call returns a paragraph summary, every deadline with
> ISO date + confidence, named parties, and a matter-relevance score. The
> deadlines feed straight into matter tasks if filed."

_[Click "File to matter…" → pick the Acme matter from the dropdown.]_

> "Each attachment encoded as base64, posted to /api/addins/file-to-matter,
> uploaded to private Vercel Blob, inserted as documents rows scoped by
> workspace_id and matter_id. The audit log captures the filing action."

_[Switch back to the browser, refresh the matter detail. New documents
appear under Documents.]_

## 3:15 — 4:00 · Word add-in — tracked changes

_[Switch to Word desktop with the MSA loaded. Open MatterPilot task pane
from the Home ribbon.]_

> "Pick the MSA playbook. Run review — Word.run reads body.text, posts to
> /api/addins/contract-review, gets back clause-level diff instructions.
> Each diff carries an anchor text and a replacement."

_[Click "Apply N tracked changes."]_

> "Inside another Word.run we set changeTrackingMode to TrackAll, then
> body.search each anchor and range.insertText with 'Replace'. Word
> records every insertion as a tracked change — accept or reject via the
> standard Review ribbon. The task pane stamps per-clause outcomes:
> applied, anchor-not-found, or error."

_[Highlight one tracked change in the document. Show the panel updating.]_

## 4:00 — 4:30 · SharePoint connector + matter RAG

_[Switch back to the browser. From the matter, click "Browse external
vaults" → SharePoint.]_

> "Four mocked vault adapters — SharePoint Graph OAuth2 OBO, iManage Work
> OAuth2 PKCE, NetDocs SAML-then-OAuth, and a local mock. The honest-
> mock disclosure banner explicitly says responses come from in-process
> fixtures and points at the adapter directory. Every mocked call carries
> a /* REAL: */ comment naming the production endpoint."

_[Drill into the SharePoint mock's Firm Precedents folder. Click "Pull
into matter" on the Mutual NDA Template.]_

> "Pull fetches via the connector, uploads to private blob, inserts a
> documents row with source connector and source ref, audits, and
> indexes the bytes into the matter's RAG store."

_[Back on the matter detail, scroll to "Ask this matter."]_

> "Matter-scoped retrieval. The SQL filters on workspace_id AND matter_id —
> cross-matter retrieval is impossible. Ask what carve-outs we have for
> liability."

_[Type "What's our position on liability caps?" and submit.]_

> "Top chunks from this matter only, with similarity scores and a query
> ID that ties back to the retrieval_citations row in Postgres."

## 4:30 — 5:00 · Admin governance + eval

_[Click Admin in the sidebar. Show the four tiles.]_

> "Admin pages gate on role at the layout level. Audit log filters by
> entity, exports CSV scoped to the workspace. Retention rolls up matters
> by policy. Playbooks card surfaces every rule + suggested redline.
> Members directory."

_[Click Audit log → Download CSV. Open in a spreadsheet or just show the
filename in the downloads bar.]_

_[Final cut to the repo's `eval-results.md` rendered on GitHub.]_

> "Eval runs both packs on the same harness. Pack 1's numbers are the
> committed Day-7 baseline; Pack 2 has fresh ground-truth labels for
> eight contract fixtures plus the eight playbook rules. One pnpm eval
> regenerates the whole report."

_[End card with the GitHub repo URL + the Vercel preview URL.]_

> "Two packs, one engine. Office add-ins, SharePoint browse, matter
> RAG, admin audit, MCP server, all workspace-scoped and tenancy-checked
> on every CI run. The shape of an actual August pilot."

## Recording tips

- Run `pnpm db:reset && pnpm db:seed && pnpm e2e:matterpilot` right
  before recording so the demo workspace has clean state with a sample
  matter, notice, and contract already in place.
- Record at 1280×800 minimum so the task pane text stays legible.
- Keep the cursor visible. Office task panes are narrow; pointing at
  badge colours saves a sentence of explanation.
- Don't show secret values. The Vercel preview URL is fine; env vars are
  not.
- After recording, link the Loom from the README hero and from the
  application form.
