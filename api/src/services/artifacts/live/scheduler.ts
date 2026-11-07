import { LEASE_FRAME_INTERVAL_MS, type LiveKey } from './records';

/** The `createLiveController` surface the scheduler drives. */
interface Controller {
  active(): Promise<Array<{ key: LiveKey }>>; lease(key: LiveKey): Promise<unknown>; reconcile(key: LiveKey): Promise<unknown>;
}
const idOf = (key: LiveKey) => `${key.storageScopeId}\u0000${key.artifactId}`;

/**
 * The API scheduler of one environment. Each tick sends the liveness frame of every runtime that is not DORMANT
 * (A-LIVE Amendment 1 §3) and reconciles every key concurrently, so one key's long heavy phase (crash restore, clean
 * build) never delays another key or any lease frame. A key whose previous frame or reconcile still runs is skipped
 * for that step. The interval is at most half the 60 s cadence, so a slow frame still lands within it.
 */
export function createLiveScheduler(deps: { controller: Controller; intervalMs: number;
  onError(key: LiveKey | null, error: unknown): void }) {
  if (!(deps.intervalMs > 0 && deps.intervalMs <= LEASE_FRAME_INTERVAL_MS / 2)) {
    throw new Error(`Live scheduler interval must be in (0, ${LEASE_FRAME_INTERVAL_MS / 2}] ms`);
  }
  const running = new Set<string>();
  const once = async (step: string, key: LiveKey, work: () => Promise<unknown>) => {
    const id = `${step}:${idOf(key)}`;
    if (running.has(id)) return;
    running.add(id);
    try { await work(); } catch (error) { deps.onError(key, error); } finally { running.delete(id); }
  };
  /** Resolves once every lease frame of this tick settled; reconciles keep running in the background. */
  async function tick() {
    let active: Array<{ key: LiveKey }>;
    try { active = await deps.controller.active(); } catch (error) { deps.onError(null, error); return; }
    for (const { key } of active) void once('reconcile', key, () => deps.controller.reconcile(key));
    await Promise.all(active.map(({ key }) => once('lease', key, () => deps.controller.lease(key))));
  }
  return {
    tick,
    start() {
      void tick();
      const timer = setInterval(() => { void tick(); }, deps.intervalMs);
      timer.unref?.();
      return { stop() { clearInterval(timer); } };
    },
  };
}
