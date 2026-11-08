import type { LivePorts } from './ports';
import type { SupervisorSources } from './supervisor';
import { LiveError } from './records';

/** Trusted forge reads at a pinned commit through the SG0-app lease (W1 broker): the head, its reachability, the
 * snapshot with its GB1 inputs, and the path-filtered staged tree a snapshot's `stagingRef` names. */
export interface ForgeReads extends Pick<LivePorts['forge'], 'head' | 'reachable' | 'snapshot'> {
  source: SupervisorSources['source'];
}

/**
 * The forge port of the builder in remote-host mode (D0): `git_commit` runs in the host LiveService, never in this
 * controller, so a fast-forward is refused as builder_unavailable and reads delegate to the lease reader.
 */
export function remoteHostForge(reads: ForgeReads): LivePorts['forge'] {
  return {
    head: key => reads.head(key),
    reachable: (key, headSha) => reads.reachable(key, headSha),
    snapshot: (key, headSha) => reads.snapshot(key, headSha),
    fastForward: async () => { throw new LiveError('builder_unavailable', 'fast_forward_remote_host'); },
  };
}

const unread = (): never => { throw new LiveError('builder_unavailable', 'forge_unconfigured'); };
/** Source-gap until the SG0-app lease reader is composed: every forge read refuses, so a build or revive fails closed
 * per operation while the host API stays up and answers. */
export const UNCONFIGURED_FORGE_READS: ForgeReads = Object.freeze({
  head: async () => unread(), reachable: async () => unread(), snapshot: async () => unread(), source: async () => unread(),
});
