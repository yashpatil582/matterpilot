/**
 * Connector registry — process-local map of `id → Connector`.
 *
 * Adapters self-register at module-load via `registerConnector(...)`. The
 * registry lets the admin UI, MCP server, and matter-detail browser look up
 * a connector by id without each one having to import every adapter.
 */

import type { Connector } from './types';

const REGISTRY = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  REGISTRY.set(connector.id, connector);
}

export function getConnector(id: string): Connector | undefined {
  return REGISTRY.get(id);
}

export function listConnectors(): Connector[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.id.localeCompare(b.id));
}
