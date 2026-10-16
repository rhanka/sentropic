// @sentropic/llm-mesh/enrollment/seat-bundle.ts
//
// SeatBundleV1: frozen five-CLI seat envelope and source contract.
// Lot L0a, synthetic first: types plus static validators only.
// This module performs no home, keyring, network or provider access.
// Native profile variants stay UNVERIFIED until observed; fixtures are invented.

export const SEAT_BUNDLE_SCHEMA_VERSION = 1 as const;

/** GitHub repository-secret snapshot limit; each serialized bundle must fit. */
export const SEAT_BUNDLE_MAX_BYTES = 48 * 1024;

export type SeatCli = 'agy' | 'codex' | 'vibe' | 'muse' | 'claude';

export type SeatAuthority = 'custodian' | 'consumer' | 'native-store';

export type SeatCredentialClass = 'renewable' | 'static-key' | 'access-only' | 'store-reference';

export type SeatRefreshAuthority = 'custody' | 'none';

/** Package enrollment identity per CLI; agy enrolls as cloud-code. */
export const SEAT_PACKAGE_PROVIDER_ID: Record<SeatCli, string> = {
  agy: 'cloud-code',
  codex: 'codex',
  vibe: 'mistral-vibe',
  muse: 'muse',
  claude: 'claude-code',
};

/** Application receiver tuple for agy; application cloud-code targets gemini and is refused. */
export const SEAT_AGY_APPLICATION_TUPLE = {
  transportProviderId: 'antigravity',
  targetProviderId: 'cloudcode-pa',
  productAccountSource: 'antigravity',
} as const;

/** Refresh-capable key names that must never appear in a consumer payload. */
const FORBIDDEN_REFRESH_KEYS = new Set([
  'refreshToken',
  'refresh_token',
  'sessionToken',
  'session_token',
  'deviceToken',
  'device_token',
  'deviceCode',
  'device_code',
]);

const TOP_LEVEL_KEYS = [
  'identity', 'provenance', 'authority', 'credentialClass',
  'lifecycle', 'canonical', 'nativeUse', 'meshUse',
] as const;

const IDENTITY_KEYS = [
  'schemaVersion', 'seatRef', 'refreshFamilyRef', 'ownerScope', 'cli',
  'packageProviderId', 'credentialFormatVersion', 'nativeCliVersion', 'os',
] as const;

const PROVENANCE_KEYS = ['enrollmentSource', 'accountBinding', 'entitlementClass'] as const;

const LIFECYCLE_KEYS = [
  'epoch', 'generation', 'operationId', 'issuedAt',
  'providerExpiry', 'localExpiryPolicy', 'refreshAuthority',
] as const;

const CANONICAL_KEYS = ['kind', 'materialRef'] as const;

const PROJECTION_KEYS = ['kind', 'accessRef', 'reason'] as const;

export interface SeatBundleIdentity {
  schemaVersion: 1;
  seatRef: string;
  refreshFamilyRef?: string;
  ownerScope: string;
  cli: SeatCli;
  packageProviderId: string;
  credentialFormatVersion: string;
  nativeCliVersion?: string;
  os?: 'linux' | 'macos' | 'windows';
}

export interface SeatBundleProvenance {
  enrollmentSource: 'cli';
  accountBinding: string;
  entitlementClass: string;
}

export interface SeatBundleLifecycle {
  epoch: number;
  generation: number;
  operationId: string;
  issuedAt: string;
  providerExpiry?: string;
  localExpiryPolicy: string;
  refreshAuthority: SeatRefreshAuthority;
}

export interface SeatCanonicalMaterial {
  kind: 'renewable-material' | 'static-key-material';
  materialRef: string;
}

export interface SeatAccessProjection {
  kind: 'access' | 'static-key' | 'unavailable';
  accessRef?: string;
  reason?: string;
}

export interface SeatBundleV1 {
  identity: SeatBundleIdentity;
  provenance: SeatBundleProvenance;
  authority: SeatAuthority;
  credentialClass: SeatCredentialClass;
  lifecycle: SeatBundleLifecycle;
  canonical?: SeatCanonicalMaterial;
  nativeUse?: SeatAccessProjection;
  meshUse: SeatAccessProjection;
}

export type SeatValidationCode =
  | 'schema-mismatch'
  | 'size-exceeded'
  | 'owner-mismatch'
  | 'client-mismatch'
  | 'stale-generation'
  | 'unknown-field'
  | 'refresh-material-present'
  | 'nested-refresh-field'
  | 'authority-escalation'
  | 'invalid-lifecycle';

export type SeatValidationResult =
  | { ok: true; bundle: SeatBundleV1; idempotentReimport?: boolean }
  | { ok: false; code: SeatValidationCode; detail: string };

export interface SeatReceipt {
  seatRef: string;
  cli: SeatCli;
  epoch: number;
  generation: number;
  operationId: string;
  outcome: 'valid' | 'invalid';
  reason?: SeatValidationCode;
  checkedAt: string;
}

function fail(code: SeatValidationCode, detail: string): SeatValidationResult {
  return { ok: false, code, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(value).find((k) => !allowed.includes(k)) ?? null;
}

function findRefreshKey(value: unknown, depth: number): { key: string; depth: number } | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findRefreshKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_REFRESH_KEYS.has(key)) return { key, depth };
    const hit = findRefreshKey(value[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

/** Structural validation of one bundle; predecessor comparison stays in isStaleGeneration. */
export function validateSeatBundle(bundle: unknown, ctx?: { ownerScope?: string }): SeatValidationResult {
  let serialized = '';
  try {
    serialized = JSON.stringify(bundle) ?? '';
  } catch {
    return fail('schema-mismatch', 'bundle is not JSON-serializable');
  }
  if (serialized.length > SEAT_BUNDLE_MAX_BYTES) return fail('size-exceeded', 'bundle exceeds 48 KiB');
  if (!isRecord(bundle)) return fail('schema-mismatch', 'bundle must be an object');
  const badTop = unknownKey(bundle, TOP_LEVEL_KEYS);
  if (badTop) return fail('unknown-field', `unknown top-level field: ${badTop}`);
  const { identity, provenance, authority, credentialClass, lifecycle, canonical, nativeUse, meshUse } = bundle;
  if (!isRecord(identity)) return fail('schema-mismatch', 'identity must be an object');
  if (!isRecord(provenance)) return fail('schema-mismatch', 'provenance must be an object');
  if (!isRecord(lifecycle)) return fail('schema-mismatch', 'lifecycle must be an object');
  if (!isRecord(meshUse)) return fail('schema-mismatch', 'meshUse must be an object');
  const badIdentity = unknownKey(identity, IDENTITY_KEYS);
  if (badIdentity) return fail('unknown-field', `unknown identity field: ${badIdentity}`);
  const badProvenance = unknownKey(provenance, PROVENANCE_KEYS);
  if (badProvenance) return fail('unknown-field', `unknown provenance field: ${badProvenance}`);
  const badLifecycle = unknownKey(lifecycle, LIFECYCLE_KEYS);
  if (badLifecycle) return fail('unknown-field', `unknown lifecycle field: ${badLifecycle}`);
  if (identity['schemaVersion'] !== SEAT_BUNDLE_SCHEMA_VERSION) {
    return fail('schema-mismatch', 'identity.schemaVersion must be 1');
  }
  const cli = identity['cli'];
  if (cli !== 'agy' && cli !== 'codex' && cli !== 'vibe' && cli !== 'muse' && cli !== 'claude') {
    return fail('client-mismatch', 'identity.cli must be one of the five seat CLIs');
  }
  if (identity['packageProviderId'] !== SEAT_PACKAGE_PROVIDER_ID[cli]) {
    return fail('client-mismatch', `identity.packageProviderId must be ${SEAT_PACKAGE_PROVIDER_ID[cli]}`);
  }
  if (!nonEmpty(identity['seatRef'])) return fail('schema-mismatch', 'identity.seatRef must be non-empty');
  if (!nonEmpty(identity['ownerScope'])) return fail('schema-mismatch', 'identity.ownerScope must be non-empty');
  if (!nonEmpty(identity['credentialFormatVersion'])) {
    return fail('schema-mismatch', 'identity.credentialFormatVersion must be non-empty');
  }
  if (ctx?.ownerScope !== undefined && identity['ownerScope'] !== ctx.ownerScope) {
    return fail('owner-mismatch', 'identity.ownerScope does not match the verified owner');
  }
  if (provenance['enrollmentSource'] !== 'cli') return fail('schema-mismatch', 'provenance.enrollmentSource must be cli');
  if (!nonEmpty(provenance['accountBinding'])) return fail('schema-mismatch', 'provenance.accountBinding must be non-empty');
  if (!nonEmpty(provenance['entitlementClass'])) {
    return fail('schema-mismatch', 'provenance.entitlementClass must be non-empty');
  }
  if (!validInt(lifecycle['epoch'], 1)) return fail('invalid-lifecycle', 'lifecycle.epoch must be an integer >= 1');
  if (!validInt(lifecycle['generation'], 0)) {
    return fail('invalid-lifecycle', 'lifecycle.generation must be an integer >= 0');
  }
  if (!nonEmpty(lifecycle['operationId'])) return fail('invalid-lifecycle', 'lifecycle.operationId must be non-empty');
  if (!validDate(lifecycle['issuedAt'])) return fail('invalid-lifecycle', 'lifecycle.issuedAt must be a valid date');
  if (!nonEmpty(lifecycle['localExpiryPolicy'])) {
    return fail('invalid-lifecycle', 'lifecycle.localExpiryPolicy must be non-empty');
  }
  if (authority !== 'custodian' && authority !== 'consumer' && authority !== 'native-store') {
    return fail('schema-mismatch', 'authority must be custodian, consumer or native-store');
  }
  const credClass = credentialClass;
  if (credClass !== 'renewable' && credClass !== 'static-key' && credClass !== 'access-only' && credClass !== 'store-reference') {
    return fail('schema-mismatch', 'credentialClass must be a known class');
  }
  if (credClass === 'static-key' && identity['refreshFamilyRef'] !== undefined) {
    return fail('schema-mismatch', 'a static key carries no refresh family');
  }
  if (credClass !== 'static-key' && !nonEmpty(identity['refreshFamilyRef'])) {
    return fail('schema-mismatch', 'a non-static seat requires refreshFamilyRef');
  }
  if (authority !== 'custodian') {
    if (lifecycle['refreshAuthority'] !== 'none') {
      return fail('authority-escalation', 'only the custodian holds refresh authority');
    }
    if (credClass === 'renewable' || credClass === 'store-reference') {
      return fail('authority-escalation', 'a non-custodian payload cannot carry a renewable class');
    }
    if (canonical !== undefined) {
      return fail('authority-escalation', 'a non-custodian payload cannot carry canonical material');
    }
  }
  for (const [name, projection] of [['nativeUse', nativeUse], ['meshUse', meshUse]] as const) {
    if (projection === undefined) continue;
    if (!isRecord(projection)) return fail('schema-mismatch', `${name} must be an object`);
    const hit = findRefreshKey(projection, 0);
    if (hit) {
      return hit.depth === 0
        ? fail('refresh-material-present', `${name} carries refresh material: ${hit.key}`)
        : fail('nested-refresh-field', `${name} hides a nested renewal field: ${hit.key}`);
    }
    const bad = unknownKey(projection, PROJECTION_KEYS);
    if (bad) return fail('unknown-field', `unknown ${name} field: ${bad}`);
  }
  if (canonical !== undefined) {
    if (!isRecord(canonical)) return fail('schema-mismatch', 'canonical must be an object');
    const bad = unknownKey(canonical, CANONICAL_KEYS);
    if (bad) return fail('unknown-field', `unknown canonical field: ${bad}`);
  }
  return { ok: true, bundle: bundle as unknown as SeatBundleV1 };
}

/** True when the incoming tuple is older than current; same epoch/generation reimports idempotently. */
export function isStaleGeneration(
  current: Pick<SeatBundleLifecycle, 'epoch' | 'generation'>,
  incoming: Pick<SeatBundleLifecycle, 'epoch' | 'generation'>,
): boolean {
  if (incoming.epoch !== current.epoch) return incoming.epoch < current.epoch;
  return incoming.generation < current.generation;
}

/** True for a same-tuple reimport that must not mutate the receiving account. */
export function isIdempotentReimport(
  current: Pick<SeatBundleLifecycle, 'epoch' | 'generation' | 'operationId'>,
  incoming: Pick<SeatBundleLifecycle, 'epoch' | 'generation' | 'operationId'>,
): boolean {
  return (
    incoming.epoch === current.epoch &&
    incoming.generation === current.generation &&
    incoming.operationId === current.operationId
  );
}

/** The trusted path authority wins; a JSON field claiming an owner is not authorization. */
export function resolveEffectiveAuthority(
  _claimed: SeatAuthority,
  trustedPathAuthority: SeatAuthority,
): SeatAuthority {
  return trustedPathAuthority;
}

/** Credential-free receipt; carries metadata only, never credential bytes. */
export function createReceipt(
  bundle: SeatBundleV1,
  outcome: 'valid' | 'invalid',
  reason?: SeatValidationCode,
  checkedAt?: string,
): SeatReceipt {
  return {
    seatRef: bundle.identity.seatRef,
    cli: bundle.identity.cli,
    epoch: bundle.lifecycle.epoch,
    generation: bundle.lifecycle.generation,
    operationId: bundle.lifecycle.operationId,
    outcome,
    ...(reason !== undefined ? { reason } : {}),
    checkedAt: checkedAt ?? new Date().toISOString(),
  };
}
