/**
 * v0 metering sink (spec §5). The settle HOOK is real — the flow ALWAYS calls
 * it exactly once per request — but the BR-47 ledger wiring (pre-call
 * reservation + append-only `cost_events`) is a LATER lot. This sink records
 * settle calls in memory so tests can assert the hook fired with the right
 * normalized usage + REDACTED account view, and so the seam is exercised end to
 * end before the ledger lands.
 *
 * NEVER writes financial `cost_events` here (that is BR-47, Lot 4). NEVER
 * receives the executable material — only the redacted account view (spec §4).
 */

import type { MeteringSink, SettleContext } from '../flow.js';

/** A no-op sink (drops settle calls). Useful where metering is out of scope. */
export const noopMeteringSink: MeteringSink = {
  settle(): void {
    /* intentionally empty — BR-47 ledger wiring lands in a later lot */
  },
};

/**
 * An in-memory recording sink. The settle hook appends each `SettleContext` so
 * a test can assert the flow settled once with the expected usage/outcome and
 * a REDACTED account view (no tokens).
 */
export class RecordingMeteringSink implements MeteringSink {
  readonly settlements: SettleContext[] = [];

  settle(context: SettleContext): void {
    this.settlements.push(context);
  }

  get last(): SettleContext | undefined {
    return this.settlements[this.settlements.length - 1];
  }

  reset(): void {
    this.settlements.length = 0;
  }
}
