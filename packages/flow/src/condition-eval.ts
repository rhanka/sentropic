/**
 * @sentropic/flow — pure condition / binding / path helpers.
 *
 * Real reorganization (BR-26 Lot 7 — see BR26-FB-03):
 * These helpers used to live as private methods on `QueueManager`
 * (`evaluateWorkflowCondition`, `resolveWorkflowBindingValue`,
 * `getPathValue`, top-level `isRecord`). They are pure: no `this`,
 * no DB, no I/O. Lifting them into the package lets the dispatch
 * graph and the `PostgresTransitions` adapter call them without
 * a back-reference into `api/src/services/queue-manager.ts`.
 *
 * The condition schema here matches the in-product runtime shape
 * (`{ all, any, not, path, operator, value }`) — distinct from the
 * `WorkflowCondition` port type in `./transitions.ts`, which is a
 * draft surface that will be aligned in a follow-up (Lot 8 / BR-27).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function getPathValue(source: unknown, path: string): unknown {
  if (!path) return source;
  const segments = path.split('.').filter(Boolean);
  let current: unknown = source;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function evaluateWorkflowCondition(
  condition: unknown,
  state: Record<string, unknown>,
): boolean {
  if (!isRecord(condition) || Object.keys(condition).length === 0) {
    return true;
  }
  if (Array.isArray(condition.all)) {
    return condition.all.every((entry) => evaluateWorkflowCondition(entry, state));
  }
  if (Array.isArray(condition.any)) {
    return condition.any.some((entry) => evaluateWorkflowCondition(entry, state));
  }
  if (condition.not !== undefined) {
    return !evaluateWorkflowCondition(condition.not, state);
  }
  const path = typeof condition.path === 'string' ? condition.path : '';
  const operator = typeof condition.operator === 'string' ? condition.operator : 'eq';
  const currentValue = path ? getPathValue(state, path) : undefined;
  switch (operator) {
    case 'eq':
      return currentValue === condition.value;
    case 'truthy':
      return Boolean(currentValue);
    case 'not_empty':
      if (Array.isArray(currentValue)) return currentValue.length > 0;
      if (typeof currentValue === 'string') return currentValue.trim().length > 0;
      return Boolean(currentValue);
    default:
      return false;
  }
}

export interface WorkflowBindingResolutionContext {
  state: Record<string, unknown>;
  run: Record<string, unknown>;
  item?: unknown;
}

/**
 * Compute the per-instance task key for a fanout dispatch.
 *
 * Resolves in priority order:
 * 1. metadata.fanout.instanceKeyPath applied against the item
 * 2. item.id if present
 * 3. item.key if present
 * 4. `${fallbackTaskKey}:${index}` synthetic fallback
 */
export function buildWorkflowTaskInstanceKey(
  item: unknown,
  index: number,
  metadata: Record<string, unknown>,
  fallbackTaskKey: string,
): string {
  const fanout = isRecord(metadata.fanout) ? metadata.fanout : {};
  const configuredPath =
    typeof fanout.instanceKeyPath === 'string' ? fanout.instanceKeyPath : null;
  if (configuredPath) {
    const configuredValue = getPathValue(item, configuredPath);
    if (typeof configuredValue === 'string' && configuredValue.trim()) {
      return configuredValue.trim();
    }
  }
  if (isRecord(item)) {
    const candidateId = typeof item.id === 'string' ? item.id.trim() : '';
    if (candidateId) return candidateId;
    const candidateKey = typeof item.key === 'string' ? item.key.trim() : '';
    if (candidateKey) return candidateKey;
  }
  return `${fallbackTaskKey}:${index}`;
}

export function resolveWorkflowBindingValue(
  binding: unknown,
  context: WorkflowBindingResolutionContext,
): unknown {
  if (typeof binding === 'string') {
    if (binding === '$state') return context.state;
    if (binding.startsWith('$state.'))
      return getPathValue(context.state, binding.slice('$state.'.length));
    if (binding === '$run') return context.run;
    if (binding.startsWith('$run.'))
      return getPathValue(context.run, binding.slice('$run.'.length));
    if (binding === '$item') return context.item;
    if (binding.startsWith('$item.'))
      return getPathValue(context.item, binding.slice('$item.'.length));
    return binding;
  }
  if (Array.isArray(binding)) {
    return binding.map((entry) => resolveWorkflowBindingValue(entry, context));
  }
  if (isRecord(binding)) {
    return Object.fromEntries(
      Object.entries(binding).map(([key, value]) => [
        key,
        resolveWorkflowBindingValue(value, context),
      ]),
    );
  }
  return binding;
}
