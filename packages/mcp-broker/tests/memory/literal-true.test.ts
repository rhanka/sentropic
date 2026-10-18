/**
 * MCP-L5 Lot 1 — literal-true verdict tests.
 *
 * Case: P02.broker.literal-true-verdict. The mandatory counterexamples:
 * an omitted resume verdict, an omitted continuation verdict and an
 * omitted terminal-disclosure verdict each authorize nothing. Each fixture
 * repeats with false, undefined, null, "true" and 1, and asserts zero
 * prohibited effects or bytes: refusals carry no provider outcome and no
 * terminal-state disclosure.
 */
import { describe, expect, it } from 'vitest';
import { authorizeMemoryDispatch } from '@sentropic/mcp-platform/transport/dispatch';
import {
  checkOperationConfirmation,
  isLiteralTrueVerdict,
} from '@sentropic/mcp-platform/memory';
import type { ConfirmationCheckInput } from '@sentropic/mcp-platform/memory';
import { makePlan } from './fixtures.js';

const FORGED_VERDICTS = [false, undefined, null, 'true', 1] as unknown[];

function makeConfirmation(approved: unknown): ConfirmationCheckInput {
  const digest = `sha256:${'c'.repeat(64)}`;
  return {
    assurance: {
      issuer: 'https://auth.sent-tech.ca',
      subject: 'user-1',
      enrollmentReceipt: 'enroll-1',
      assuranceReceipt: 'assurance-1',
      assurancePolicyVersion: 'assurance-policy/v1',
      approverRef: 'user-1',
      delegationRef: null,
      initiatingPrincipalRef: 'user-1',
      tenantRef: 'tenant-1',
      agentRef: 'agent-1',
      clientRef: 'client-1',
      logicalSessionRef: 'session-1',
      attachmentGeneration: 'req-1',
      providerRef: 'sentropic.engram.memory',
      connectorInstanceRef: 'ci-1',
      storeRef: 'ci-1',
      scopeRef: 'tenant-1',
      toolName: 'engram_memory_withdraw',
      toolVersion: '1.0.0',
      targetRef: 'candidate-1',
      reservationRef: 'reservation-1',
      operationDigest: digest,
      issuedAt: '2026-10-18T00:00:00.000Z',
      expiresAt: '2026-10-18T00:05:00.000Z',
    },
    continuation: {
      reservationRef: 'reservation-1',
      elicitationRef: 'elicit-1',
      assuranceRef: 'assurance-1',
      logicalSessionRef: 'session-1',
      attachmentGeneration: 'req-2',
      toolName: 'engram_memory_withdraw',
      targetRef: 'candidate-1',
      operationDigest: digest,
      approved: approved as true,
      confirmedAt: '2026-10-18T00:04:50.000Z',
    },
    capability: 'engram_memory_withdraw',
    targetRef: 'candidate-1',
    operationDigest: digest,
    logicalSessionRef: 'session-1',
    nowIso: '2026-10-18T00:04:59.000Z',
  };
}

describe('P02.broker.literal-true-verdict', () => {
  it('P02.broker.literal-true-verdict: omitted resume verdicts never authorize dispatch', () => {
    const base = {
      registry: makePlan(['engram_memory_search']),
      toolName: 'engram_memory_search',
      principal: { sub: 'user-1', clientId: 'client-1', scopes: ['mcp:tools:invoke'], claims: ['sub', 'tid'] },
    };
    expect(
      authorizeMemoryDispatch({ ...base, contextVerified: true }),
    ).toEqual({
      allowed: true,
      providerId: 'sentropic.engram.memory',
      capabilityName: 'engram_memory_search',
    });
    for (const verdict of [undefined, ...FORGED_VERDICTS]) {
      const decision = authorizeMemoryDispatch({ ...base, contextVerified: verdict });
      expect(decision).toEqual({ allowed: false, code: 'unverified_context' });
    }
  });

  it('P02.broker.literal-true-verdict: omitted continuation verdicts never authorize an effect', () => {
    expect(checkOperationConfirmation(makeConfirmation(true))).toEqual([]);
    for (const verdict of [undefined, ...FORGED_VERDICTS]) {
      const failures = checkOperationConfirmation(makeConfirmation(verdict));
      expect(failures.join(' ')).toMatch(/affirmative/);
    }
  });

  it('P02.broker.literal-true-verdict: omitted terminal-disclosure verdicts disclose nothing', () => {
    for (const verdict of [undefined, ...FORGED_VERDICTS]) {
      expect(isLiteralTrueVerdict(verdict)).toBe(false);
    }
    expect(isLiteralTrueVerdict(true)).toBe(true);
  });
});
