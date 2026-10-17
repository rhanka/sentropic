export type SeatClass = 'ci' | 'enrollment' | 'native';
export type SeatMode = 'normal' | 'native-campaign';
export type SeatCase = { id: string; attempts: number; durationMs: number };
export type Reservation = { id: string; caseId: string; campaign: string; day: string;
  generation: number; kind: SeatClass; units: number; spent?: number; settled?: string };
export type SeatState = { version: 1; reservations: Reservation[]; campaigns: string[];
  modes: Record<string, { mode: SeatMode; campaign?: string; validUntil?: string }>; ciCeilings: Record<string, number> };
export type SeatAdmission = { day: string; campaign: string; generation: number;
  seatQualified: boolean; quotaReadable: boolean; remaining: number[]; lifetimeMs: number };
export const initialSeatState = (): SeatState => ({ version: 1, reservations: [], campaigns: [], modes: {}, ciCeilings: {} });
export function ensure(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
export const heldUnits = (r: Reservation) => r.settled ? r.spent! : r.units;
export const seatCaps = (state: SeatState, day: string): Record<SeatClass, number> => {
  const entry = state.modes[day];
  if (entry?.mode === 'native-campaign') {
    ensure(entry.campaign && entry.validUntil && entry.validUntil >= day, 'native-campaign-expired');
    return { ci: 0, enrollment: 2, native: 8 };
  }
  return { ci: Math.min(6, state.ciCeilings[day] ?? 6), enrollment: 2, native: 2 };
};
export const reserveSeatClass = (state: SeatState, kind: SeatClass, units: number,
  context: SeatAdmission, caseId = context.campaign): Reservation => {
  ensure(state.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(context.day), 'seat-state');
  ensure(Number.isSafeInteger(units) && units > 0 && Number.isSafeInteger(context.generation)
    && context.generation > 0, 'case-bound');
  ensure(context.quotaReadable && context.remaining.length > 0 && context.remaining.every(
    n => Number.isFinite(n) && n > 20 && n <= 100), 'quota-unreadable');
  const today = state.reservations.filter(r => r.day === context.day);
  const total = today.reduce((n, r) => n + heldUnits(r), 0);
  const used = today.filter(r => r.kind === kind).reduce((n, r) => n + heldUnits(r), 0);
  ensure(total + units <= 10 && used + units <= seatCaps(state, context.day)[kind], 'seat-budget');
  const id = `${context.day}:${context.campaign}:${caseId}`;
  ensure(!state.reservations.some(r => r.id === id), 'duplicate-reservation');
  const reservation = { id, day: context.day, campaign: context.campaign,
    caseId, generation: context.generation, kind, units };
  state.reservations.push(reservation);
  return reservation;
};
export const admitSeatCases = (state: SeatState, cases: SeatCase[], context: SeatAdmission) => {
  ensure(cases.length > 0 && new Set(cases.map(c => c.id)).size === cases.length, 'case-inventory');
  cases.forEach(c => ensure(c.id && Number.isSafeInteger(c.attempts) && c.attempts > 0
    && Number.isFinite(c.durationMs) && c.durationMs > 0, 'case-bound'));
  const campaignKey = `${context.day}:${context.campaign}`;
  ensure(!state.campaigns.includes(campaignKey), 'duplicate-campaign');
  const reservations: Reservation[] = []; const seat: SeatCase[] = []; const credit: SeatCase[] = [];
  const quota = context.quotaReadable && context.remaining.length > 0
    && context.remaining.every(n => Number.isFinite(n) && n > 20 && n <= 100);
  for (const c of cases) {
    const today = state.reservations.filter(r => r.day === context.day);
    const all = today.reduce((n, r) => n + heldUnits(r), 0);
    const ci = today.filter(r => r.kind === 'ci').reduce((n, r) => n + heldUnits(r), 0);
    if (context.seatQualified && quota && c.durationMs <= context.lifetimeMs
      && c.attempts <= Math.min(seatCaps(state, context.day).ci - ci, 10 - all)) {
      reservations.push(reserveSeatClass(state, 'ci', c.attempts, context, c.id)); seat.push(c);
    } else credit.push(c);
  }
  state.campaigns.push(campaignKey);
  return { seat, credit, reservations, ...(seat.length ? {} : {
    noSeat: { reason: !context.seatQualified ? 'seat-route-unqualified'
      : !quota ? 'quota-unreadable' : 'no-whole-case-fits', units: 0, consumerMinutes: 0 },
  }) };
};
