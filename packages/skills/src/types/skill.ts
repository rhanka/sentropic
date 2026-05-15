import type { SkillMetadata } from './metadata.js';
import type { SkillTool } from './skill-tool.js';

/**
 * Runtime input to a skill tool handler. Kept narrow on purpose: the package
 * does not couple to any specific AuthzContext shape from `@sentropic/contracts`
 * to avoid a circular package dependency. Concrete consumers cast through
 * their own context type at the integration layer.
 */
export interface SkillToolInvocation {
  /** Tool name being invoked. */
  readonly toolName: string;
  /** Parsed input payload (already validated against the tool inputSchema). */
  readonly input: unknown;
  /**
   * Opaque caller context. Adapters (chat-core, MCP) pass their own
   * AuthzContext-equivalent here without coupling this package to it.
   */
  readonly caller?: unknown;
  /** Optional signal for cancellation; consumers should respect it. */
  readonly signal?: AbortSignal;
}

/**
 * Result returned by a skill tool handler. `output` follows the tool's
 * `outputSchema`; transport-specific wrapping (toolCallId, error envelope,
 * continuation) is added by the adapter consuming the skill.
 */
export interface SkillToolResult {
  readonly output: unknown;
  readonly isError?: boolean;
  readonly errorMessage?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Handler function signature for a skill tool. Idempotency keys, retries,
 * approval gating, and persistence are responsibilities of the consumer
 * (chat-core, queue-manager, …), not of the skill itself.
 */
export type SkillToolHandler = (
  invocation: SkillToolInvocation,
) => Promise<SkillToolResult> | SkillToolResult;

/**
 * A fully-loaded skill bundle: metadata + tool descriptors + (optional)
 * handlers + (optional) sandbox entrypoint + (optional) rendered instructions.
 *
 * The body is surfaced to the LLM as a system-prompt overlay when the skill is
 * loaded for a turn (§14 of SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md).
 */
export interface Skill {
  /** Metadata (also returned standalone by `SkillRegistry.list/search`). */
  readonly metadata: SkillMetadata;
  /** Full tool descriptors for this skill. */
  readonly tools: ReadonlyArray<SkillTool>;
  /**
   * Markdown body extracted from `SKILL.md` (free-form instructions appended
   * to the LLM system context when the skill is loaded).
   */
  readonly body: string;
  /**
   * Handlers keyed by tool name. Optional because sandbox-only skills resolve
   * execution through a `sandboxEntry` instead.
   */
  readonly handlers?: Readonly<Record<string, SkillToolHandler>>;
  /**
   * Optional sandbox entrypoint source. When present, `metadata.sandbox` must
   * also be present; the runtime executes this body under the declared policy.
   */
  readonly sandboxEntry?: string;
}
