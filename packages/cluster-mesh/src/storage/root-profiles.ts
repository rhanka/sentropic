import { createHash } from 'node:crypto';
import type { ProfileClaim, ProfileId } from './profiles.js';
import { UnsupportedProfileError } from './errors.js';
import type { RootScopedRuntime } from './root-facade.js';

const semantics = {
  'atomic-units-v1': 'owned-bounded-effects;sequential-k3-transactions;captured-root-cas;one-visibility-point;recovered-module-result',
  'immutable-chains-v1': 'owned-records;ordered-hash-expectations;exact-head-read-boundary;allocation-tracking',
  'immutable-boundaries-v1': 'scope-module-incarnation-hmac;exact-head-sequence-allocation;current-authority-and-coverage;r3-envelope',
  'scope-outbox-v1': 'root-owned-scoped-incarnated-segment;maintain-owner-fenced-cas-checkpoints;poison-preserving-snapshot-resync;bounded-delivery',
  'visibility-barriers-v1': 'root-owned-ancestry;atomic-content-and-barrier;current-read-denial;no-reparent-escape;retained-disposal',
  'staged-units-v1': 'sha256-framed-v1-comments;owned-ordinals;authenticated-owner-capabilities;frozen-seal;indexed-bounded-preparation;captured-root-cas;terminal-recovery;memory-only',
  'fenced-writers-v1': 'trusted-lane-provisioning;owner-epoch-lease-checks;gate-revalidation;explicit-rotation;incarnated-journal-fences',
} as const;
// Physical purge, generations and leased snapshots are not advertised by
// this memory implementation. Retained disposal is explicitly observable.
export const STAGED_PROFILES: readonly ProfileClaim[] = Object.freeze(Object.entries(semantics).map(([profile, meaning]) => Object.freeze({
  profile: profile as ProfileId, version: '1', digest: createHash('sha256').update(JSON.stringify(['storage-profile', 'v1', profile, meaning])).digest('hex'),
})));

export const rootCapability = (runtime: RootScopedRuntime, profile: ProfileId) => {
  const claim = STAGED_PROFILES.find((entry) => entry.profile === profile);
  if (!claim) throw new UnsupportedProfileError(String(profile));
  const ports = {
    'atomic-units-v1': { commitAtomic: runtime.commitAtomic.bind(runtime), transact: runtime.transact.bind(runtime) },
    'immutable-chains-v1': { appendChain: runtime.appendChain.bind(runtime), readChain: runtime.readChain.bind(runtime) },
    'immutable-boundaries-v1': { readPage: runtime.readPage.bind(runtime) },
    'scope-outbox-v1': { read: runtime.journalRead.bind(runtime), checkpoint: runtime.journalCheckpoint.bind(runtime), inspect: runtime.journalInspect.bind(runtime),
      pause: runtime.journalPause.bind(runtime), retry: runtime.journalRetry.bind(runtime), resync: runtime.journalResync.bind(runtime), snapshotRead: runtime.snapshotRead.bind(runtime) },
    'visibility-barriers-v1': { declareCoverage: runtime.declareCoverage.bind(runtime), readHead: runtime.readHead.bind(runtime) },
    'staged-units-v1': { begin: runtime.beginStaged.bind(runtime), stage: runtime.stageFragment.bind(runtime), sealStep: runtime.sealStep.bind(runtime),
      commit: runtime.commitStaged.bind(runtime), inspect: runtime.inspectStaged.bind(runtime), abort: runtime.abortStaged.bind(runtime) },
    'fenced-writers-v1': { journalFence: runtime.journalFence.bind(runtime), commitStaged: runtime.commitStaged.bind(runtime) },
  };
  return Object.freeze({ ...claim, port: Object.freeze(ports[profile as keyof typeof ports]) });
};
