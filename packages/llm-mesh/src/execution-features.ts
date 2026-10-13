/**
 * Execution features (spec §16.3): request requirements finer than the
 * existing `requiredCapabilities`, derived by the gateway from validated
 * Responses input — never from a caller-supplied feature list:
 * named/parallel tool control, strict schema, structured output, reasoning
 * controls, native reasoning replay, verbosity and an explicit output
 * ceiling.
 *
 * This module holds capability facts only: the feature taxonomy, the
 * mesh-known per-transport support table and one pure predicate. It copies
 * no route map (keyed by transport, never by model, account or affinity).
 * Unknown support is not support: a transport with no proven declaration
 * for a required feature is ineligible, before acquisition.
 *
 * Two taxonomy items are bounded extensions from pinned CLI captures
 * (spec §16.9): `reasoning-context` (Codex `reasoning.context`, a
 * server-side retention semantic only native Codex execution can honor)
 * and `custom-tools` (Codex freeform tools, carried opaquely for native
 * execution only). Translated adapters never declare them.
 */

export type ExecutionFeature =
  | 'named-tool-choice'
  | 'parallel-tool-control'
  | 'strict-schema'
  | 'structured-output'
  | 'reasoning-controls'
  | 'reasoning-context'
  | 'custom-tools'
  | 'native-reasoning-replay'
  | 'verbosity'
  | 'explicit-output-ceiling';

export const EXECUTION_FEATURES: readonly ExecutionFeature[] = [
  'named-tool-choice',
  'parallel-tool-control',
  'strict-schema',
  'structured-output',
  'reasoning-controls',
  'reasoning-context',
  'custom-tools',
  'native-reasoning-replay',
  'verbosity',
  'explicit-output-ceiling',
];

/**
 * Mesh-known execution support per account transport. Populated only with
 * proven adapter controls as their fixes land with tests (D16-C); a
 * transport absent here has unknown support and is ineligible for any
 * required feature. Never a model route map — transport keys only.
 *
 * D16-C proofs: Codex projects named choice, parallel control, reasoning
 * (including `reasoning.context`), strict schemas, `text.verbosity`,
 * `prompt_cache_key`, custom tools with their namespace and completed
 * reasoning items natively (it cannot enforce an explicit output ceiling —
 * no `max_output_tokens` slot, spec §16.4). The translated Chat clients
 * project named choice and parallel control with tests; Mistral
 * additionally forwards the Vibe-proven `reasoning_effort` slot. Meta has
 * no reasoning slot (asymmetry, spec §16.4): `reasoning-controls` on `muse`
 * is accepted-validated but not forwarded (bounded §16.3/§16.4 amendment —
 * Muse always sends reasoning, so fail-closed would refuse 100% of Muse
 * traffic); `max_tokens` is projected, so `explicit-output-ceiling` holds.
 * Both translated clients forward the validated `strict` flag on function
 * tools (standard OpenAI function shape); a provider that rejects it fails
 * visibly as a provider 400, never as a silent drop.
 */
const TRANSPORT_EXECUTION_FEATURES: Readonly<
  Record<string, readonly ExecutionFeature[]>
> = {
  codex: ['named-tool-choice', 'parallel-tool-control', 'reasoning-controls', 'strict-schema',
    'reasoning-context', 'custom-tools', 'verbosity'],
  muse: ['named-tool-choice', 'parallel-tool-control', 'reasoning-controls', 'explicit-output-ceiling',
    'strict-schema'],
  'mistral-vibe': ['named-tool-choice', 'parallel-tool-control', 'reasoning-controls', 'strict-schema'],
};

/** Mesh-known support for a transport; empty when unknown (fail closed). */
export const declaredExecutionFeatures = (
  transportProviderId: string,
): readonly ExecutionFeature[] =>
  TRANSPORT_EXECUTION_FEATURES[transportProviderId] ?? [];

/**
 * Pure eligibility of one actual model/transport pair. Shared by planning
 * and quoting, including quote identity/revalidation:
 * - no required features: eligible (no behavior change for existing wires);
 * - unpinned transport: kept — the plan-time account check decides;
 * - pinned transport: every required feature must be in the trusted
 *   declaration (per-account override when supplied, else the mesh table).
 */
export const transportSupportsExecutionFeatures = (
  transportProviderId: string | undefined,
  required: readonly ExecutionFeature[] | undefined,
  declared?: readonly ExecutionFeature[] | undefined,
): boolean => {
  if (!required || required.length === 0) return true;
  if (transportProviderId === undefined) return true;
  const support = declared
    ?? TRANSPORT_EXECUTION_FEATURES[transportProviderId]
    ?? [];
  return required.every((feature) => support.includes(feature));
};
