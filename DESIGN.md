# Design decisions

The August FDE role explicitly asks for someone who can scope, integrate,
harden, and turn bespoke deployment work into reusable platform primitives.
This doc captures the non-obvious choices behind each module — the things
I would push back on a teammate for proposing the opposite of.

Sections 1–4 carry over from the Court Notice Gateway origin work (they are
the load-bearing parts of Pack 1, unchanged). Sections 5–11 are the
platform layer added in `matterpilot/main`.

## 1. Deterministic first, LLM second

Bankruptcy is a low-tolerance-for-AI-error domain. Sanctions for AI-
generated filing errors are now showing up in the legal press, and the ABA
and California State Bar both stress lawyer supervision over autonomous
action. The right way to use an LLM here is in the narrowest band that
earns its keep: classification across messy district formats, and
extracting facts that vary too much to regex.

So:
- **Case-number matching is a regex**, not an LLM call. PACER case numbers
  have a strict shape (`YY-NNNNN`, optionally with district prefix and
  judge initials). Faster, free, never hallucinates, easy to debug.
- **Sender authenticity is an allowlist + blocklist**, not "ask the model
  if this looks legit." The U.S. Courts have published warnings about fake
  NEFs from look-alike domains; a model is the wrong place to decide that.
- **Suspicious-verdict short-circuits the LLM.** Quarantined notices never
  reach Groq. This hardens the trust boundary (no prompt injection from a
  phishing notice) and saves tokens.
- **The LLM gets exactly one tool call** that returns notice type + every
  operative field + per-field confidence. Splitting it into two calls
  doubled latency for no quality gain on a 70B model.

The same pattern carries into Pack 2: a deterministic gate (playbook valid,
matter required, min text length) short-circuits before any LLM call.

## 2. Confidence is the routing key

The `confidence` column blends three signals: classification confidence
(50%), average over present-field confidences (40%), and a 10% boost for an
exact case-number match. A notice below the 0.75 threshold _never_ auto-
routes — it sits in the Review Queue with confidence bars per field so the
paralegal can see exactly where the model was unsure.

The threshold is an env var (`REVIEW_CONFIDENCE_THRESHOLD`) because what
counts as "review-worthy" varies by firm: a high-volume bankruptcy mill
wants aggressive auto-routing; a boutique handling business reorganizations
wants every notice reviewed. Pack 2 has a parallel knob —
`AUTO_APPROVE_FLAGGED_THRESHOLD` inside `contract-review/index.ts`.

## 3. Audit log is not optional

Every state change writes an `audit_events` row with a workspace id:
ingest, edit, approve, reject, legal-hold place, retention edit, connector
pull, contract review, RAG query. Every Pack 1 LLM call also writes a
`parse_runs` row with the full prompt + raw tool output; Pack 2 captures
the same metadata in the audit `after` JSON (the `parse_runs` foreign key
is notice-bound and needs polymorphic retrofit — see Roadmap).

This isn't sprinkled in for fun — it's a hard requirement for a system
that handles legal workflow:

- The eval is reproducible (re-run any past parse).
- A paralegal can answer "why does this notice say the hearing is the
  14th?" by reading the audit trail.
- An incident review after a bad route is a single SQL query.
- The admin audit CSV export at `/api/audit/export` is the visible
  manifestation of the same row stream.

## 4. Private blobs, proxied

Court notices include client PII (debtor names, case numbers, amounts
owed). Vercel Blob's private store is the right default — but private blobs
need signed access. The proxy route at `/api/notices/[id]/pdf` uses
`@vercel/blob.get()` server-side and streams the file back. Two upsides
over exposing the signed URL to the client:

1. The only thing the browser sees is `/api/notices/<id>/pdf` — no tokens
   in the URL bar or browser history.
2. It's a single place to add ACL checks (workspace membership, document-
   level permissions).

## 5. Multi-tenancy lives in a DAL, not in proxy

Next.js 16 renamed Middleware to **Proxy** (the file is `src/proxy.ts`),
and the bundled docs explicitly warn against doing real auth in it:

> While Proxy can be useful for initial checks, it should not be your only
> line of defense in protecting your data. The majority of security checks
> should be performed as close as possible to your data source.

So `src/proxy.ts` is _only_ an optimistic redirect — unauthenticated
requests bounce to `/sign-in`. The real check lives in
`src/lib/workspace/context.ts:requireWorkspaceCtx()` (the DAL), called by
every server action, page, and route handler that touches tenant data.
`requireWorkspaceCtx` reads the Auth.js session, looks up the
`workspace_member` row by email, and returns `{ userId, userEmail,
workspaceId, role }`. It's wrapped in React's `cache()` so a single
request hitting multiple server components reuses one DB lookup.

The DAL pattern is what the Next.js 16 auth doc explicitly recommends, and
it matches August's likely deployment reality: a firm pilot will pass auth
through MSAL/Entra ID, but the workspace boundary is still enforced
per-query against a Postgres row. Putting the boundary at the data layer
means the same primitives work for the web UI, the MCP server, the Office
add-ins (with a different header-based auth path), and any future ingest
worker.

## 6. WorkflowPack engine — one primitive, two packs

Both ingest paths (court-notice intake, contract playbook review) run on
the same engine in `src/lib/workflow/`. A pack implements four methods:

```ts
interface WorkflowPack<Input, LlmData, Outcome> {
  deterministic(input): DeterministicShortCircuit | DeterministicContinue
  persistShortCircuit(args): PersistResult<Outcome>
  llm(input, det): LlmStage<LlmData>
  aggregateConfidence(llm, det): number
  persist(args): PersistResult<Outcome>
}
```

The engine in `src/lib/workflow/engine.ts` owns orchestration: stage order,
audit writes, workspace scoping. Packs own all domain logic. There are
**24 lines** of orchestration; everything else lives in the pack.

This was the most important refactor: in the v1 take-home, Pack 1 was a
single 187-line `ingestNotice()` function with the deterministic call,
short-circuit branch, LLM call, audit write, DB inserts, and task
creation all inline. Splitting that into pack/engine made Pack 2 a
day-and-a-half exercise of pattern-matching against the Pack 1 shape.

When the platform thesis says "every deployment turns into platform" —
this is the literal code shape that demonstrates it.

## 7. Connector SDK — honest mocks with REAL: comments

`src/lib/connectors/` defines a single `Connector` interface and ships
four adapters: SharePoint (Graph), iManage Work REST, NetDocuments ndAuth,
and a local mock. All four are mocked, because:

- A candidate project can't provision a live Microsoft 365 dev tenant
  inside the demo timeline.
- iManage and NetDocs sandbox access requires firm-administrator
  approval and is not self-serve.

The shape of the deliverable is what matters for an FDE candidate: prove
you understand the auth flow, the endpoint set, the response shapes, and
the deployment gotchas of each vendor. So every adapter:

1. Implements the `Connector` interface returning the same response
   shapes the real vendor APIs return.
2. Carries a `/* REAL: ... */` comment at every mocked call naming the
   exact endpoint, scopes, and request body a production call would use.
3. Ships a README documenting the full auth flow (Entra OAuth2 OBO,
   iManage OAuth2 PKCE, NetDocs SAML-then-OAuth bridge) and the
   data-plane endpoint cheatsheet.

A reviewer can run `grep -rn "REAL:" src/lib/connectors/` and audit
fidelity against vendor docs in one shell command. That's the explicit
honesty signal — the alternative ("integrated with everything!" with no
disclosed limit) is the kind of overstatement that erodes trust faster
than disclosed mocks.

## 8. Matter-scoped RAG — ethical walls at the data layer

`src/lib/rag/retrieve.ts` runs `embedding <=> $1::vector` SQL against
`document_chunks` with **two non-negotiable predicates**:

```sql
where c.workspace_id = $workspace_id::uuid
  and c.matter_id    = $matter_id::uuid
```

Cross-matter retrieval is an ethical-wall breach in a legal product —
an attorney working on Acme cannot see chunks indexed under Smith, even
if both matters are in the same workspace. The web UI surfaces this
explicitly: the "Ask this matter" widget's copy says "Cross-matter
retrieval is impossible: every query is scoped by `workspace_id +
matter_id`." The same predicates apply to the MCP `search_matter_rag`
tool, with a defence-in-depth matter-ownership check first.

Embeddings are optional. If `OPENAI_API_KEY` is missing, `embedOne()`
returns `null` and the UI surfaces "RAG disabled — set OPENAI_API_KEY."
The rest of the platform continues to work; RAG is a value-add, not a
required path.

## 9. Office add-ins — header auth now, MSAL later

Office task panes cannot share a session cookie with the main MatterPilot
app (different origin context, sandboxed iframe, CSP restrictions). The
demo accepts an `X-MatterPilot-User` request header carrying the
workspace member's email and resolves to a full `WorkspaceCtx` server-
side. The header is stored in `Office.context.roamingSettings`.

In a real August deployment this would be replaced by an MSAL SSO call
(`Office.auth.getAccessToken({ allowSignInPrompt: true })`) returning the
user's Entra ID token, which the server validates and maps to a workspace
member. The header path is documented in `src/lib/addins/auth.ts` as a
demo affordance with a clear upgrade path.

For Word's tracked-changes flow, the server returns clause-level **diff
instructions** (`{anchorText, action: 'replace', newText, ...}`) and the
client iterates them inside `Word.run` with `context.document
.changeTrackingMode = "TrackAll"`. Word records each `range.insertText
(..., 'Replace')` as a tracked change the attorney accepts or rejects via
the standard Review ribbon. The server never touches OOXML; that
complexity stays at the host where it belongs.

## 10. Tenancy invariant is enforced by tooling, not by hope

`scripts/check-tenancy.ts` (`pnpm tenancy:check`) walks each
`db.<select|insert|update|delete>` chain in `src/`, finds tenant-table
references, and fails CI on any chain missing a `workspaceId` predicate.
On its first run it caught **6 real leaks** in the pre-existing
notice-review actions — bugs that worked today only because workspaceId
was nullable, but would have leaked across tenants the moment the column
flipped to NOT NULL or the moment a second workspace existed.

The second line is `pnpm e2e:matterpilot`: after running both packs
against a fresh matter, it asserts `SELECT count(*) WHERE workspace_id
IS NULL` equals 0 across every tenant table. A regression slips past
the static check → the e2e fails.

This is the FDE-thinking signal: not "we'll be careful" but a guardrail
that prevents the exact class of bug a Forward Deployed Engineer would be
paid to debug at a customer site.

## 11. MCP server stays read-only — for now

The MCP server ships **seven read-only tools**, all `MCP_WORKSPACE_ID`-
scoped:

- Pack 1 surface: `list_upcoming_hearings`, `get_case_notice_timeline`,
  `find_unreviewed_notices`, `summarise_recent_discharge_orders`.
- Matter surface: `list_matters`, `get_matter_documents`,
  `search_matter_rag`.

Read-only is the right call for v1 — letting an LLM mutate state in a
legal workflow is something you earn over time, not ship on day one. The
roadmap entry for a write surface (`approve_notice`,
`update_extracted_field`, `set_legal_hold`) is gated behind an explicit
role check and the same audit-trail discipline as the web UI.

## 12. What's intentionally out of scope (still)

- **Live Microsoft Entra app registration / real Graph OBO token exchange.**
  Code paths exist + type-check; demo runs the mock layer. Production
  swap is one OAuth2 token flow + env var pair.
- **Real iManage / NetDocs sandbox credentials.** Adapters stay mocked.
  Documented OAuth/SAML flows are the deliverable; promoting them is
  firm-administrator + vendor-portal coordination work, not engineering.
- **Cross-document contradiction detection / Live Assist clone.** Pack 2
  stops at single-document clause + playbook review. Roadmap entry for
  cross-document contradiction would extend the same engine.
- **Personas-style layered memory hierarchy.** One scope shipped: matter-
  scoped RAG with citations. Layered memory (per-user, per-team,
  per-org with promotion rules) is roadmap.
- **Custom-role RBAC.** Three roles in `memberRoleEnum` is enough for the
  demo; custom-role builder is a v2 admin concern.
- **Background queue (Inngest).** Notices and contracts ingest in-line in
  the request. For volumes >100/min, the workflow engine drops behind a
  job runner; the upload action stays the same.
- **Native mobile, e-signature, billing time entries, conflict-check
  engine.** All out of scope for an FDE candidate project; mentioned
  for completeness because August's product surface touches them.

## 13. Roadmap

- **Office add-in MSAL/Entra SSO.** Replace the `X-MatterPilot-User`
  header with `Office.auth.getAccessToken({ allowSignInPrompt: true })`
  → server-side token validation → workspace member lookup.
- **Word no-Office-host fallback.** Server-side `.docx` rendering with
  pre-baked `w:ins`/`w:del` nodes via the `docx` library, for paths
  where the user wants a redlined doc download instead of in-place
  tracked changes.
- **Polymorphic `parse_runs`.** Currently FK-bound to `notices`; Pack 2
  works around it by stashing model + tokens + latency in
  `audit_events.after`. A `entityKind | entityId` retrofit lets Pack 2
  (and future packs) land in the same observability surface.
- **Per-workspace playbook editor in `/admin/policies`.** Today the
  playbooks live in code. The DSL is already JSON-shaped; the swap to a
  DB-backed store is one table + one form.
- **Real iManage / NetDocs deployments.** Adapter code stays the same;
  the only changes are env vars + a one-time vendor app registration.
- **District-specific Pack 1 extraction.** Courtroom field is the
  weakest at 83% F1. A few-shot prompt with district examples (CACB,
  NYEB) should clear that.
- **Background queue (Inngest).** Workflow engine moves behind a job
  runner; the rest of the app stays untouched.
- **Cross-document contradiction (Pack 2 extension).** Same engine,
  new pack: ingest all matter contracts, embed clause spans, surface
  conflicting clauses across documents.

The shortest summary: take the bespoke court-notice ingest that worked,
turn it into a platform that survives a real firm pilot, ship two packs
on the same engine to prove the abstraction earns its keep, and gate
every cross-tenant query with a check that fails CI rather than waiting
for an incident. That's the platform-thesis arc August's product
language describes; this repo is one engineer's read of how to execute
on it.
