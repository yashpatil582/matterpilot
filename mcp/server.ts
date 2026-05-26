/**
 * MatterPilot — MCP server.
 *
 * Exposes a small read-only surface so an MCP-aware AI client (Claude
 * Desktop, ChatGPT, etc.) can query the same matter / notice / case state
 * that the web UI shows. Intentionally narrow: no writes, no PII dump —
 * just the queries an attorney or paralegal actually asks out loud.
 *
 * Tenant scoping: every tool is scoped to MCP_WORKSPACE_ID. The MCP server
 * is spawned per-user as a Claude Desktop subprocess, so each user pins it
 * to their own workspace via env. If unset, falls back to the seeded
 * default workspace UUID so the demo works out of the box.
 *
 * Transport: stdio. Launched as a subprocess by the MCP client (see README
 * for the claude_desktop_config.json snippet).
 *
 * Run locally: `pnpm mcp`
 */

import '../scripts/_loadenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { and, asc, desc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { DEFAULT_WORKSPACE_ID } from '../src/lib/workflow/default-ctx';
import { retrieveForMatter } from '../src/lib/rag/retrieve';

const WORKSPACE_ID = (process.env.MCP_WORKSPACE_ID ?? DEFAULT_WORKSPACE_ID).trim();

const server = new McpServer({
  name: 'matterpilot',
  version: '0.2.0',
});

function jsonContent(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

server.tool(
  'list_matters',
  'List matters in the current workspace. Defaults to open matters; pass status to filter (open | on_hold | closed).',
  {
    status: z
      .enum(['open', 'on_hold', 'closed'])
      .default('open')
      .describe('Matter status filter.'),
    limit: z.number().int().min(1).max(200).default(50),
  },
  async ({ status, limit }) => {
    const rows = await db
      .select({
        id: schema.matters.id,
        name: schema.matters.name,
        clientName: schema.matters.clientName,
        status: schema.matters.status,
        retentionPolicy: schema.matters.retentionPolicy,
        legalHold: schema.matters.legalHold,
        createdAt: schema.matters.createdAt,
      })
      .from(schema.matters)
      .where(
        and(
          eq(schema.matters.workspaceId, WORKSPACE_ID),
          eq(schema.matters.status, status),
        ),
      )
      .orderBy(desc(schema.matters.createdAt))
      .limit(limit);
    return jsonContent({ workspaceId: WORKSPACE_ID, status, count: rows.length, matters: rows });
  },
);

server.tool(
  'get_matter_documents',
  'Fetch every document attached to a matter (court notices, contracts, email attachments, connector imports). Returns kind, source connector, mime, bytes, and review status if available.',
  {
    matterId: z.string().min(8).describe('Matter UUID. Use list_matters to discover ids.'),
  },
  async ({ matterId }) => {
    const [matter] = await db
      .select({
        id: schema.matters.id,
        name: schema.matters.name,
        clientName: schema.matters.clientName,
        legalHold: schema.matters.legalHold,
        retentionPolicy: schema.matters.retentionPolicy,
      })
      .from(schema.matters)
      .where(
        and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, WORKSPACE_ID)),
      )
      .limit(1);
    if (!matter) {
      return jsonContent({ matterId, found: false });
    }
    const docs = await db
      .select({
        id: schema.documents.id,
        name: schema.documents.name,
        kind: schema.documents.kind,
        sourceConnector: schema.documents.sourceConnector,
        sourceRef: schema.documents.sourceRef,
        mimeType: schema.documents.mimeType,
        bytes: schema.documents.bytes,
        playbookId: schema.documents.playbookId,
        reviewStatus: schema.documents.reviewStatus,
        flaggedClauseCount: schema.documents.flaggedClauseCount,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.matterId, matterId),
          eq(schema.documents.workspaceId, WORKSPACE_ID),
        ),
      )
      .orderBy(desc(schema.documents.createdAt))
      .limit(200);
    return jsonContent({
      matter,
      count: docs.length,
      documents: docs,
    });
  },
);

server.tool(
  'search_matter_rag',
  'Semantic search over a matter\'s indexed document chunks (workspace + matter scoped). Returns the top-K chunks with similarity scores. Requires OPENAI_API_KEY on the server.',
  {
    matterId: z.string().min(8).describe('Matter UUID.'),
    query: z.string().min(2).describe('Natural-language question.'),
    k: z.number().int().min(1).max(20).default(5),
  },
  async ({ matterId, query, k }) => {
    // Defence-in-depth: verify matter belongs to MCP_WORKSPACE_ID before
    // letting retrieveForMatter run. retrieve also scopes internally; the
    // double check matches the web UI's askMatter action.
    const [matter] = await db
      .select({ id: schema.matters.id, name: schema.matters.name })
      .from(schema.matters)
      .where(
        and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, WORKSPACE_ID)),
      )
      .limit(1);
    if (!matter) {
      return jsonContent({ matterId, found: false });
    }
    const result = await retrieveForMatter({
      workspaceId: WORKSPACE_ID,
      matterId,
      query,
      k,
    });
    return jsonContent({
      matter: { id: matter.id, name: matter.name },
      query,
      queryId: result.queryId,
      status: result.status,
      count: result.chunks.length,
      chunks: result.chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentName: c.documentName,
        ordinal: c.ordinal,
        score: c.score,
        reason: c.reason,
        excerpt: c.content.length > 600 ? `${c.content.slice(0, 600)}…` : c.content,
      })),
    });
  },
);

server.tool(
  'list_upcoming_hearings',
  'List bankruptcy hearings (341 meetings, motion hearings, etc.) scheduled within the next N days, with case number, debtor, and trustee/judge if known.',
  {
    withinDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(14)
      .describe('How many days ahead to look. Defaults to 14.'),
  },
  async ({ withinDays }) => {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        caseNumber: schema.cases.caseNumber,
        debtorName: schema.cases.debtorName,
        type: schema.notices.type,
        status: schema.notices.status,
        hearingAt: schema.extractedEvents.hearingAt,
        courtroom: schema.extractedEvents.courtroom,
        virtualUrl: schema.extractedEvents.virtualUrl,
        trustee: schema.extractedEvents.trustee,
        judge: schema.extractedEvents.judge,
        docketSummary: schema.extractedEvents.docketSummary,
      })
      .from(schema.extractedEvents)
      .leftJoin(schema.notices, eq(schema.extractedEvents.noticeId, schema.notices.id))
      .leftJoin(schema.cases, eq(schema.notices.caseId, schema.cases.id))
      .where(
        and(
          eq(schema.extractedEvents.workspaceId, WORKSPACE_ID),
          isNotNull(schema.extractedEvents.hearingAt),
          gt(schema.extractedEvents.hearingAt, now),
          lt(schema.extractedEvents.hearingAt, horizon),
          // Only routed notices appear in hearing lists — same trust
          // boundary as the ICS calendar export.
          eq(schema.notices.status, 'routed'),
        ),
      )
      .orderBy(asc(schema.extractedEvents.hearingAt))
      .limit(50);

    return jsonContent({
      workspaceId: WORKSPACE_ID,
      windowDays: withinDays,
      count: rows.length,
      hearings: rows,
    });
  },
);

server.tool(
  'get_case_notice_timeline',
  'Fetch every notice, hearing, and follow-up task on a single bankruptcy case. Notices are returned newest-first; tasks are returned soonest-due-first.',
  {
    caseNumber: z
      .string()
      .min(4)
      .describe('Canonical short-form case number, e.g. "25-12345". Year-sequence with hyphen.'),
  },
  async ({ caseNumber }) => {
    const [theCase] = await db
      .select()
      .from(schema.cases)
      .where(
        and(
          eq(schema.cases.caseNumber, caseNumber),
          eq(schema.cases.workspaceId, WORKSPACE_ID),
        ),
      )
      .limit(1);

    if (!theCase) {
      return jsonContent({ caseNumber, found: false });
    }

    const notices = await db
      .select({
        id: schema.notices.id,
        type: schema.notices.type,
        status: schema.notices.status,
        confidence: schema.notices.confidence,
        receivedAt: schema.notices.receivedAt,
        senderDomain: schema.notices.senderDomain,
        hearingAt: schema.extractedEvents.hearingAt,
        deadline: schema.extractedEvents.deadline,
        courtroom: schema.extractedEvents.courtroom,
        trustee: schema.extractedEvents.trustee,
        judge: schema.extractedEvents.judge,
        docketSummary: schema.extractedEvents.docketSummary,
      })
      .from(schema.notices)
      .leftJoin(schema.extractedEvents, eq(schema.extractedEvents.noticeId, schema.notices.id))
      .where(
        and(
          eq(schema.notices.caseId, theCase.id),
          eq(schema.notices.workspaceId, WORKSPACE_ID),
        ),
      )
      .orderBy(desc(schema.notices.receivedAt));

    const tasks = await db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        status: schema.tasks.status,
        dueAt: schema.tasks.dueAt,
        assignee: schema.tasks.assignee,
      })
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.caseId, theCase.id), eq(schema.tasks.workspaceId, WORKSPACE_ID)),
      )
      .orderBy(asc(schema.tasks.dueAt));

    return jsonContent({
      case: {
        caseNumber: theCase.caseNumber,
        debtorName: theCase.debtorName,
        district: theCase.district,
        chapter: theCase.chapter,
      },
      noticesCount: notices.length,
      tasksCount: tasks.length,
      notices,
      tasks,
    });
  },
);

server.tool(
  'find_unreviewed_notices',
  'List notices currently sitting in the Review Queue (needs_review status), oldest first. Use this to ask "what is the paralegal team still on the hook for?"',
  {
    olderThanHours: z
      .number()
      .min(0)
      .default(0)
      .describe('Only include notices older than this many hours. Defaults to 0 (all).'),
  },
  async ({ olderThanHours }) => {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: schema.notices.id,
        caseNumber: schema.cases.caseNumber,
        type: schema.notices.type,
        confidence: schema.notices.confidence,
        receivedAt: schema.notices.receivedAt,
        docketSummary: schema.extractedEvents.docketSummary,
      })
      .from(schema.notices)
      .leftJoin(schema.cases, eq(schema.notices.caseId, schema.cases.id))
      .leftJoin(schema.extractedEvents, eq(schema.extractedEvents.noticeId, schema.notices.id))
      .where(
        and(
          eq(schema.notices.workspaceId, WORKSPACE_ID),
          eq(schema.notices.status, 'needs_review'),
          lt(schema.notices.receivedAt, cutoff),
        ),
      )
      .orderBy(asc(schema.notices.receivedAt))
      .limit(50);

    return jsonContent({
      olderThanHours,
      count: rows.length,
      notices: rows,
    });
  },
);

server.tool(
  'summarise_recent_discharge_orders',
  'List discharge orders entered in the period since the given date. Useful for "which clients got their discharge this week?"',
  {
    sinceDate: z
      .string()
      .describe('ISO-8601 date or datetime. Discharge orders received after this point are returned. e.g. "2026-05-01" for "this month".')
      .default(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  },
  async ({ sinceDate }) => {
    const since = new Date(sinceDate);
    if (Number.isNaN(since.getTime())) {
      return jsonContent({ error: 'invalid sinceDate; expected ISO-8601' });
    }

    const rows = await db
      .select({
        caseNumber: schema.cases.caseNumber,
        debtorName: schema.cases.debtorName,
        chapter: schema.cases.chapter,
        judge: schema.extractedEvents.judge,
        receivedAt: schema.notices.receivedAt,
        docketSummary: schema.extractedEvents.docketSummary,
      })
      .from(schema.notices)
      .leftJoin(schema.cases, eq(schema.notices.caseId, schema.cases.id))
      .leftJoin(schema.extractedEvents, eq(schema.extractedEvents.noticeId, schema.notices.id))
      .where(
        and(
          eq(schema.notices.workspaceId, WORKSPACE_ID),
          eq(schema.notices.type, 'discharge'),
          eq(schema.notices.status, 'routed'),
          gt(schema.notices.receivedAt, since),
        ),
      )
      .orderBy(desc(schema.notices.receivedAt));

    return jsonContent({
      sinceDate,
      count: rows.length,
      discharges: rows,
    });
  },
);

async function main() {
  // Stderr only — stdout is the JSON-RPC frame channel.
  console.error(`[mcp] matterpilot v0.2.0 — scoped to workspace ${WORKSPACE_ID}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The MCP server exits when the client closes stdio. No keep-alive loop.
}

main().catch((err) => {
  console.error('[mcp] fatal:', err);
  process.exit(1);
});

// Silence unused-symbol warnings for imports kept for future schema use.
void sql;
