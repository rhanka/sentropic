/**
 * Durable request receipts (L1, spec 6.1/6.2).
 *
 * Portable receipt linkage: one settlement per attempt, terminal states only,
 * settled receipts never reopen. The session service enforces this; the Node
 * host drains by refusing new admission while pending receipts stay pending
 * (never replayed as new tool calls).
 */
export const TERMINAL_SETTLEMENTS = [
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'unknown',
  'error',
  'migration-ack',
] as const;

export type TerminalSettlement = (typeof TERMINAL_SETTLEMENTS)[number];

export const isTerminalSettlement = (outcome: string): outcome is TerminalSettlement =>
  (TERMINAL_SETTLEMENTS as readonly string[]).includes(outcome);

/** A settled receipt cannot be settled again; only terminal outcomes settle. */
export const assertSettleable = (current: string, outcome: string): TerminalSettlement => {
  if (current !== 'pending') {
    throw new Error(`receipt already settled as ${current}`);
  }
  if (!isTerminalSettlement(outcome)) {
    throw new Error(`unknown settlement outcome: ${outcome}`);
  }
  return outcome;
};
