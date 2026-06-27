/**
 * Slice 2 — write/mutation gating probes (§10 parity, §11 "Mutation gating").
 *
 * A mutating capability (`mutatesExternalSystem`) requires gate + idempotency +
 * audit; an ungated mutation fails closed and runs nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryAuditSink, SecretRedactor } from '../src/audit.js';
import { MockSecretStore, createStpConnectorContext } from '../src/context.js';
import { ElicitationManager } from '../src/elicitation.js';
import { assertMutationGate, invokeGuardedTool } from '../src/guard.js';
import { fakeManifest } from '../src/mock/fake-connector.js';
import type { CapabilityTool } from '../src/manifest.js';
import type { AppToolInvocation } from '../src/runtime.js';

const createWidget = fakeManifest.tools[0]; // mutatesExternalSystem + idempotency + gate

const readOnlyTool: CapabilityTool = {
  kind: 'tool',
  name: 'ping',
  description: 'read-only no-op',
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: {},
  outputSchema: {},
  redactionClass: 'none',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

function ctx() {
  const redactor = new SecretRedactor();
  const audit = new InMemoryAuditSink(redactor);
  const store = new MockSecretStore(redactor);
  const c = createStpConnectorContext({
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-1',
    principal: { sub: 'user-1', claims: {}, scopes: ['widgets:write'], tenantRef: 'tenant-a', authTime: new Date().toISOString() },
    surface: 'chat',
    mcpSessionId: 'sess-1',
    connectorInstanceId: 'conn-1',
    consentRefs: [],
    grantRefs: [],
    secretStore: store,
    audit,
  });
  return { c, audit };
}

function releasedGate(): { elicitations: ElicitationManager; ref: string } {
  const elicitations = new ElicitationManager();
  elicitations.create({ id: 'el-1', mode: 'confirm', sessionRef: 'sess-1', capabilityRef: 'create_widget', actor: { sub: 'user-1' }, ttlSeconds: 300, auditId: 'audit-1' });
  elicitations.render('el-1');
  elicitations.answer('el-1', { sub: 'user-1', isHuman: true });
  elicitations.validate('el-1');
  elicitations.resume('el-1');
  return { elicitations, ref: 'el-1' };
}

describe('mutation gating', () => {
  it('read-only capabilities pass the gate trivially', () => {
    const { c } = ctx();
    const env: AppToolInvocation = { capabilityRef: 'ping', input: {}, ctx: c };
    expect(assertMutationGate(readOnlyTool, env, new ElicitationManager())).toEqual({ ok: true });
  });

  it('an ungated, non-idempotent mutation is denied for BOTH reasons', () => {
    const { c } = ctx();
    const env: AppToolInvocation = { capabilityRef: 'create_widget', input: { label: 'x' }, ctx: c };
    const r = assertMutationGate(createWidget, env, new ElicitationManager());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.sort()).toEqual(['gate_required', 'idempotency_required']);
  });

  it('a mutation with idempotency but no released gate is denied (gate_required)', () => {
    const { c } = ctx();
    const env: AppToolInvocation = { capabilityRef: 'create_widget', input: { label: 'x' }, ctx: c, idempotencyKey: 'idem-1' };
    const r = assertMutationGate(createWidget, env, new ElicitationManager());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(['gate_required']);
  });

  it('invokeGuardedTool runs nothing and audits a denial when ungated', async () => {
    const { c, audit } = ctx();
    const run = vi.fn(async () => ({ id: 'should-not-run' }));
    const env: AppToolInvocation = { capabilityRef: 'create_widget', input: { label: 'x' }, ctx: c };
    const res = await invokeGuardedTool(createWidget, env, { elicitations: new ElicitationManager(), audit, auditId: 'audit-1', run });
    expect(res.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(audit.events.some((e) => e.kind === 'tool.invoke.denied')).toBe(true);
  });

  it('invokeGuardedTool runs + audits when gate + idempotency are satisfied', async () => {
    const { c, audit } = ctx();
    const { elicitations, ref } = releasedGate();
    const run = vi.fn(async () => ({ id: 'widget-x' }));
    const env: AppToolInvocation = { capabilityRef: 'create_widget', input: { label: 'x' }, ctx: c, idempotencyKey: 'idem-1', elicitationRef: ref };
    const res = await invokeGuardedTool(createWidget, env, { elicitations, audit, auditId: 'audit-1', run });
    expect(res.ok).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    const invoke = audit.events.find((e) => e.kind === 'tool.invoke');
    expect(invoke?.detail?.idempotencyKey).toBe('idem-1');
    expect(invoke?.detail?.mutatesExternalSystem).toBe(true);
  });
});
