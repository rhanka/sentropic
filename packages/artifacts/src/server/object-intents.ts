/**
 * L-5b — object intents (spec-v8 §9).
 *
 * An intent is recorded before every external object operation (blob put,
 * release commit, promotion). Crash reprise reconciles pending intents:
 * completed effects are marked done, missing effects are marked failed for
 * explicit retry — a pending intent never becomes a visible release on its
 * own. The store is a port; the memory double serves unit tests and the
 * Postgres adapter serves the L-5b integration proof.
 */
import type { JsonValue } from '../contracts.js';
export { inspectPreparations, scheduleBoundedPreparationCleanup } from './preparation-cleanup.js';
export type { PreparationCleanupHost, PreparationAttempt } from './preparation-cleanup.js';

export type IntentKind = 'commit-release' | 'delete-blob' | 'promote-release';
export type IntentState = 'pending' | 'done' | 'failed';

export interface ObjectIntent {
  intentId: string;
  kind: IntentKind;
  state: IntentState;
  payload: Record<string, JsonValue | undefined>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntentStore {
  record(kind: IntentKind, payload: Record<string, JsonValue | undefined>): Promise<ObjectIntent>;
  complete(intentId: string): Promise<void>;
  markFailed(intentId: string, error: string): Promise<void>;
  get(intentId: string): Promise<ObjectIntent | undefined>;
  listPending(): Promise<ObjectIntent[]>;
}

/** Durable preparation history; cleanup never turns a failed attempt into success. */
export interface PreparationIntentStore extends IntentStore {
  listPreparationIntents(): Promise<ObjectIntent[]>;
  claimPreparationCleanup(intentId: string, throughMs: number): Promise<ObjectIntent | undefined>;
  settlePreparationCleanup(intentId: string): Promise<void>;
}

/** In-memory IntentStore double for unit tests. */
export function createMemoryIntentStore(
  clock: () => string = () => new Date().toISOString(),
  ids: () => string = () => crypto.randomUUID(),
): PreparationIntentStore {
  const intents = new Map<string, ObjectIntent>();
  return {
    async record(kind: IntentKind, payload: Record<string, JsonValue | undefined>): Promise<ObjectIntent> {
      const now = clock();
      const intent: ObjectIntent = {
        intentId: ids(),
        kind,
        state: 'pending',
        payload: { ...payload },
        createdAt: now,
        updatedAt: now,
      };
      intents.set(intent.intentId, intent);
      return intent;
    },
    async complete(intentId: string): Promise<void> {
      const intent = intents.get(intentId);
      if (intent === undefined) throw new Error(`unknown intent: ${intentId}`);
      intent.state = 'done';
      intent.updatedAt = clock();
    },
    async markFailed(intentId: string, error: string): Promise<void> {
      const intent = intents.get(intentId);
      if (intent === undefined) throw new Error(`unknown intent: ${intentId}`);
      intent.state = 'failed';
      intent.error = error;
      intent.updatedAt = clock();
    },
    async get(intentId: string): Promise<ObjectIntent | undefined> {
      return intents.get(intentId);
    },
    async listPending(): Promise<ObjectIntent[]> {
      return [...intents.values()]
        .filter((intent) => intent.state === 'pending')
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    async listPreparationIntents() {
      return structuredClone([...intents.values()].filter((intent) =>
        intent.kind === 'commit-release' && typeof intent.payload.cleanupDeadlineMs === 'number'));
    },
    async claimPreparationCleanup(intentId, throughMs) {
      const intent = intents.get(intentId);
      if (intent === undefined || intent.state === 'done' ||
          typeof intent.payload.cleanupDeadlineMs !== 'number' ||
          intent.payload.cleanupDeadlineMs > throughMs) return undefined;
      intent.state = 'failed';
      intent.error ??= 'preparation expired; explicit retry required';
      intent.updatedAt = clock();
      return structuredClone(intent);
    },
    async settlePreparationCleanup(intentId) {
      const intent = intents.get(intentId);
      if (intent === undefined || intent.state !== 'failed') throw new Error('cleanup needs a failed preparation');
      intent.payload.cleanupState = 'failed-cleaned';
      intent.updatedAt = clock();
    },
  };
}

export type IntentResolution = 'done' | 'failed';

/**
 * Reconcile pending intents after a crash: the resolver inspects each
 * pending intent (effect present → done, effect missing → failed for
 * explicit retry) and the store records the outcome. Returns the report.
 */
export async function reconcileIntents(
  store: IntentStore,
  resolve: (intent: ObjectIntent) => Promise<IntentResolution>,
): Promise<{ done: string[]; failed: string[] }> {
  const report: { done: string[]; failed: string[] } = { done: [], failed: [] };
  for (const intent of await store.listPending()) {
    const resolution = await resolve(intent);
    if (resolution === 'done') {
      await store.complete(intent.intentId);
      report.done.push(intent.intentId);
    } else {
      await store.markFailed(intent.intentId, 'reconcile: effect missing, explicit retry required');
      report.failed.push(intent.intentId);
    }
  }
  return report;
}
