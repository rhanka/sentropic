import type { ClusterMeshConfig } from '../config.js';

export type AdmissionRefusalReason = 'capacity_exhausted';

export interface CapacityReservation {
  readonly reservationId: string;
  readonly generationId: string;
  readonly subjectRef: string;
  readonly reservedAt: string;
}

export type CapacityReservationResult =
  | {
      readonly ok: true;
      readonly outcome: 'reserved' | 'idempotent_retry';
      readonly reservation: CapacityReservation;
    }
  | { readonly ok: false; readonly reason: AdmissionRefusalReason };

export interface CapacityAdmission {
  readonly maxConcurrent: number;
  readonly poolSize: number;
  readonly reserved: number;
  reserveBeforeSpawn(input: {
    readonly reservationId: string;
    readonly subjectRef: string;
  }): CapacityReservationResult;
  release(reservationId: string): boolean;
}

export function createCapacityAdmission(input: {
  readonly generationId: string;
  readonly config: ClusterMeshConfig['capacity'];
  readonly now?: () => Date;
}): CapacityAdmission {
  const reservations = new Map<string, CapacityReservation>();
  const now = input.now ?? (() => new Date());
  return {
    ...input.config,
    get reserved() {
      return reservations.size;
    },
    reserveBeforeSpawn(candidate) {
      if (reservations.has(candidate.reservationId)) {
        return {
          ok: true,
          outcome: 'idempotent_retry',
          reservation: reservations.get(candidate.reservationId)!,
        };
      }
      if (reservations.size >= input.config.maxConcurrent) {
        return { ok: false, reason: 'capacity_exhausted' };
      }
      const reservation: CapacityReservation = {
        ...candidate,
        generationId: input.generationId,
        reservedAt: now().toISOString(),
      };
      reservations.set(reservation.reservationId, reservation);
      return { ok: true, outcome: 'reserved', reservation };
    },
    release(reservationId) {
      return reservations.delete(reservationId);
    },
  };
}
