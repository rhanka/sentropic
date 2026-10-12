import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { idempotencyKey } from '@sentropic/contracts';
import type {
  InvocationReceipt,
  InvocationReceiptPort,
} from '@sentropic/events';
import { createClusterMeshModules } from '../src/index.js';
import { createLlmMeshNamespaceModule, type LlmMeshRouterInput } from '../src/compose/llm-mesh.js';
import { createRegistrationGate } from '../src/runtime/registration.js';
import { createInvocationReceiptEmitter, type ReceiptCoordinates } from '../src/runtime/receipts.js';

describe('judge receipt correlation and generation-policy refusal via public ports', () => {
  const createMockReceiptPort = (dedup = false) => {
    const appended: InvocationReceipt[] = [];
    const port: InvocationReceiptPort = {
      append: vi.fn(async (receipt: InvocationReceipt) => {
        if (!dedup || !appended.some((r) => r.receiptId === receipt.receiptId)) appended.push(receipt);
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

  const runJudgeFlow = async (opts: { genContext?: string; pass?: boolean; timeout?: boolean; dedup?: boolean }) => {
    const { port, appended } = createMockReceiptPort(opts.dedup);
    let rInput!: LlmMeshRouterInput;
    const mod = await createLlmMeshNamespaceModule(createClusterMeshModules(), { enabled: true, judge: true, createRouter: (input) => { rInput = input; return new Hono(); } });
    const reg = { registrationId: 'reg-1', generationId: 'gen-2026-10', principalId: 'p-1', workspaceId: 'w-1', custodyHolderPrincipalId: 'p-1', custodyEpoch: 1, actuatorRef: 'act-1', status: 'active' as const, expiresAt: '2026-12-31T12:00:00.000Z', leaseExpiresAt: '2026-12-31T11:00:00.000Z' };
    const ctx = { invocationId: coordinates.invocationId, correlationId: coordinates.correlationId, generationId: opts.genContext ?? 'gen-2026-10', principal: { principalId: 'p-1', kind: 'workload', verifierId: 'v-1' }, workspace: { bindingId: 'b-1', workspaceId: 'w-1', revision: '1' }, scopes: ['llm-mesh:judge'], policyRevision: 'pol-1', registration: { ...reg, custodyEpoch: 1, expiresAt: reg.expiresAt }, custody: { custodyId: 'c-1', holderPrincipalId: 'p-1', epoch: 1 }, issuedAt: '2026-10-12T12:00:00.000Z' };
    mod.createRouter({ context: { verify: async () => ctx as never }, receipts: port });
    const gate = createRegistrationGate({ generationId: 'gen-2026-10', registrations: { find: async () => reg }, pty: { kind: 'pty', isAvailable: async () => true, probeState: async () => 'alive', actuate: async () => ({ effectRef: 'act', outcome: 'acted' }) } });
    const emitter = createInvocationReceiptEmitter({ generationId: 'gen-2026-10', port });
    const desc = { ...rInput.judgeHost!.jevDescriptor, evaluator: { ...rInput.judgeHost!.jevDescriptor.evaluator, revision: 'syn-v1' }, acceptedServedModelIds: ['syn-model'], qualification: { servedIdentity: 'qualified' as const, billingBound: 'qualified' as const, evidenceRefs: ['fixture:syn'] } };
    const judgeState = { now: 0 };
    const transportSend = vi.fn(async () => opts.timeout ? (judgeState.now = 10001, { ok: false as const, error: { code: 'CANCELLED' as const, phase: 'dispatch' as const, message: 'timeout' } }) : { ok: true as const, body: { model: 'syn-model', answers: { verdict: { noul: opts.pass === false ? 0.05 : 0.95 } }, usage: { input_tokens: 10, output_tokens: 0 } } });
    const service = rInput.judgeHost!.createJudgeService({
      registry: rInput.llmMesh.createProviderRegistry([rInput.judgeHost!.createJevAdapter({ descriptor: desc, transport: { send: transportSend } })]),
      resolveEvaluator: () => desc, resolvePrice: () => ({ providerId: 'typesafe' as const, modelId: 'jev-1.13.0', priceRevision: 'p1', inputMicroUsdPerMtok: '1000', outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requested-model' as const }),
      authorize: async () => true, budget: { admit: async (i) => ({ ok: true, holdId: i.callId }), markDispatched: async () => ({ ok: true }), release: async () => {}, settle: async () => {} }, receipts: { persist: async () => {} },
      resolveAuth: async () => ({ material: { type: 'environment-token' as const, envVar: 'JEV_API_KEY', token: 'secret' }, descriptor: { sourceType: 'environment-token' as const } }),
      clock: { wall: () => 1700000000000 + judgeState.now, monotonic: () => judgeState.now },
    });
    await emitter.transported(coordinates);
    const auth = await gate.authorize(ctx as never, 'judge:evaluate');
    if (!auth.ok) { await emitter.verified(coordinates, 'refused', auth.reason); return { ok: false as const, reason: auth.reason, appended, transportSend, emitter }; }
    await emitter.verified(coordinates, 'accepted');
    const result = await service.judge({ schemaVersion: 1, evaluator: desc.evaluator, inputs: { output: 'test' }, criterion: { kind: 'binary', instructions: 'eval' }, decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 }, correlationId: coordinates.correlationId });
    const effectRef = `receipt:${result.receipt.callId}:metadata`;
    const acted = await emitter.acted(coordinates, effectRef);
    return { ok: true as const, result, effectRef, acted, appended, emitter };
  };

  it('preserves correlation ID and generation ID across all neutral stages', async () => {
    const res = await runJudgeFlow({});
    expect(res.ok && res.result.ok && res.result.receipt.callId).toHaveLength(36);
    expect(res.appended.map((r) => r.stage)).toEqual(['transported', 'verified', 'acted']);
    expect(res.appended.every((r) => r.correlationId === 'corr-judge-42' && r.generationId === 'gen-2026-10')).toBe(true);
    expect(res.ok && res.acted.effectRef).toBe(`receipt:${res.ok && res.result.receipt.callId}:metadata`);
  });

  it('emits refused verified stage on generation-policy refusal and skips acted stage', async () => {
    const res = await runJudgeFlow({ genContext: 'gen-mismatch' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('generation_mismatch');
    expect(res.appended.map((r) => r.stage)).toEqual(['transported', 'verified']);
    expect(res.appended.some((r) => r.stage === 'acted')).toBe(false);
    expect(!res.ok && res.transportSend).not.toHaveBeenCalled();
  });

  it('emits acted stage with metadata effectRef for negative verdicts and durable errors', async () => {
    const neg = await runJudgeFlow({ pass: false });
    expect(neg.ok && neg.result.ok && neg.result.verdict.decision?.pass).toBe(false);
    expect(neg.ok && neg.effectRef).toBe(`receipt:${neg.ok && neg.result.receipt.callId}:metadata`);
    expect(neg.ok && neg.effectRef).not.toMatch(/pass|score|noul/);
    expect(neg.ok && neg.acted.effectRef).toBe(neg.ok && neg.effectRef);
    const err = await runJudgeFlow({ timeout: true });
    expect(err.ok && !err.result.ok && err.result.receipt.errorCode).toBe('TIMEOUT');
    expect(err.ok && err.effectRef).toBe(`receipt:${err.ok && err.result.receipt.callId}:metadata`);
    expect(err.ok && err.effectRef).not.toContain('TIMEOUT');
    expect(err.ok && err.acted.effectRef).toBe(err.ok && err.effectRef);
  });

  it('preserves deterministic receipt IDs on retry without duplicate stages in idempotent port', async () => {
    const res = await runJudgeFlow({ dedup: true });
    const r1 = await res.emitter.transported(coordinates);
    const r2 = await res.emitter.transported(coordinates);
    expect(r1.receiptId).toBe('inv-judge-1:transported');
    expect(r2.receiptId).toBe('inv-judge-1:transported');
    expect(res.appended.filter((r) => r.receiptId === 'inv-judge-1:transported')).toHaveLength(1);
  });
});
