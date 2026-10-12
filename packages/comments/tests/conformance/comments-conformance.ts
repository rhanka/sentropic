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
import type { RevisionBody, RevisionProvenance, RevisionTargetBinding } from '../../src/revisions.js';

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

/**
 * Run the canonical corpus against one store implementation. Every case throws
 * a labeled `Conformance failure` when the implementation deviates.
 */
export const runCommentsConformance = async (store: CanonicalCommandStore): Promise<void> => {
  const scope = conformanceScope();
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

  const genesis = createAnnotationRevision(null, input('first'));
  await store.appendAnnotationRevision(scope, 'ann-1', genesis, { kind: 'creation', aggregateVersion: 0 });
  const winner = createAnnotationRevision(genesis, input('second'));
  const loser = createAnnotationRevision(genesis, input('third'));
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

  const conversionBound = createAnnotationRevision(winner, input('fourth', conversionSource()));
  await store.appendAnnotationRevision(scope, 'ann-1', conversionBound, { kind: 'revision', revisionHash: winner.hash });
  const unknownBound = createAnnotationRevision(conversionBound, input('fifth', unknownSource()));
  await store.appendAnnotationRevision(scope, 'ann-1', unknownBound, { kind: 'revision', revisionHash: conversionBound.hash });
  conformanceAssert(
    (await store.getAnnotationHead(scope, 'ann-1'))?.hash === unknownBound.hash,
    'sources: observed, fixed-at-conversion and unknown indicators are all accepted',
  );
  const head = unknownBound;
