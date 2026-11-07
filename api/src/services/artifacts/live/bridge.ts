import type { LivePorts } from './ports';
import { conflict, type LiveKey } from './records';
import type { createLiveController } from './controller';

/** Identity as carried by the package LiveService (`LiveWorkerPort`); structural to avoid a package import cycle. */
export interface BridgeIdentity extends LiveKey { bindingGeneration: number }
export interface BridgeAck { liveSessionId: string; leaseEpoch: number; routeEpoch: number; revision: string; ready: boolean }
const ATTEMPT_PHASES = ['BUILD_PROVISIONING', 'QUIESCING', 'BUILDING', 'VERIFYING', 'PUBLISHING', 'SAVING'];

/**
 * Adapts the API controller to the package `LiveWorkerPort`. The package is the contract owner: revisions are opaque
 * strings. A durable ACK in the package store precedes this call; the controller only reconciles toward that draft.
 * `packageRuntime` returns the package-store session/lease/route fences echoed in the ACK (the package validates them).
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
        throw error;
      }
      const fences = await deps.packageRuntime(identity);
      return { ...fences, revision: draft.revision, ready: runtime.phase === 'LIVE' && runtime.appliedRevision === draft.revision };
    },
    async stop(input: BridgeIdentity & { liveSessionId: string; leaseEpoch: number }): Promise<void> {
      if ((await deps.packageRuntime(input)).liveSessionId !== input.liveSessionId) conflict('stale_session');
      const stored = await deps.ports.store.read(keyOf(input));
      if (!stored || stored.runtime.phase === 'DORMANT') return;
      const { ownerId, sessionId, generation } = stored.runtime;
      await deps.controller.stop(keyOf(input), { ownerId, sessionId, generation });
    },
  };
}
