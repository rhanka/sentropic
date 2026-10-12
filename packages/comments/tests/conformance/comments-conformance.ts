/**
 * Shared comments-model conformance harness.
 *
 * One corpus of canonical behaviors runs against any CanonicalCommandStore
 * implementation: CAS one-winner appends, idempotent replay, default denial,
 * all-target capability access, scope binding, exact-hash review history,
 * tombstone/archive lifecycle semantics and G4 binding without circular output
 * hashes. The in-memory store runs it in M1; the M2/M3 adapters run the same
 * corpus against real drivers.
 */

import type { CanonicalStoreScope } from '../../src/command-store.js';
import type { ResourceRef, SourceVersionIndicator, CanonicalScope } from '../../src/anchors.js';
import type { CapacityDescriptor, RevisionBody, RevisionProvenance, RevisionTargetBinding } from '../../src/revisions.js';

/** Fail the corpus with a named case when a condition does not hold. */
export const conformanceAssert = (condition: boolean, label: string): void => {
  if (!condition) {
    throw new Error(`Conformance failure: ${label}`);
  }
};

/** Await a promise and require the closed error code; any other outcome fails. */
export const expectConformanceError = async (
  operation: () => Promise<unknown> | unknown,
  expectedCode: string,
  label: string,
): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    conformanceAssert(typeof code === 'string' && code === expectedCode, `${label} (got ${String(code)})`);
    return;
  }
  conformanceAssert(false, `${label} (expected error ${expectedCode}, got success)`);
};

/** Scope of the standard conformance tenant; distinct suffixes never collide. */
export const conformanceScope = (suffix = 'a'): CanonicalStoreScope => ({
  tenantId: 'tenant-conformance',
  workspaceId: `ws-${suffix}`,
});

export const conformanceResource = (scope: CanonicalScope, id = 'res-1'): ResourceRef => ({
  scope,
  namespace: 'conformance',
  kind: 'document',
  id,
});

/** Source indicator variants (SPEC §4.2): observed, fixed-at-conversion, unknown. */
export const observedSource = (version = 'src-v1'): SourceVersionIndicator => ({
  variant: 'observed',
  sourceVersion: version,
  evidence: 'author-view-evidence',
});

export const conversionSource = (): SourceVersionIndicator => ({
  variant: 'fixed-at-conversion',
  sourceVersion: 'converted-v1',
  conversionRef: 'conversion-op-1',
  historicalGap: true,
});

export const unknownSource = (): SourceVersionIndicator => ({
  variant: 'unknown',
  classification: 'evidence-gap',
});

export const conformanceTarget = (
  resource: ResourceRef,
  source: SourceVersionIndicator = observedSource(),
): RevisionTargetBinding => ({ resource, source });

/** Plain-text body with the pinned codec descriptor; no segments or mentions. */
export const conformanceBody = (text: string): RevisionBody => ({
  text,
  codec: { format: 'plain', codecId: 'plain-v1', specDigest: 'plain-spec-digest-v1', extensions: [] },
});

/** Human self-attributed provenance with integer registration time. */
export const conformanceProvenance = (
  principal = 'author-1',
  registeredAt = 1_717_000_000_000,
): RevisionProvenance => ({
  registration: { principal, registeredAt },
  attribution: { variant: 'human', assertionClass: 'self-declared', evidence: 'user-account' },
});

/**
 * Synthetic SPEC 4.6 capacity descriptor for conformance runs: a complete
 * test fixture, never a deployed default. Every create* constructor requires
 * it and fails closed without it; the values are parameters, never record
 * content.
 */
export const conformanceCapacity = (): CapacityDescriptor => ({
  body: { limit: 1_000_000, unit: 'utf8-bytes' },
  segment: { limit: 100_000, unit: 'utf8-bytes' },
  profile: { limit: 100_000, unit: 'canonical-bytes' },
  unitManifest: { limit: 100_000, unit: 'canonical-bytes' },
  unitPayload: { limit: 1_000_000, unit: 'utf8-bytes' },
  batchUnits: { limit: 1_000, unit: 'units' },
  batchManifest: { limit: 1_000_000, unit: 'canonical-bytes' },
  batchRequest: { limit: 10_000_000, unit: 'canonical-bytes' },
  pageRecords: { limit: 500, unit: 'records' },
  pageEncodedBytes: { limit: 10_000_000, unit: 'utf8-bytes' },
});

import {
  COMMAND_CAPABILITIES,
  commandIdempotencyKey,
  commandPayloadDigest,
  computeProposedContentDigest,
  defaultDenyCapabilityCheck,
  resolveIdempotentReplay,
  checkDecisionEvidence,
  type CapabilityCheckPort,
  type CommittedCommand,
  type DecisionEvidence,
} from '../../src/commands.js';
import type { CanonicalCommandStore } from '../../src/command-store.js';
import {
  createAnnotationRevision,
  createCommentRevision,
  createThreadStructureRevision,
} from '../../src/revisions.js';
import { createReviewEvent, projectReviewState } from '../../src/reviews.js';
import { createLifecycleEvent, projectLifecycleState } from '../../src/lifecycle.js';

/**
 * Run the canonical corpus against one store implementation. Every case throws
 * a labeled `Conformance failure` when the implementation deviates.
 */
export const runCommentsConformance = async (store: CanonicalCommandStore): Promise<void> => {
  const scope = conformanceScope();
  const capacity = conformanceCapacity();
  const resource = conformanceResource(scope);
  const input = (text: string, source: SourceVersionIndicator = observedSource()) => ({
    scope,
    annotationId: 'ann-1',
    primary: conformanceTarget(resource, source),
    secondary: [],
    visualAnchors: [],
    body: conformanceBody(text),
    provenance: conformanceProvenance(),
  });

  const genesis = createAnnotationRevision(null, input('first'), capacity);
  await store.appendAnnotationRevision(scope, 'ann-1', genesis, { kind: 'creation', aggregateVersion: 0 });
  const winner = createAnnotationRevision(genesis, input('second'), capacity);
  const loser = createAnnotationRevision(genesis, input('third'), capacity);
  conformanceAssert(winner.hash !== loser.hash, 'cas: divergent edits hash differently');
  await store.appendAnnotationRevision(scope, 'ann-1', winner, { kind: 'revision', revisionHash: genesis.hash });
  await expectConformanceError(
    () => store.appendAnnotationRevision(scope, 'ann-1', loser, { kind: 'revision', revisionHash: genesis.hash }),
    'cas-conflict',
    'cas: the second writer against the same head conflicts',
  );
  const chain = await store.getAnnotationChain(scope, 'ann-1');
  conformanceAssert(chain.length === 2 && chain[1].hash === winner.hash, 'cas: exactly one winner');

  const digest = commandPayloadDigest({ action: 'revise', text: 'second' });
  const committed: CommittedCommand = { digest, resultIds: ['ann-1'], resultHash: winner.hash };
  const key = commandIdempotencyKey('conformance-key-1');
  await store.recordCommittedCommand(scope, key, committed);
  const found = await store.findCommittedCommand(scope, key);
  conformanceAssert(found !== null && found.resultHash === winner.hash, 'replay: the committed command is indexed');
  conformanceAssert(resolveIdempotentReplay(committed, digest).result === committed, 'replay: unchanged replay returns the committed result');
  await expectConformanceError(
    () => resolveIdempotentReplay(committed, commandPayloadDigest({ action: 'revise', text: 'changed' })),
    'idempotency-conflict',
    'replay: a changed replay conflicts',
  );
  await expectConformanceError(
    () => store.recordCommittedCommand(scope, key, { digest: commandPayloadDigest({ other: true }), resultIds: [], resultHash: null }),
    'idempotency-conflict',
    'replay: a conflicting index write is rejected',
  );

  for (const capability of COMMAND_CAPABILITIES) {
    conformanceAssert(
      (await defaultDenyCapabilityCheck.check('principal-1', capability, [resource])) === false,
      'authority: an unconfigured capability denies by default',
    );
  }

  const seen: ResourceRef[][] = [];
  const recording: CapabilityCheckPort = {
    check: async (_principal, _capability, targets) => {
      seen.push([...targets]);
      return true;
    },
  };
  const secondary = conformanceResource(scope, 'res-2');
  const allowed = await recording.check('principal-1', 'revise', [resource, secondary]);
  conformanceAssert(allowed && seen[0].length === 2, 'authority: a capability check covers every target');

  const otherWorkspace = conformanceScope('b');
  conformanceAssert((await store.getAnnotationHead(otherWorkspace, 'ann-1')) === null, 'scope: another workspace sees no chain');
  const otherTenant = { tenantId: 'tenant-other', workspaceId: 'ws-a' };
  conformanceAssert((await store.getAnnotationHead(otherTenant, 'ann-1')) === null, 'scope: another tenant sees no chain');
  await expectConformanceError(
    () => store.appendAnnotationRevision(otherWorkspace, 'ann-1', winner, { kind: 'revision', revisionHash: genesis.hash }),
    'invalid-command',
    'scope: a cross-scope append is rejected',
  );

  const conversionBound = createAnnotationRevision(winner, input('fourth', conversionSource()), capacity);
  await store.appendAnnotationRevision(scope, 'ann-1', conversionBound, { kind: 'revision', revisionHash: winner.hash });
  const unknownBound = createAnnotationRevision(conversionBound, input('fifth', unknownSource()), capacity);
  await store.appendAnnotationRevision(scope, 'ann-1', unknownBound, { kind: 'revision', revisionHash: conversionBound.hash });
  conformanceAssert(
    (await store.getAnnotationHead(scope, 'ann-1'))?.hash === unknownBound.hash,
    'sources: observed, fixed-at-conversion and unknown indicators are all accepted',
  );
  const head = unknownBound;

  const reviewInput = (
    action: 'submit' | 'validate' | 'contest' | 'resolve-contest' | 'withdraw',
    revisionHash: string,
    extra: Partial<{ referencesEventHash: string | null; decision: { principal: string; outcome: 'accept' | 'reject' | 'abstain' } }> = {},
  ) => ({
    scope,
    annotationId: 'ann-1',
    action,
    revisionHash,
    referencesEventHash: null,
    actor: { principal: 'reviewer-1' },
    decision: null,
    proposal: null,
    executor: null,
    ...extra,
  });

  const reviews: ReturnType<typeof createReviewEvent>[] = [];
  reviews.push(createReviewEvent(reviews, reviewInput('submit', head.hash), capacity));
  const validation = createReviewEvent(reviews, reviewInput('validate', head.hash, { decision: { principal: 'reviewer-1', outcome: 'accept' } }), capacity);
  reviews.push(validation);
  const contest = createReviewEvent(reviews, reviewInput('contest', head.hash, { referencesEventHash: validation.hash }), capacity);
  reviews.push(contest);
  const resolution = createReviewEvent(reviews, reviewInput('resolve-contest', head.hash, { referencesEventHash: contest.hash, decision: { principal: 'reviewer-2', outcome: 'accept' } }), capacity);
  reviews.push(resolution);
  let projection = projectReviewState(reviews, head.hash);
  conformanceAssert(projection.state === 'contested', 'review: a resolved contest does not silently revalidate');
  conformanceAssert(projection.requiresRenewedValidation, 'review: a resolved contest requires renewed validation');
  conformanceAssert(
    projection.contests.some((entry) => entry.eventHash === contest.hash && entry.contestsEventHash === validation.hash && entry.resolvedByEventHash === resolution.hash),
    'review: the resolved contest stays visible with exact hashes',
  );
  reviews.push(createReviewEvent(reviews, reviewInput('validate', head.hash, { decision: { principal: 'reviewer-3', outcome: 'accept' } }), capacity));
  conformanceAssert(projectReviewState(reviews, head.hash).state === 'validated', 'review: renewed validation revalidates');
  const staleProjection = projectReviewState(reviews, genesis.hash);
  conformanceAssert(staleProjection.state === 'none' && staleProjection.staleEventHashes.length === reviews.length, 'review: events pinned to a superseded revision are stale');

  const lifecycleInput = (
    action: 'archive' | 'restore' | 'tombstone' | 'purge-intent' | 'purge-outcome',
    extra: Partial<{ archiveKind: 'shared' | 'personal' }> = {},
  ) => ({ scope, objectKind: 'annotation' as const, objectId: 'ann-1', action, archiveKind: null, actor: { principal: 'admin-1' }, reason: null, ...extra });
  const lifecycle: ReturnType<typeof createLifecycleEvent>[] = [];
  lifecycle.push(createLifecycleEvent(lifecycle, lifecycleInput('archive', { archiveKind: 'shared' }), capacity));
  conformanceAssert(projectLifecycleState(lifecycle).archived, 'lifecycle: an archive is projected');
  lifecycle.push(createLifecycleEvent(lifecycle, lifecycleInput('restore'), capacity));
  conformanceAssert(!projectLifecycleState(lifecycle).archived && projectLifecycleState(lifecycle).available, 'lifecycle: an archive is reversible');
  lifecycle.push(createLifecycleEvent(lifecycle, lifecycleInput('tombstone'), capacity));
  conformanceAssert(!projectLifecycleState(lifecycle).available, 'lifecycle: a tombstone removes availability');
  await expectConformanceError(() => createLifecycleEvent(lifecycle, lifecycleInput('archive', { archiveKind: 'shared' }), capacity), 'tombstoned', 'lifecycle: a tombstoned object cannot be archived');
  await expectConformanceError(() => createLifecycleEvent(lifecycle, lifecycleInput('tombstone'), capacity), 'tombstoned', 'lifecycle: a tombstone is irreversible');
  await expectConformanceError(() => createLifecycleEvent(lifecycle, lifecycleInput('restore'), capacity), 'tombstoned', 'lifecycle: recovery cannot resurrect a tombstone');
  lifecycle.push(createLifecycleEvent(lifecycle, lifecycleInput('purge-intent'), capacity));
  lifecycle.push(createLifecycleEvent(lifecycle, lifecycleInput('purge-outcome'), capacity));
  conformanceAssert(projectLifecycleState(lifecycle).purge === 'purged', 'lifecycle: the purge state is explicit');

  const proposal = { primary: conformanceTarget(resource), secondary: [], visualAnchors: [], body: conformanceBody('proposed content') };
  const proposedContentDigest = computeProposedContentDigest(proposal);
  const evidence: DecisionEvidence = {
    actor: 'author-1',
    action: 'revise',
    scope,
    issuedAt: 1_717_000_000_000,
    expiresAt: null,
    revoked: false,
    revocationVersion: 0,
    authority: 'host-authority',
    binding: { kind: 'creation', aggregateVersion: 0, proposedContentDigest },
  };
  const g4Output = createAnnotationRevision(null, { ...input('proposed content'), annotationId: 'ann-g4' }, capacity);
  conformanceAssert(g4Output.hash !== proposedContentDigest, 'g4: a decision never binds its own future output hash');
  checkDecisionEvidence(evidence, {
    actor: 'author-1',
    action: 'revise',
    scope,
    now: 1_717_000_000_001,
    binding: { kind: 'creation', aggregateVersion: 0, proposedContentDigest },
  });
  await expectConformanceError(
    () =>
      checkDecisionEvidence(evidence, {
        actor: 'author-1',
        action: 'revise',
        scope,
        now: 1_717_000_000_001,
        binding: { kind: 'creation', aggregateVersion: 0, proposedContentDigest: computeProposedContentDigest({ tampered: true }) },
      }),
    'denied',
    'g4: a mismatched proposed-content digest denies the action',
  );

  const plainThread = createThreadStructureRevision(null, {
    scope,
    threadId: 'thread-plain',
    trigger: 'initial-registration',
    primary: conformanceTarget(resource),
    annotationId: null,
    provenance: conformanceProvenance(),
  }, capacity);
  await store.appendThreadStructureRevision(scope, 'thread-plain', plainThread, { kind: 'creation', aggregateVersion: 0 });
  const structurePin = { id: 'thread-plain', hash: plainThread.hash };
  const commentInput = (commentId: string, text: string, pin: { annotationId: string; revisionHash: string } | null) => ({
    scope,
    threadId: 'thread-plain',
    commentId,
    parentCommentId: null,
    structureRevision: structurePin,
    annotationPin: pin,
    body: conformanceBody(text),
    provenance: conformanceProvenance(),
  });
  await store.appendCommentRevision(scope, 'comment-plain', createCommentRevision(null, commentInput('comment-plain', 'plain reply', null), capacity), { kind: 'creation', aggregateVersion: 0 });
  const pinsGenesis = createCommentRevision(null, commentInput('comment-old-pin', 'pins the genesis revision', { annotationId: 'ann-1', revisionHash: genesis.hash }), capacity);
  await store.appendCommentRevision(scope, 'comment-old-pin', pinsGenesis, { kind: 'creation', aggregateVersion: 0 });
  const pinsHead = createCommentRevision(null, commentInput('comment-new-pin', 'pins the head revision', { annotationId: 'ann-1', revisionHash: head.hash }), capacity);
  await store.appendCommentRevision(scope, 'comment-new-pin', pinsHead, { kind: 'creation', aggregateVersion: 0 });
  conformanceAssert(
    pinsGenesis.annotationPin !== null && pinsHead.annotationPin !== null && pinsGenesis.annotationPin.revisionHash !== pinsHead.annotationPin.revisionHash,
    'pins: comments may pin different revisions of one annotation and coexist',
  );
};
