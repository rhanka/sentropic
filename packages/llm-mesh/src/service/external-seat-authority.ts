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

/** Metadata key carrying the trusted external-custody marker. */
export const SEAT_EXTERNAL_AUTHORITY_KEY = 'seatExternalAuthority';

export interface SeatExternalAuthority {
  seatRef: string;
  ownerScope: string;
  epoch: number;
  generation: number;
  operationId: string;
}

type AccountLike = Pick<AccountTransportAccount, 'accountId' | 'metadata'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read the trusted marker; malformed markers stay fail-closed (external). */
export function readExternalSeatAuthority(
  metadata: Record<string, unknown> | undefined,
): SeatExternalAuthority | null {
  if (!metadata) return null;
  const marker = metadata[SEAT_EXTERNAL_AUTHORITY_KEY];
  if (marker === undefined || marker === null) return null;
  if (!isRecord(marker)) {
    return { seatRef: 'unknown', ownerScope: 'unknown', epoch: 0, generation: 0, operationId: 'unknown' };
  }
  const text = (key: string): string => (typeof marker[key] === 'string' ? (marker[key] as string) : 'unknown');
  const integer = (key: string): number =>
    typeof marker[key] === 'number' && Number.isInteger(marker[key]) ? (marker[key] as number) : 0;
  return {
    seatRef: text('seatRef'),
    ownerScope: text('ownerScope'),
    epoch: integer('epoch'),
    generation: integer('generation'),
    operationId: text('operationId'),
  };
}

/** Attach the trusted marker; returns a new metadata record. */
export function markExternalSeatAuthority(
  metadata: Record<string, unknown> | undefined,
  authority: SeatExternalAuthority,
): Record<string, unknown> {
  return { ...(metadata ?? {}), [SEAT_EXTERNAL_AUTHORITY_KEY]: { ...authority } };
}

/** True when the trusted import path marked this account externally held. */
export function isExternalSeatAccount(account: AccountLike): boolean {
  return readExternalSeatAuthority(account.metadata as Record<string, unknown> | undefined) !== null;
}

/** True for a Muse device-flow grant, which owns no CLI-store refresh. */
export function isDeviceFlowSeatAccount(account: AccountLike): boolean {
  const metadata = account.metadata as Record<string, unknown> | undefined;
  return isRecord(metadata) && metadata['auth_type'] === 'device-flow';
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
