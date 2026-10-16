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
