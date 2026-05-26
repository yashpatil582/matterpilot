# Deploy to Vercel

The whole web app deploys to Vercel free tier. Neon (Postgres) and Vercel Blob are already provisioned from local development — production reuses them.

The MCP server runs **locally** as a subprocess of Claude Desktop. It is not deployed.

## One-time setup

1. Install the Vercel CLI if you don't have it:

   ```bash
   pnpm add -g vercel
   ```

2. Log in:

   ```bash
   vercel login
   ```

3. Link the repo to a new Vercel project (run from repo root):

   ```bash
   vercel link
   ```

   Pick a personal scope and accept the default project name (`court-notice-gateway`).

## Environment variables

Pull the required vars from your local `.env.local` and add them to the Vercel project:

```bash
vercel env add DATABASE_URL production
vercel env add GROQ_API_KEY production
vercel env add BLOB_READ_WRITE_TOKEN production
vercel env add REVIEW_CONFIDENCE_THRESHOLD production    # value: 0.75
vercel env add LLM_PROVIDER production                   # value: groq
vercel env add LLM_MODEL_CLASSIFY production             # value: llama-3.3-70b-versatile
vercel env add LLM_MODEL_EXTRACT production              # value: llama-3.3-70b-versatile

# Auth.js v5 — required
vercel env add AUTH_SECRET production                    # openssl rand -base64 32

# OIDC providers — optional, register only the ones you intend to use
vercel env add AUTH_MICROSOFT_ENTRA_ID production
vercel env add AUTH_MICROSOFT_ENTRA_SECRET production
vercel env add AUTH_GOOGLE_ID production
vercel env add AUTH_GOOGLE_SECRET production

# Dev credentials login — set to 'true' ONLY for a demo environment.
# Leave unset in real production deployments.
vercel env add AUTH_DEV_LOGIN production                 # value: true (demo only)

# Matter-scoped RAG (optional — embeddings only; "Ask this matter" widget
# shows a clear "RAG disabled" notice if missing).
vercel env add OPENAI_API_KEY production
```

## Database extensions

Before the first `pnpm db:push`, enable the Postgres extensions the schema
depends on (today: `pgvector` for RAG embeddings):

```bash
pnpm db:bootstrap                  # CREATE EXTENSION IF NOT EXISTS vector
pnpm db:push                       # schema sync (now safe to reference vector(1536))
pnpm db:seed                       # default workspace + members + matters + policies
```

Neon supports `CREATE EXTENSION vector` out of the box; bootstrap is
idempotent and re-runs safely on every fresh DB.

## MCP server

`pnpm mcp` launches the stdio MCP server for Claude Desktop. It is **not**
deployed — each Claude Desktop user spawns their own local subprocess.
Configure tenancy via the `MCP_WORKSPACE_ID` env var so the tools only
return rows from that workspace; unset falls back to the seeded default
workspace UUID.

Example `claude_desktop_config.json` entry:

```json
{
  "mcpServers": {
    "matterpilot": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/court-notice-gateway", "mcp"],
      "env": {
        "DATABASE_URL": "postgresql://…",
        "MCP_WORKSPACE_ID": "00000000-0000-0000-0000-000000000001",
        "OPENAI_API_KEY": "sk-…"
      }
    }
  }
}
```

You can also paste them in via the Vercel dashboard (Project → Settings → Environment Variables) — same effect.

## First deploy

```bash
vercel --prod
```

Vercel will build (Turbopack, ~30s), deploy, and return a URL like `https://court-notice-gateway.vercel.app`.

## Smoke test the deploy

```bash
curl -I https://<your-url>/
curl -I https://<your-url>/metrics
```

Both should return `200`. Then in a browser, upload any PDF from `fixtures/notices/` via the Upload page to confirm the live pipeline end-to-end.

## Operational notes

- **DB schema drift.** `pnpm db:push` is local-only. To apply schema changes against the production Neon DB, run the same command with the production `DATABASE_URL` exported in your shell, or generate a migration with `pnpm db:generate` and apply it via `pnpm db:migrate`.
- **Groq daily quota.** Free tier is 100k tokens/day on llama-3.3-70b. Each ingest uses ~3k tokens, so the free tier handles ~30 notices/day. For more, switch `LLM_MODEL_CLASSIFY` to `llama-3.1-8b-instant` (separate quota, lower accuracy) or upgrade to Groq Dev tier.
- **Vercel Blob limits.** Free tier is 5 GB storage / 100 GB bandwidth per month — enough for this demo.
- **Long-running workers.** Day-7 build runs everything in the request path. For higher volume, move `ingestNotice` to an Inngest background job; the upload action stays the same.

## Rollback

```bash
vercel rollback         # interactive — pick the prior deploy
```

Vercel keeps every deployment, so the prior version is always one command away.
