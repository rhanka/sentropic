// @sentropic/llm-mesh/external-seat-marker.ts
//
// Leaf module for the trusted external-custody marker (no imports): the
// metadata key, the authority record, and the marker predicates. Both
// `account-transports.ts` (outcome classification) and
// `service/external-seat-authority.ts` (refresh policy) read from here so
// the base transport layer never imports the service layer.

/** Metadata key carrying the trusted external-custody marker. */
export const SEAT_EXTERNAL_AUTHORITY_KEY = 'seatExternalAuthority';

export interface SeatExternalAuthority {
  seatRef: string;
  ownerScope: string;
  epoch: number;
  generation: number;
  operationId: string;
}

type AccountLike = {
  accountId: string;
  metadata?: Record<string, unknown> | null;
};

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
