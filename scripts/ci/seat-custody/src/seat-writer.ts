import { digest } from './github-seat-store.ts';
import { ensure } from './seat-admission.ts';
import type { SeatState } from './seat-admission.ts';
type Debit = { reservation: string; request: string; debit: number };
type Provenance = { campaign: string; segment: number; runId: string; runAttempt: number;
  control: string; workflow: string; createdAt: number };
export const createHandoff = (journal: Debit[], provenance: Provenance) => {
  const data = { version: 1, journal, provenance };
  ensure(Buffer.byteLength(JSON.stringify(data)) <= 1024 * 1024, 'handoff-size');
  return { ...data, digest: digest(data) };
};
export const settleSeatReservation = (state: SeatState, id: string,
  handoff: ReturnType<typeof createHandoff> | undefined,
  proof: Provenance & { now: number; trustedWorkflow: boolean; producerTerminated: boolean;
    consumerExited: boolean; settlementRunId: string; expectedDigest: string }) => {
  const reservation = state.reservations.find(r => r.id === id);
  ensure(reservation && !reservation.settled, 'already-settled-or-unknown');
  ensure(handoff && proof.trustedWorkflow && proof.producerTerminated && proof.consumerExited
    && proof.settlementRunId !== proof.runId, 'handoff-termination');
  const { digest: hash, ...data } = handoff;
  ensure(hash === proof.expectedDigest && hash === digest(data) && data.version === 1
    && proof.now >= data.provenance.createdAt && proof.now - data.provenance.createdAt < 86_400_000,
  'handoff-digest-or-expiry');
  for (const key of ['campaign', 'segment', 'runId', 'runAttempt', 'control', 'workflow'] as const)
    ensure(data.provenance[key] === proof[key], 'handoff-provenance');
  ensure(reservation.campaign === proof.campaign, 'handoff-reservation');
  const debits = data.journal.filter(d => d.reservation === id);
  ensure(new Set(debits.map(d => d.request)).size === debits.length
    && debits.every(d => d.debit === 1), 'handoff-journal');
  const spent = debits.reduce((n, d) => n + d.debit, 0);
  ensure(spent <= reservation.units, 'handoff-overrun');
  reservation.spent = spent; reservation.settled = hash;
  return { spent, released: reservation.units - spent, slotReleased: true };
};
