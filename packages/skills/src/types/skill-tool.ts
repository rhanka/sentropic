/**
 * Loose JSON Schema record. Skills declare tool schemas as JSON Schema
 * fragments (typically derived from Zod). The package keeps the shape
 * narrow and treats values as opaque so consumers can plug their own
 * validator (Ajv, Zod, the LLM provider's validator).
 */
export type JsonSchemaFragment = Record<string, unknown>;

/**
 * Hint for the UI / rendering layer about how a tool result should be
 * surfaced. Free-form string with a canonical, extensible set.
 */
export type OutputRenderHint =
  | 'text'
  | 'terminal'
  | 'map'
  | 'chart'
  | 'image'
  | 'iframe'
  | 'download'
  | (string & {});

/**
 * Declarative tool exposed by a Skill. The execution handler is intentionally
 * not part of this type — it is provided by the `Skill.handlers` map keyed by
 * tool name (see `./skill.ts`).
 */
export interface SkillTool {
  /** Globally unique tool name (kebab-case) within the skill registry. */
  readonly name: string;
  /** Tool-level description used by the LLM for fine-grained selection. */
  readonly description: string;
  /** JSON Schema for the tool input. Required. */
  readonly inputSchema: JsonSchemaFragment;
  /**
   * Optional JSON Schema for the tool output. Required when
   * `outputRenderHint` is not 'text' (per SPEC_EVOL_BR19 §1.1).
   */
  readonly outputSchema?: JsonSchemaFragment;
  /** Optional render hint surfaced to the UI layer. */
  readonly outputRenderHint?: OutputRenderHint;
  /**
   * When true, the tool mutates state. Chat-core derives an idempotency key
   * server-side per SPEC_STUDY_ARCHITECTURE_BOUNDARIES §3. Defaults to false.
   */
  readonly sideEffect?: boolean;
  /**
   * When true, chat-core inserts a human approval gate before execution.
   * Defaults to false.
   */
  readonly requiresApproval?: boolean;
}
