/**
 * WorkflowPack — the platform primitive a deployment-shaped workflow plugs into.
 *
 * The engine owns orchestration: stage order, audit writes, workspace scoping.
 * Packs own domain logic: what counts as suspicious, what the LLM is asked,
 * what gets persisted, how confidence is aggregated.
 *
 * Two packs ship today:
 *   - court-notice: U.S. bankruptcy court notice intake (Pack 1)
 *   - contract-review: contract playbook redlining (Pack 2 — planned)
 */

export type PackContext = {
  workspaceId: string;
  matterId: string | null;
  actor: string;
  reviewThreshold: number;
};

export type AuditPayload = {
  entity: string;
  entityId: string;
  action: string;
  after: Record<string, unknown>;
};

export type DeterministicShortCircuit = {
  kind: 'short_circuit';
  reasons: string[];
  meta: Record<string, unknown>;
};

export type DeterministicContinue = {
  kind: 'continue';
  reasons: string[];
  requiresReview: boolean;
  meta: Record<string, unknown>;
};

export type DeterministicOutcome = DeterministicShortCircuit | DeterministicContinue;

export type LlmStage<D> = {
  data: D;
  prompt: { system: string; user: string; toolName: string };
  rawArgs: unknown;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  durationMs: number;
};

export type PersistResult<O> = {
  outcome: O;
  audit: AuditPayload;
};

export interface WorkflowPack<Input, LlmData, Outcome> {
  id: string;
  displayName: string;
  documentKinds: string[];
  deterministic(input: Input): DeterministicOutcome | Promise<DeterministicOutcome>;
  persistShortCircuit(args: {
    ctx: PackContext;
    input: Input;
    det: DeterministicShortCircuit;
  }): Promise<PersistResult<Outcome>>;
  llm(input: Input, det: DeterministicContinue): Promise<LlmStage<LlmData>>;
  aggregateConfidence(llm: LlmStage<LlmData>, det: DeterministicContinue): number;
  persist(args: {
    ctx: PackContext;
    input: Input;
    det: DeterministicContinue;
    llm: LlmStage<LlmData>;
    overallConfidence: number;
  }): Promise<PersistResult<Outcome>>;
}
