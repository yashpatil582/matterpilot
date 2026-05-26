/**
 * WorkflowPack registry.
 *
 * Lets the MCP server, eval dispatcher, and admin UI look up packs by id
 * without each having to import every pack module directly.
 *
 * Packs register themselves at module load via `registerPack()`. The registry
 * is a process-local Map — fine for serverless because each cold start
 * re-imports the registration side-effects.
 */

import type { WorkflowPack } from './types';

type AnyPack = WorkflowPack<unknown, unknown, unknown>;

const registry = new Map<string, AnyPack>();

export function registerPack<I, D, O>(pack: WorkflowPack<I, D, O>): void {
  registry.set(pack.id, pack as unknown as AnyPack);
}

export function getPack(id: string): AnyPack | undefined {
  return registry.get(id);
}

export function listPacks(): AnyPack[] {
  return Array.from(registry.values());
}
