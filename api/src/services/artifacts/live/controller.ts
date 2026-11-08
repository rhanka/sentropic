import type { LivePorts } from './ports';
import { assertFence, conflict, type LiveKey, type LiveRuntime } from './records';
import { crashRestore, revive } from './revive';
import { prepareLive } from './prepare-live';
import { idleBuild, queuedBuild } from './idle';
import { podName } from './pods';
import { buildOnly } from './build-only';
import { fenceInvitations } from './invitations';
import { projectRevision } from './project';
import { authorizeLive, liveRole, type LiveActor } from './authorize';
import { currentBinding, failed, teardown, transition } from './transitions';

export function createLiveController(ports: LivePorts) {
  return {
    /** Host scheduler calls this for active bindings; source grants never keep revoked pods alive. A LIVE session idle
     * for more than 900 s is reaped here, ending on the clean build. */
    async reconcile(key: LiveKey) {
      const state = await ports.store.read(key);
      if (!state || state.runtime.phase === 'DORMANT') return;
      const runtime = state.runtime;
      let binding;
      try { binding = await ports.binding(key); }
      catch (error) { await failed(ports, key, runtime, error); return; }
      if (!binding.healthy || binding.generation !== runtime.generation) {
        return teardown(ports, key, runtime, 'authority');
      }
      if (runtime.phase === 'LIVE') {
        try { await ports.pods.ensure(key, runtime); }
        catch (error) { await failed(ports, key, runtime, error); return crashRestore(ports, key, error); }
        if (!await fenceInvitations(ports, key)) return;
        return idleBuild(ports, key);
      }
      if (runtime.phase === 'BUILD_QUEUED') return queuedBuild(ports, key);
      // Recovery of an in-flight operation belongs to startup after its old API executor is fenced.
    },
    start: (key: LiveKey) => revive(ports, key),
    buildOnly: (key: LiveKey, admittedJobId: string) => buildOnly(ports, key, admittedJobId),
    project: (key: LiveKey, durableRevision: string) => projectRevision(ports, key, durableRevision),
    /** Owner or invitee route grant for the host live assertion; writes are the binding owner's only. */
    authorize: (key: LiveKey, actor: LiveActor, access: 'read' | 'write') => authorizeLive(ports, key, actor, access),
    /** Route fence after the host revocation epoch moved (remote grant): returns false when the session is not LIVE. */
    fenceInvitations: (key: LiveKey) => fenceInvitations(ports, key),
    /** Only the authenticated host calls this after an admitted source operation or visible interaction. Edits come
     * from the binding owner only; invited foreground viewing and reads may extend the session (A-LIVE §5.3). */
    async activity(key: LiveKey, sessionId: string, kind: 'edit' | 'read' | 'foreground' | 'heartbeat' | 'status' | 'ping',
      actor: LiveActor) {
      if (kind === 'heartbeat' || kind === 'status' || kind === 'ping') return;
      const binding = await currentBinding(ports, key);
      const fence = await ports.invitations.current(key, binding.generation);
      await ports.store.transaction(key, async unit => {
        const runtime = unit.state?.runtime;
        if (!runtime || runtime.generation !== binding.generation || runtime.sessionId !== sessionId) conflict('stale_session');
        if (runtime.phase !== 'LIVE') conflict('transition_busy');
        liveRole(runtime, binding, actor, kind === 'edit' ? 'write' : 'read', ports.now(), fence.epoch);
        if (kind !== 'foreground' || ports.now() - runtime.lastAccessAt >= 5000) runtime.lastAccessAt = ports.now();
      });
    },
    async wake(key: LiveKey) {
      const binding = await currentBinding(ports, key);
      let runtime = await ports.store.transaction(key, async unit => {
        const runtime = unit.state?.runtime;
        if (!runtime || runtime.phase === 'DORMANT') return;
        if (runtime.generation !== binding.generation) conflict('stale_fence');
        if (!['BUILD_PROVISIONING', 'QUIESCING', 'BUILD_QUEUED', 'BUILDING', 'VERIFYING', 'PUBLISHING', 'SAVING'].includes(runtime.phase)) conflict('transition_busy');
        runtime.pendingWake = true; runtime.routeEpoch++; runtime.phase = 'REVIVING';
        runtime.appliedRevision = null; runtime.lastAccessAt = ports.now();
        return structuredClone(runtime);
      });
      if (!runtime) return revive(ports, key);
      try {
        await ports.routes.revoke(key, runtime);
        // The higher phase fence cancels every older worker command, which ends a gated build, before restoring source.
        await ports.worker.quiesce(runtime);
        runtime = await transition(ports, key, runtime, state => { state.runtime.attempt = null; });
        // A queued or admitted build of this pod leaves the node queue; the revive phases queue on their own.
        await ports.heavy.cancel(runtime.podName);
        return await prepareLive(ports, key, runtime);
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
    /** The idle reaper (Amendment 1): no absolute lifetime; strictly after 900 s idle it ends on the clean build. */
    reap: (key: LiveKey) => idleBuild(ports, key),
    /** Liveness lease (Amendment 1 §3): one authenticated, fenced frame to a leased pod. It never renews idle time. */
    async lease(key: LiveKey) {
      const runtime = (await ports.store.read(key))?.runtime;
      if (!runtime || runtime.phase === 'DORMANT' || runtime.podUid === null) return false;
      await ports.worker.renew(runtime); return true;
    },
    /** The binding's admitted or queued heavy phases (kind, position) for the live status surface. */
    heavyStatus: (key: LiveKey) => ports.heavy.status(podName(key)),
    /** Every runtime that is not DORMANT, for the scheduler. */
    active: () => ports.store.active(),
  };
}
export type { LiveKey, LiveRuntime };
