import { ensure, heldUnits } from './seat-admission.ts';
import type { SeatState, SeatMode } from './seat-admission.ts';

export const setSeatMode = (state: SeatState, change: {
  day: string; mode: SeatMode; campaign: string; validUntil: string; drained: boolean; sameDay?: boolean;
}) => {
  ensure(change.drained, 'mode-drain-required');
  ensure(change.mode === 'normal' || change.mode === 'native-campaign', 'mode-invalid');
  const date = new Date(`${change.day}T00:00:00.000Z`);
  ensure(Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === change.day, 'mode-day');
  ensure(change.mode === 'normal' || (change.campaign && change.validUntil >= change.day), 'mode-campaign');
  const ciUsed = state.reservations.filter(r => r.day === change.day && r.kind === 'ci')
    .reduce((n, r) => n + heldUnits(r), 0);
  const unresolved = state.reservations.some(r => !r.settled);
  ensure(!unresolved || ciUsed > 0, 'mode-unsettled-reservation');
  const immediate = change.sameDay && change.mode === 'native-campaign' && ciUsed === 0 && !unresolved;
  date.setUTCDate(date.getUTCDate() + (immediate ? 0 : 1));
  const effectiveDay = date.toISOString().slice(0, 10);
  ensure(change.mode === 'normal' || change.validUntil >= effectiveDay, 'mode-expired');
  state.modes[effectiveDay] = { mode: change.mode,
    ...(change.mode === 'native-campaign' ? { campaign: change.campaign, validUntil: change.validUntil } : {}) };
  if (change.mode === 'native-campaign') state.ciCeilings[effectiveDay] = 0;
  return { effectiveDay, status: immediate ? 'effective' : 'pending-effective-day' };
};
