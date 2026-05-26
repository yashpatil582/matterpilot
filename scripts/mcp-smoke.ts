/**
 * Smoke-test the MCP server end-to-end.
 *
 * Spawns the server as a subprocess (the same way Claude Desktop would),
 * lists its tools, then calls each one with sensible defaults.
 *
 * Run: `pnpm tsx scripts/mcp-smoke.ts`
 */
import './_loadenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';

async function main() {
  const transport = new StdioClientTransport({
    command: 'pnpm',
    args: ['tsx', join(__dirname, '..', 'mcp', 'server.ts')],
  });

  const client = new Client({ name: 'matterpilot-smoke', version: '0.2.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`tools available: ${tools.tools.map((t) => t.name).join(', ')}\n`);

  // Resolve a matter id for the matter-scoped tools by hitting list_matters
  // first. We can't hard-code one because the seed only creates matters for
  // cases that exist in DB, which varies per environment.
  process.stdout.write('→ list_matters() ... ');
  const mattersRes = await client.callTool({ name: 'list_matters', arguments: {} });
  const mattersFirst = Array.isArray(mattersRes.content) ? mattersRes.content[0] : null;
  const mattersText = mattersFirst && 'text' in mattersFirst ? (mattersFirst.text as string) : '';
  const mattersParsed = JSON.parse(mattersText) as {
    matters: Array<{ id: string; name: string }>;
  };
  console.log(`OK (count=${mattersParsed.matters.length})`);
  const firstMatterId = mattersParsed.matters[0]?.id ?? null;
  if (firstMatterId) {
    console.log(`   first matter: ${mattersParsed.matters[0].name} (${firstMatterId.slice(0, 8)}…)\n`);
  } else {
    console.log('   no matters in this workspace — matter-scoped tools will skip\n');
  }

  const calls: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'list_upcoming_hearings', args: { withinDays: 365 } },
    { name: 'get_case_notice_timeline', args: { caseNumber: '25-12345' } },
    { name: 'find_unreviewed_notices', args: { olderThanHours: 0 } },
    { name: 'summarise_recent_discharge_orders', args: { sinceDate: '2020-01-01' } },
    ...(firstMatterId
      ? [
          { name: 'get_matter_documents', args: { matterId: firstMatterId } },
          {
            name: 'search_matter_rag',
            args: { matterId: firstMatterId, query: 'limitation of liability', k: 3 },
          },
        ]
      : []),
  ];

  for (const c of calls) {
    process.stdout.write(`→ ${c.name}(${JSON.stringify(c.args)}) ... `);
    const result = await client.callTool({ name: c.name, arguments: c.args });
    const first = Array.isArray(result.content) ? result.content[0] : null;
    const text = first && 'text' in first ? (first.text as string) : '';
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* ignore */
    }
    const count =
      parsed && typeof parsed === 'object' && 'count' in parsed && typeof parsed.count === 'number'
        ? parsed.count
        : null;
    console.log(count != null ? `OK (count=${count})` : `OK`);
  }

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
