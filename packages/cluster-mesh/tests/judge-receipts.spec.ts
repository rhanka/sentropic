import { describe, expect, it, vi } from 'vitest';
import { idempotencyKey } from '@sentropic/contracts';
import type {
  InvocationReceipt,
  InvocationReceiptPort,
} from '@sentropic/events';
import { createInvocationReceiptEmitter, type ReceiptCoordinates } from '../src/runtime/receipts.js';

describe('judge receipt correlation and generation-policy refusal via public ports', () => {
  const createMockReceiptPort = () => {
    const appended: InvocationReceipt[] = [];
    const port: InvocationReceiptPort = {
      append: vi.fn(async (receipt: InvocationReceipt) => {
        appended.push(receipt);
      }),
    };
    return { port, appended };
  };

  const coordinates: ReceiptCoordinates = {
    commandId: 'cmd-judge-1',
    invocationId: 'inv-judge-1',
    correlationId: 'corr-judge-42',
    idempotencyKey: idempotencyKey('idem-judge-99'),
  };

  it('preserves correlation ID and generation ID across all neutral stages', async () => {
    const { port, appended } = createMockReceiptPort();
    const emitter = createInvocationReceiptEmitter({
      generationId: 'gen-2026-10',
      port,
      now: () => new Date('2026-10-12T12:00:00.000Z'),
    });

    const transported = await emitter.transported(coordinates);
    const verified = await emitter.verified(coordinates, 'accepted');
    const acted = await emitter.acted(coordinates, 'receipt:call-judge-1:metadata');

    expect(transported).toMatchObject({
      stage: 'transported',
      generationId: 'gen-2026-10',
      correlationId: 'corr-judge-42',
      invocationId: 'inv-judge-1',
      commandId: 'cmd-judge-1',
      idempotencyKey: 'idem-judge-99',
    });
    expect(verified).toMatchObject({
      stage: 'verified',
      decision: 'accepted',
      generationId: 'gen-2026-10',
      correlationId: 'corr-judge-42',
    });
    expect(acted).toMatchObject({
      stage: 'acted',
      effectRef: 'receipt:call-judge-1:metadata',
      generationId: 'gen-2026-10',
      correlationId: 'corr-judge-42',
    });
    expect(appended).toHaveLength(3);
    expect(appended.every((r) => r.correlationId === 'corr-judge-42')).toBe(true);
  });

  it('emits refused verified stage on generation-policy refusal and skips acted stage', async () => {
    const { port, appended } = createMockReceiptPort();
    const emitter = createInvocationReceiptEmitter({
      generationId: 'gen-2026-10',
      port,
    });

    await emitter.transported(coordinates);
    const verified = await emitter.verified(coordinates, 'refused', 'generation_policy_mismatch');

    expect(verified).toMatchObject({
      stage: 'verified',
      decision: 'refused',
      reason: 'generation_policy_mismatch',
      correlationId: 'corr-judge-42',
    });
    expect(appended).toHaveLength(2);
    expect(appended.map((r) => r.stage)).toEqual(['transported', 'verified']);
    expect(appended.some((r) => r.stage === 'acted')).toBe(false);
  });

  it('emits acted stage with metadata effectRef for negative verdicts and durable errors', async () => {
    const { port, appended } = createMockReceiptPort();
    const emitter = createInvocationReceiptEmitter({
      generationId: 'gen-2026-10',
      port,
    });

    // Negative verdict (pass: false): acted stage records metadata effectRef, never verdict content
    const negCoords: ReceiptCoordinates = { ...coordinates, invocationId: 'inv-neg-1' };
    await emitter.transported(negCoords);
    await emitter.verified(negCoords, 'accepted');
    const actedNeg = await emitter.acted(negCoords, 'receipt:inv-neg-1:verdict-metadata');
    expect(actedNeg.effectRef).toBe('receipt:inv-neg-1:verdict-metadata');
    expect(actedNeg.effectRef).not.toContain('pass');
    expect(actedNeg.effectRef).not.toContain('score');

    // Durable post-dispatch error (e.g. TIMEOUT): durable error effect is acted
    const errCoords: ReceiptCoordinates = { ...coordinates, invocationId: 'inv-err-1' };
    await emitter.transported(errCoords);
    await emitter.verified(errCoords, 'accepted');
    const actedErr = await emitter.acted(errCoords, 'receipt:inv-err-1:error-settlement-metadata');
    expect(actedErr.effectRef).toBe('receipt:inv-err-1:error-settlement-metadata');

    expect(appended.filter((r) => r.stage === 'acted')).toHaveLength(2);
  });

  it('preserves deterministic receipt IDs on retry without creating duplicate stages', async () => {
    const { port, appended } = createMockReceiptPort();
    const emitter = createInvocationReceiptEmitter({
      generationId: 'gen-2026-10',
      port,
    });

    const r1 = await emitter.transported(coordinates);
    const r2 = await emitter.transported(coordinates);
    expect(r1.receiptId).toBe('inv-judge-1:transported');
    expect(r2.receiptId).toBe('inv-judge-1:transported');
    expect(appended).toHaveLength(2);
  });
});
