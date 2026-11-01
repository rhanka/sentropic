// @sentropic/llm-mesh/service/external-seat-authority.ts
//
// L1 external refresh policy for centrally custodied CI seats. An account
// carrying the trusted import marker is maintained by the custodian only:
// the mesh never renews it. On expiry or 401 it becomes `access-unavailable`
// and waits for the next imported projection. The marker never erases the
// owner claim and a missing refresh token alone is not authority.
//
// Device-flow Muse seats are routed the same way: their grant must never be
// refreshed by re-reading the CLI login store, which may hold another login.

import {
  AccountTransportAcquireError,
  type AccountTransportAccount,
} from '../account-transports.js';

// The marker key, record, and predicates live in the leaf module so the
// base transport layer can classify outcomes without importing services.
export {
  isExternalSeatAccount,
  markExternalSeatAuthority,
  readExternalSeatAuthority,
  SEAT_EXTERNAL_AUTHORITY_KEY,
  type SeatExternalAuthority,
} from '../external-seat-marker.js';
import { readExternalSeatAuthority } from '../external-seat-marker.js';

type AccountLike = Pick<AccountTransportAccount, 'accountId' | 'metadata'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True for a Muse device-flow grant, which owns no CLI-store refresh. */
export function isDeviceFlowSeatAccount(account: AccountLike): boolean {
  const metadata = account.metadata as Record<string, unknown> | undefined;
  return isRecord(metadata) && metadata['auth_type'] === 'device-flow';
}

/**
 * True when an externally held seat must not be served: missing, empty, or
 * unparseable expiry counts as unavailable, exactly like an elapsed one.
 * Unknown expiry is not infinite validity.
 */
export function isExternalSeatUnavailable(
  account: Pick<AccountTransportAccount, 'expiresAt'>,
  nowMs: number,
): boolean {
  if (!account.expiresAt) return true;
  const expiresAtMs = new Date(account.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs <= nowMs;
}

/** Refuse a renewal attempt for an externally held seat. */
export function throwExternalSeatUnavailable(account: AccountLike): never {
  const authority = readExternalSeatAuthority(account.metadata as Record<string, unknown> | undefined);
  const seatRef = authority?.seatRef ?? account.accountId;
  throw new AccountTransportAcquireError(
    `Seat ${seatRef} is access-unavailable; awaiting the next imported projection`,
    'access-unavailable',
  );
}

/** Refuse a renewal attempt for a device-flow Muse seat. */
export function throwDeviceFlowSeatUnavailable(account: AccountLike): never {
  throw new AccountTransportAcquireError(
    `Seat ${account.accountId} is access-unavailable; device grants never refresh from the CLI store`,
    'access-unavailable',
  );
}
