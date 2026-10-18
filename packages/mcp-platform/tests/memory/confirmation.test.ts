/**
 * MCP-L5 Lot 1 — confirmation assurance and continuation tests.
 *
 * Case: P07.platform.confirmation. Covers the 300 s TTL boundary (300 s
 * accepted while fresh, 301 s rejected), the now < expires_at edge
 * (now = expires_at - 1 ms allowed, now = expires_at rejected), the 30 s
 * execution budget (30 s admitted, 31 s refused), affirmative literal
 * approval and exact capability/target/digest/session binding.
 * Deterministic clocks only: no sleeps, no raised timeouts.
 */
import { describe, expect, it } from 'vitest';
import {
  checkOperationConfirmation,
  isWithinExecutionBudget,
} from '../../src/memory/confirmation.js';
import type {
  ConfirmationCheckInput,
  MemoryConfirmationAssuranceV1,
  MemoryConfirmationContinuationV1,
} from '../../src/memory/confirmation.js';

const ISSUED = '2026-10-18T00:00:00.000Z';
const digest = `sha256:${'c'.repeat(64)}`;

describe('P07.platform.confirmation', () => {
  it('P07.platform.confirmation: accepts a fresh affirmative bound confirmation', () => {
    expect(checkOperationConfirmation(makeInput())).toEqual([]);
  });

  it('P07.platform.confirmation: accepts a 300 s TTL while fresh and refuses 301 s', () => {
    const fresh = makeInput({
      assurance: makeAssurance({ expiresAt: '2026-10-18T00:05:00.000Z' }),
      continuation: makeContinuation({ confirmedAt: '2026-10-18T00:04:50.000Z' }),
      nowIso: '2026-10-18T00:04:59.999Z',
    });
    expect(checkOperationConfirmation(fresh)).toEqual([]);
    const stale = makeInput({
      assurance: makeAssurance({
        issuedAt: '2026-10-18T00:00:00.000Z',
        expiresAt: '2026-10-18T00:05:01.000Z',
      }),
      continuation: makeContinuation({ confirmedAt: '2026-10-18T00:04:50.000Z' }),
      nowIso: '2026-10-18T00:05:00.500Z',
    });
    expect(checkOperationConfirmation(stale).join(' ')).toMatch(/ttl/);
  });

  it('P07.platform.confirmation: allows now = expires_at - 1 ms and refuses now = expires_at', () => {
    const edge = makeInput({
      continuation: makeContinuation({ confirmedAt: '2026-10-18T00:04:50.000Z' }),
      nowIso: '2026-10-18T00:04:59.999Z',
    });
    expect(checkOperationConfirmation(edge)).toEqual([]);
    const expired = makeInput({
      continuation: makeContinuation({ confirmedAt: '2026-10-18T00:04:50.000Z' }),
      nowIso: '2026-10-18T00:05:00.000Z',
    });
    expect(checkOperationConfirmation(expired).join(' ')).toMatch(/expiry/);
  });

  it('P07.platform.confirmation: admits effect at 30 s and refuses at 31 s', () => {
    expect(isWithinExecutionBudget('2026-10-18T00:00:10.000Z', '2026-10-18T00:00:40.000Z')).toBe(true);
    expect(isWithinExecutionBudget('2026-10-18T00:00:10.000Z', '2026-10-18T00:00:41.000Z')).toBe(false);
    const late = makeInput({
      continuation: makeContinuation({ confirmedAt: '2026-10-18T00:00:10.000Z' }),
      nowIso: '2026-10-18T00:00:41.000Z',
    });
    expect(checkOperationConfirmation(late).join(' ')).toMatch(/execution/);
  });

  it('P07.platform.confirmation: refuses non-affirmative approval and every binding mismatch', () => {
    for (const approved of [false, undefined, null, 'true', 1] as unknown[]) {
      const input = makeInput({
        continuation: makeContinuation({ approved }),
      });
      expect(checkOperationConfirmation(input).join(' ')).toMatch(/affirmative/);
    }
    expect(
      checkOperationConfirmation(makeInput({ capability: 'engram_memory_forget' })).join(' '),
    ).toMatch(/capability/);
    expect(checkOperationConfirmation(makeInput({ targetRef: 'candidate-9' })).join(' ')).toMatch(
      /targetRef/,
    );
    expect(
      checkOperationConfirmation(makeInput({ operationDigest: `sha256:${'9'.repeat(64)}` })).join(' '),
    ).toMatch(/operationDigest/);
    expect(
      checkOperationConfirmation(makeInput({ logicalSessionRef: 'session-9' })).join(' '),
    ).toMatch(/logicalSessionRef/);
    expect(
      checkOperationConfirmation(
        makeInput({ continuation: makeContinuation({ reservationRef: 'reservation-9' }) }),
      ).join(' '),
    ).toMatch(/reservationRef/);
  });
});
