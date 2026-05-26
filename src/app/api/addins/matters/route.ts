import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import {
  corsPreflight,
  jsonResponse,
  withAddinAuth,
} from '@/lib/addins/auth';

export const OPTIONS = corsPreflight;

export const GET = withAddinAuth(async (_req, ctx) => {
  const matters = await db
    .select({
      id: schema.matters.id,
      name: schema.matters.name,
      clientName: schema.matters.clientName,
    })
    .from(schema.matters)
    .where(
      and(
        eq(schema.matters.workspaceId, ctx.workspaceId),
        eq(schema.matters.status, 'open'),
      ),
    )
    .orderBy(asc(schema.matters.name))
    .limit(200);
  return jsonResponse({ matters });
});
