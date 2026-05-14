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

// Re-export the contracts-free CheckpointStore surface so existing
// `from '@sentropic/chat-core'` consumers keep working unchanged.
export type {
  CheckpointMeta,
  CheckpointStore,
  SaveResult,
} from './checkpoint-port.js';

// Re-export the contracts-free MessageStore surface (BR14b Lot 6).
// Replaces the placeholder `MessageStore { _kind }` that lived here in Lot 3.
export type {
  AssistantContentUpdate,
  ChatMessageIdentity,
  ChatMessageInsert,
  ChatMessageRole,
  ChatMessageRow,
  ChatMessageWithFeedback,
  FeedbackResult,
  FeedbackVote,
  MessageStore,
} from './message-port.js';

/**
 * Per SPEC §5 — remaining chat-core ports.
 * Signatures intentionally minimal in BR14b Lot 3 (shell only);
 * full method surface lands progressively as chat-service migrates onto these ports.
 */
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
