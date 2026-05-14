import type {
  AuthzContext,
  IdempotencyKey,
  TenantContext,
} from '@sentropic/contracts';
import type { EventEnvelope, StreamEvent } from '@sentropic/events';

// Re-exports for downstream convenience (see SPEC §3, §4).
export type {
  AuthzContext,
  CheckpointVersion,
  IdempotencyKey,
  TenantContext,
} from '@sentropic/contracts';
export type { EventEnvelope, StreamEvent } from '@sentropic/events';

/**
 * Per SPEC §12 — generic CheckpointStore with strategy adapters.
 * Single port owns versioning, listing, tagging, forking, optional watch.
 * Strategy concerns (cadence, redaction) live in the adapter, not the port.
 */
export type CheckpointMeta = {
  key: string;
  version: number;
  tags?: ReadonlyArray<string>;
  createdAt: string;
  updatedAt: string;
};

export type SaveResult = {
  version: number;
  success: boolean;
  reason?: 'VersionMismatch';
};

export interface CheckpointStore<T> {
  load(key: string): Promise<{ state: T; version: number } | null>;
  save(
    key: string,
    state: T,
    expectedVersion?: number,
  ): Promise<SaveResult>;
  list(
    prefix?: string,
    limit?: number,
  ): Promise<ReadonlyArray<CheckpointMeta>>;
  delete(key: string): Promise<void>;
  tag(key: string, label: string): Promise<void>;
  fork(sourceKey: string, targetKey: string): Promise<void>;
  watch?(
    key: string,
    callback: (state: T, version: number) => void,
  ): () => void;
}

/**
 * Per SPEC §5 — chat-core ports.
 * Signatures intentionally minimal in BR14b Lot 3 (shell only);
 * full method surface lands in Lot 4 when chat-service migrates onto these ports.
 */
export interface MessageStore {
  readonly _kind: 'MessageStore';
}

export interface SessionStore {
  readonly _kind: 'SessionStore';
}

export interface StreamBuffer {
  readonly _kind: 'StreamBuffer';
}

/**
 * Per SPEC §10.3 — canvas bidirectional editing.
 * LiveDocumentStore carries the diff round-trip abstraction beyond the message log.
 */
export interface LiveDocumentStore {
  readonly _kind: 'LiveDocumentStore';
}

/**
 * Per SPEC §5 — federated ToolRegistry.
 * Resolves tool descriptors at request time against authz scope.
 */
export type ResolvedTool = {
  readonly name: string;
  readonly schema: unknown;
};

export type ToolMetadata = {
  readonly name: string;
  readonly description: string;
};

export interface ToolRegistry {
  resolve(
    authz: AuthzContext,
    toolNames?: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<ResolvedTool>>;
  has(name: string): boolean;
  list(authz: AuthzContext): Promise<ReadonlyArray<ToolMetadata>>;
}

/**
 * Per SPEC §3 + events — typed sink for emitted events.
 * EventEnvelope carries the wire-protocol shape (tenant, seq, ts, payload).
 */
export interface EventSink {
  emit<TPayload>(event: EventEnvelope<TPayload>): Promise<void>;
}

/**
 * Per SPEC §10.4 — minimal JobQueue port.
 * chat-core only consumes; the production implementation ships in `flow`.
 */
export type JobRef = {
  readonly id: IdempotencyKey;
  readonly toolName: string;
};

export interface JobQueue {
  enqueue(
    toolName: string,
    args: unknown,
    tenant: TenantContext,
  ): Promise<JobRef>;
  subscribe(
    ref: JobRef,
    onUpdate: (event: StreamEvent) => void,
  ): () => void;
  cancel(ref: JobRef): Promise<void>;
}

/**
 * Per SPEC §14 — agent templating with skill overlay (forward-compat).
 * Captures existing app behavior: a base AgentDefinition is resolved with an
 * overlay of attached skills into the runtime config consumed by orchestration.
 */
export type AgentDefinition = {
  readonly promptTemplate: string;
  readonly defaultToolNames: ReadonlyArray<string>;
  readonly modelPrefs?: {
    readonly model?: string;
    readonly temperature?: number;
  };
};

export type Skill = {
  readonly name: string;
  readonly instructions: string;
  readonly toolNames: ReadonlyArray<string>;
};

export type ResolvedAgentConfig = {
  readonly systemPrompt: string;
  readonly tools: ReadonlyArray<ResolvedTool>;
  readonly modelPrefs?: AgentDefinition['modelPrefs'];
};

export interface AgentRuntime {
  readonly base: AgentDefinition;
  readonly attachedSkills: ReadonlyArray<Skill>;
  resolve(
    authz: AuthzContext,
    contextVars: Record<string, string>,
  ): Promise<ResolvedAgentConfig>;
}
