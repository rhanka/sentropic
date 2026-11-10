import type { LivePorts } from './ports';
import type { SupervisorSources } from './supervisor';

/** Trusted forge reads at a pinned commit through the SG0-app lease (W1 broker): the head, its reachability, the
 * snapshot with its GB1 inputs, and the path-filtered staged tree a snapshot's `stagingRef` names. */
export interface ForgeReads extends Pick<LivePorts['forge'], 'head' | 'reachable' | 'snapshot'> {
  source: SupervisorSources['source'];
}

/**
 * The forge port of the builder in remote-host mode (D0): `git_commit` runs in the host LiveService, never in this
 * controller, and reads delegate to the lease reader (`createLeaseForgeReads`). The controller never moves a ref:
 * `fastForward` only confirms, read-only, a fast-forward the host already made (the branch head is `after` and
 * `before` is its ancestor); anything else reads as a divergence (`git_diverged` at the caller).
 */
export function remoteHostForge(reads: ForgeReads): LivePorts['forge'] {
  return {
    head: key => reads.head(key),
    reachable: (key, headSha) => reads.reachable(key, headSha),
    snapshot: (key, headSha) => reads.snapshot(key, headSha),
    fastForward: async (key, before, after) => (await reads.head(key)) === after && reads.reachable(key, before),
  };
}

