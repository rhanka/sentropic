import type { LivePorts } from './ports';
import { LiveError, type LiveKey } from './records';
import type { createLiveController } from './controller';

/** Identity as carried by the package LiveService (`LiveWorkerPort`); structural to avoid a package import cycle. */
export interface BridgeIdentity extends LiveKey { bindingGeneration: number }
/** Terminal failure of an abandoned revive, in the `code:reason` shape of the `artifact_live_phase` fail line and
 * the host `stateDetail` (e.g. `{ code: 'builder_unavailable', reason: 'phase_timeout:install:drain' }`). The
 * package exposes it through `onWorkerEvent` and its own `stateDetail` and stops re-driving the item; a later
 * owner start or edit revives it. Unknown fields stay ignored by older package readers. */
export interface BridgeFailure { code: string; reason: string }
export interface BridgeAck { liveSessionId: string; leaseEpoch: number; routeEpoch: number; revision: string; ready: boolean;
  /** Present only when the builder abandoned this revive; absent while the revive still runs or may be retried. */
  failure?: BridgeFailure }
const ATTEMPT_PHASES = ['BUILD_PROVISIONING', 'QUIESCING', 'BUILDING', 'VERIFYING', 'PUBLISHING', 'SAVING'];

/**
 * Adapts the API controller to the package `LiveWorkerPort`. The package is the contract owner: revisions are opaque
 * strings. A durable ACK in the package store precedes this call; the controller only reconciles toward that draft.
 * `packageRuntime` returns the package-store session/lease/route fences echoed in the ACK (the package validates them).
 * A stop is total: when the builder holds no (or no longer this) session it answers without touching any runtime,
 * so a re-driven stop converges instead of replaying a refusal forever.
 */
export function createLiveWorkerBridge(deps: {
  controller: ReturnType<typeof createLiveController>; ports: Pick<LivePorts, 'store' | 'drafts'>;
  packageRuntime(identity: BridgeIdentity): Promise<{ liveSessionId: string; leaseEpoch: number; routeEpoch: number }>;
}) {
  const keyOf = (i: BridgeIdentity): LiveKey => ({ storageScopeId: i.storageScopeId, artifactId: i.artifactId });
  return {
    async reconcile(identity: BridgeIdentity): Promise<BridgeAck> {
      const key = keyOf(identity);
      const draft = await deps.ports.drafts.current(key, identity.bindingGeneration);
      const stored = await deps.ports.store.read(key);
      const phase = stored?.runtime.phase ?? 'DORMANT';
      // An edit against an idle attempt wakes first (cancels the older fence); project then follows the commit.
      if (ATTEMPT_PHASES.includes(phase)) await deps.controller.wake(key);
      let runtime;
      try { runtime = await deps.controller.project(key, draft.revision); }
      catch (error) {
        if ((error as { code?: string }).code === 'git_live_revision_moved') return { ...await deps.packageRuntime(identity), revision: draft.revision, ready: false };
        // The builder abandoned the revive (install ceiling, repeated supervisor loss, recipe failure): the typed
        // code already rode the phase log line and the host stateDetail, so report it and stop the re-drive.
        if (error instanceof LiveError && error.code === 'builder_unavailable') {
          return { ...await deps.packageRuntime(identity), revision: draft.revision, ready: false,
            failure: { code: error.code, reason: error.reason ?? error.code } };
        }
        throw error;
      }
      const fences = await deps.packageRuntime(identity);
      return { ...fences, revision: draft.revision, ready: runtime.phase === 'LIVE' && runtime.appliedRevision === draft.revision };
    },
    async stop(input: BridgeIdentity & { liveSessionId: string; leaseEpoch: number }): Promise<void> {
      let fences;
      try { fences = await deps.packageRuntime(input); }
      catch (error) {
        // No remembered package session for this generation (never reconciled, or moved on): the builder holds
        // nothing of this session, so refusing would replay the stop forever. The stop is total.
        if (error instanceof LiveError && error.code === 'git_live_conflict') return;
        throw error;
      }
      // Fences of another session or lease: this session is gone from the package. The stored runtime id is
      // builder-local, so no local runtime can be attributed to the requester; never touch the runtime another
      // session may own. The stop is total.
      if (fences.liveSessionId !== input.liveSessionId || fences.leaseEpoch !== input.leaseEpoch) return;
      const stored = await deps.ports.store.read(keyOf(input));
      if (!stored || stored.runtime.phase === 'DORMANT') return;
      const { ownerId, sessionId, generation } = stored.runtime;
      await deps.controller.stop(keyOf(input), { ownerId, sessionId, generation });
    },
  };
}
