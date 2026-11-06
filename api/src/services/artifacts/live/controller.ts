import type { LivePorts } from './ports';
import { assertFence, conflict, type LiveKey, type LiveRuntime } from './records';
import { revive } from './revive';
import { prepareLive } from './prepare-live';
import { idleBuild } from './idle';
import { buildOnly } from './build-only';
import { withinPhase } from './deadline';
import { projectRevision } from './project';
import { currentBinding, failed, teardown, transition } from './transitions';

export function createLiveController(ports: LivePorts) {
  return {
    /** Host scheduler calls this for active bindings; source grants never keep revoked pods alive. */
    async reconcile(key: LiveKey) {
      const state = await ports.store.read(key);
      if (!state || state.runtime.phase === 'DORMANT') return;
      const runtime = state.runtime;
      let binding;
      try { binding = await ports.binding(key); }
      catch (error) { await failed(ports, key, runtime, error); return; }
      if (!binding.healthy || binding.generation !== runtime.generation || ports.now() >= runtime.maximumLifetimeAt) {
        return teardown(ports, key, runtime, 'authority_or_lifetime');
      }
      if (runtime.phase === 'LIVE') {
        try { await ports.pods.ensure(key, runtime); }
        catch (error) { await failed(ports, key, runtime, error); return; }
        return idleBuild(ports, key);
      }
      // Recovery of an in-flight operation belongs to startup after its old API executor is fenced.
    },
    start: (key: LiveKey) => revive(ports, key),
    idle: (key: LiveKey) => idleBuild(ports, key),
    buildOnly: (key: LiveKey, admittedJobId: string) => buildOnly(ports, key, admittedJobId),
    project: (key: LiveKey, durableRevision: number) => projectRevision(ports, key, durableRevision),
    /** Only the authenticated host calls this after an admitted source operation or visible interaction. */
    async activity(key: LiveKey, sessionId: string, kind: 'edit' | 'read' | 'foreground' | 'heartbeat' | 'status') {
      if (kind === 'heartbeat' || kind === 'status') return;
      const binding = await currentBinding(ports, key);
      await ports.store.transaction(key, async unit => {
        const runtime = unit.state?.runtime;
        if (!runtime || runtime.generation !== binding.generation || runtime.sessionId !== sessionId) conflict('stale_session');
        if (runtime.phase !== 'LIVE') conflict('transition_busy');
        if (kind !== 'foreground' || ports.now() - runtime.lastAccessAt >= 5000) runtime.lastAccessAt = ports.now();
      });
    },
    async wake(key: LiveKey) {
      const binding = await currentBinding(ports, key);
      let runtime = await ports.store.transaction(key, async unit => {
        const runtime = unit.state?.runtime;
        if (!runtime || runtime.phase === 'DORMANT') return;
        if (runtime.generation !== binding.generation) conflict('stale_fence');
        if (!['BUILD_PROVISIONING', 'QUIESCING', 'BUILDING', 'VERIFYING', 'PUBLISHING', 'SAVING'].includes(runtime.phase)) conflict('transition_busy');
        runtime.pendingWake = true; runtime.routeEpoch++; runtime.phase = 'REVIVING';
        runtime.appliedRevision = null; runtime.lastAccessAt = ports.now();
        return structuredClone(runtime);
      });
      if (!runtime) return revive(ports, key);
      try {
        await ports.routes.revoke(key, runtime);
        // The higher phase fence cancels every older worker command before restoring source.
        await ports.worker.quiesce(runtime);
        runtime = await transition(ports, key, runtime, state => { state.runtime.attempt = null; });
        return await withinPhase(prepareLive(ports, key, runtime));
      } catch (error) { await failed(ports, key, runtime, error); throw error; }
    },
    /** Narrow stop after code-right revocation exposes teardown fields only. Identity comes from host auth. */
    async stop(key: LiveKey, input: { ownerId: string; sessionId: string; generation: number }) {
      const runtime = await ports.store.transaction(key, async unit => {
        const runtime = unit.state?.runtime;
        if (!runtime || runtime.ownerId !== input.ownerId || runtime.sessionId !== input.sessionId
          || runtime.generation !== input.generation) conflict('stale_session');
        if (runtime.phase === 'DORMANT') return structuredClone(runtime);
        runtime.routeEpoch++; runtime.phase = 'QUIESCING'; runtime.pendingWake = false;
        return structuredClone(runtime);
      });
      if (runtime.phase !== 'DORMANT') await teardown(ports, key, runtime);
      return { liveSessionId: runtime.sessionId, state: 'stopped' as const };
    },
    /** Reaper: no inference of build/publication success from missing pods; interrupted candidates are fenced. */
    async recover(key: LiveKey) {
      const state = await ports.store.read(key);
      if (!state || state.runtime.phase === 'DORMANT') return;
      let runtime = state.runtime;
      runtime = await ports.store.transaction(key, async unit => {
        assertFence(unit.state, runtime);
        unit.state.runtime.phase = 'RECOVERING'; unit.state.runtime.routeEpoch++;
        unit.state.runtime.attempt = null;
        return structuredClone(unit.state.runtime);
      });
      return teardown(ports, key, runtime, 'recovered');
    },
    /** Absolute lifetime never forces publication before the idle threshold. */
    async reap(key: LiveKey) {
      const state = await ports.store.read(key);
      if (!state || state.runtime.phase === 'DORMANT' || ports.now() < state.runtime.maximumLifetimeAt) return;
      return teardown(ports, key, state.runtime, 'maximum_lifetime');
    },
  };
}
export type { LiveKey, LiveRuntime };
