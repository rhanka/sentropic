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
