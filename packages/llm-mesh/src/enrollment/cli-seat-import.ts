// @sentropic/llm-mesh/enrollment/cli-seat-import.ts
//
// L1 shared source-mode contract for the five CI seats.
// `--from cli` parses a privately materialized provider-shaped profile plus a
// trusted manifest; `--from token` parses a serialized envelope whose bytes
// the caller read over bounded stdin, an FD, or a trusted SDK stream — the
// value never appears on argv. Both modes parse and validate only: no
// provider exchange, mint, hidden store reread, or refresh. The durable
// grant stays with the custodian; mesh remains consumer-only.

import {
  SEAT_BUNDLE_MAX_BYTES,
  SEAT_PACKAGE_PROVIDER_ID,
  validateSeatBundle,
  type SeatBundleV1,
  type SeatCli,
} from './seat-bundle.js';

export type SeatSourceMode = 'cli' | 'token';

export class SeatImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SeatImportError';
    this.code = code;
  }
}

export interface CliSeatProfileInput {
  cli: SeatCli;
  seatRef: string;
  refreshFamilyRef?: string;
  ownerScope: string;
  issuingClientRef: string;
  endpointFamily: string;
  accountBinding: string;
  entitlementClass: string;
  epoch: number;
  generation: number;
  operationId: string;
  /** Custodian-observed issuance time; never invented by the consumer. */
  issuedAt: string;
  providerExpiry?: string;
  accessRef?: string;
  accessKind?: 'access' | 'static-key' | 'unavailable';
  credentialFormatVersion?: string;
  nativeCliVersion?: string;
  os?: 'linux' | 'macos' | 'windows';
}

export interface TokenSeatEnvelopeInput {
  /** Envelope bytes already read by the caller over a private channel. */
  raw: string;
  ownerScope: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Parse a `--from cli` provider-shaped profile into a consumer bundle. */
export function parseCliSeatProfile(input: CliSeatProfileInput): SeatBundleV1 {
  if (!nonEmpty(input.issuingClientRef) || !nonEmpty(input.endpointFamily)) {
    throw new SeatImportError('client-mismatch', 'cli profile needs an issuing client and endpoint family');
  }
  // No invented timestamps: the custodian-observed issuedAt is required.
  if (!nonEmpty(input.issuedAt) || Number.isNaN(new Date(input.issuedAt as string).getTime())) {
    throw new SeatImportError('schema-mismatch', 'cli profile needs a valid custodian-observed issuedAt');
  }
  const accessKind = input.accessKind ?? 'access';
  const credentialClass = accessKind === 'static-key' ? 'static-key' : 'access-only';
  const candidate = {
    identity: {
      schemaVersion: 1,
      seatRef: input.seatRef,
      ...(credentialClass === 'static-key'
        ? {}
        : input.refreshFamilyRef !== undefined
          ? { refreshFamilyRef: input.refreshFamilyRef }
          : { refreshFamilyRef: `family-${input.seatRef}` }),
      ownerScope: input.ownerScope,
      cli: input.cli,
      packageProviderId: SEAT_PACKAGE_PROVIDER_ID[input.cli],
      issuingClientRef: input.issuingClientRef,
      endpointFamily: input.endpointFamily,
      credentialFormatVersion: input.credentialFormatVersion ?? 'v1',
      ...(input.nativeCliVersion !== undefined ? { nativeCliVersion: input.nativeCliVersion } : {}),
      ...(input.os !== undefined ? { os: input.os } : {}),
    },
    provenance: {
      enrollmentSource: 'cli',
      accountBinding: input.accountBinding,
      entitlementClass: input.entitlementClass,
    },
    authority: 'consumer',
    credentialClass,
    lifecycle: {
      epoch: input.epoch,
      generation: input.generation,
      operationId: input.operationId,
      issuedAt: input.issuedAt as string,
      localExpiryPolicy: 'seat-consumer-policy-v1',
      refreshAuthority: 'none',
      ...(input.providerExpiry !== undefined ? { providerExpiry: input.providerExpiry } : {}),
    },
    ...(accessKind === 'unavailable'
      ? { meshUse: { kind: 'unavailable', reason: 'serialized-only-native' } }
      : { meshUse: { kind: accessKind, accessRef: input.accessRef ?? '' } }),
  };
  const result = validateSeatBundle(candidate, {
    ownerScope: input.ownerScope,
    trustedAuthority: 'consumer',
    issuingClientRef: input.issuingClientRef,
    endpointFamily: input.endpointFamily,
  });
  if (!result.ok) throw new SeatImportError(result.code, result.detail);
  return result.bundle;
}

/** Parse a `--from token` serialized envelope into the same consumer bundle. */
export function parseTokenSeatEnvelope(input: TokenSeatEnvelopeInput): SeatBundleV1 {
  if (new TextEncoder().encode(input.raw).length > SEAT_BUNDLE_MAX_BYTES) {
    throw new SeatImportError('size-exceeded', 'token envelope exceeds the 48 KiB secret bound');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.raw) as unknown;
  } catch {
    throw new SeatImportError('schema-mismatch', 'token envelope is not JSON-serializable');
  }
  const result = validateSeatBundle(parsed, {
    ownerScope: input.ownerScope,
    trustedAuthority: 'consumer',
  });
  if (!result.ok) throw new SeatImportError(result.code, result.detail);
  if (result.bundle.provenance.enrollmentSource !== 'cli') {
    throw new SeatImportError('schema-mismatch', 'token delivery preserves the cli enrollment source');
  }
  return result.bundle;
}

/** True when both modes converged on the same seat lineage and account. */
export function sameSeatLineage(a: SeatBundleV1, b: SeatBundleV1): boolean {
  return (
    a.identity.cli === b.identity.cli &&
    a.identity.seatRef === b.identity.seatRef &&
    a.provenance.accountBinding === b.provenance.accountBinding &&
    a.lifecycle.epoch === b.lifecycle.epoch &&
    a.lifecycle.generation === b.lifecycle.generation &&
    a.lifecycle.operationId === b.lifecycle.operationId
  );
}
