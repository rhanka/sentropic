import { createHash } from 'node:crypto';
import { UnsupportedProfileError } from '../errors.js';
import type { ProfileClaim, ProfileId } from '../profiles.js';
import type { PgScoped } from './scope.js';
const meanings = {
  'atomic-units-v1':
    'owned bounded plans;serializable sequential transactions;one root CAS;durable complete receipts;immutable flush retries only',
  'immutable-chains-v1': 'canonical bytea payloads;per-chain allocation;ordered head CAS;retained identities',
  'immutable-boundaries-v1':
    'exact head sequence allocation HMAC;owner scope incarnation root manifests;current coverage;no TTL;full page envelopes',
  'scope-outbox-v1':
    'one committed segment in selected log;same-session append replay;contiguous fenced checkpoints;registered snapshot resync;poison retained',
  'visibility-barriers-v1':
    'persistent ancestry;atomic barrier and content publication;current getter/page denial;covered reparenting refused',
  'staged-units-v1':
    'comments framed SHA256 v1;durable owned ordinals and authenticated owner capabilities;portable bounded preparation;frozen root CAS;terminal recovery',
  'fenced-writers-v1':
    'durable owner epoch incarnation lanes;database clock leases;post-wait gate checks;explicit recovery and rotation',
  'purge-jobs-v1':
    'durable bounded jobs;holds and shared references;canonical bytea and staged-item erasure;one verified outcome and notification;no archive restore claim',
} as const;
const claims: readonly ProfileClaim[] = Object.freeze(
  Object.entries(meanings).map(([profile, meaning]) =>
    Object.freeze({
      profile: profile as ProfileId,
      version: '1',
      digest: createHash('sha256')
        .update(JSON.stringify(['storage-profile', 'v1', profile, meaning]))
        .digest('hex'),
    }),
  ),
);
export const pgProfileClaims = (module: string, resync: boolean): readonly ProfileClaim[] =>
  Object.freeze(
    claims.filter(
      (claim) =>
        (module === 'comments' || claim.profile !== 'staged-units-v1') &&
        (resync || claim.profile !== 'scope-outbox-v1'),
    ),
  );
const ports = (runtime: PgScoped) => ({
  'atomic-units-v1': { commitAtomic: runtime.commitAtomic.bind(runtime), transact: runtime.transact.bind(runtime) },
  'immutable-chains-v1': { appendChain: runtime.appendChain.bind(runtime), readChain: runtime.readChain.bind(runtime) },
  'immutable-boundaries-v1': {
    readPage: runtime.readPage.bind(runtime),
    captureManifest: runtime.captureManifest.bind(runtime),
    verifyManifest: runtime.verifyManifest.bind(runtime),
    readManifestPage: runtime.manifestReadPage.bind(runtime),
  },
  'scope-outbox-v1': {
    read: runtime.journalRead.bind(runtime),
    checkpoint: runtime.journalCheckpoint.bind(runtime),
    inspect: runtime.journalInspect.bind(runtime),
    pause: runtime.journalPause.bind(runtime),
    retry: runtime.journalRetry.bind(runtime),
    resync: runtime.journalResync.bind(runtime),
    snapshotRead: runtime.snapshotRead.bind(runtime),
  },
  'visibility-barriers-v1': {
    declareCoverage: runtime.declareCoverage.bind(runtime),
    readHead: runtime.readHead.bind(runtime),
    query: runtime.query.bind(runtime),
  },
  'staged-units-v1': {
    begin: runtime.beginStaged.bind(runtime),
    stage: runtime.stageFragment.bind(runtime),
    sealStep: runtime.sealStep.bind(runtime),
    commit: runtime.commitStaged.bind(runtime),
    inspect: runtime.inspectStaged.bind(runtime),
    abort: runtime.abortStaged.bind(runtime),
  },
  'fenced-writers-v1': {
    journalFence: runtime.journalFence.bind(runtime),
    commitAtomic: runtime.commitAtomic.bind(runtime),
    commitStaged: runtime.commitStaged.bind(runtime),
  },
  'purge-jobs-v1': {
    configure: runtime.configureLifecycle.bind(runtime),
    progress: runtime.purgeProgress.bind(runtime),
    step: runtime.completePurge.bind(runtime),
    read: runtime.purgeRead.bind(runtime),
    hold: runtime.holdTarget.bind(runtime),
  },
});
export type PgProfilePorts = ReturnType<typeof ports>;
export type PgCapability<P extends ProfileId> = ProfileClaim & {
  readonly profile: P;
  readonly port: P extends keyof PgProfilePorts ? Readonly<PgProfilePorts[P]> : never;
};
export const pgCapability = <P extends ProfileId>(
  runtime: PgScoped,
  available: readonly ProfileClaim[],
  profile: P,
): PgCapability<P> => {
  const claim = available.find((entry) => entry.profile === profile);
  if (!claim) throw new UnsupportedProfileError(String(profile));
  return Object.freeze({
    ...claim,
    port: Object.freeze(ports(runtime)[profile as keyof PgProfilePorts]),
  }) as PgCapability<P>;
};
