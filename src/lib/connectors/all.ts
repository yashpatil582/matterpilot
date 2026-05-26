/**
 * Central import that triggers every connector adapter's
 * `registerConnector(...)` side-effect at module load.
 *
 * Server code that needs the connector registry should import this once
 * (e.g. at the top of a route or server action). Importing individual
 * adapters works too, but this file is the authoritative manifest of which
 * adapters ship with the platform.
 */

import './adapters/local-mock';
import './adapters/sharepoint';
import './adapters/imanage';
import './adapters/netdocs';

import { getConnector, listConnectors } from './registry';
import type { Connector, ConnectorSession } from './types';
import type { WorkspaceCtx } from '@/lib/workspace/context';

export { getConnector, listConnectors };

export async function getConnectorSession(
  connectorId: string,
  ctx: WorkspaceCtx,
): Promise<{ connector: Connector; session: ConnectorSession }> {
  const connector = getConnector(connectorId);
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorId}`);
  }
  const session = await connector.authenticate({
    workspaceId: ctx.workspaceId,
    userEmail: ctx.userEmail,
  });
  return { connector, session };
}
