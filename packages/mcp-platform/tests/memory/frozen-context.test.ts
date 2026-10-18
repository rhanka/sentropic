import { describe, expect, it } from 'vitest';
import { projectMemoryContext, validateMemoryProjection } from '../../src/memory/invocation-context.js';
import { hostContext } from './host-fixture.js';

describe('co-frozen A03 binding', () => {
  it('preserves distinct store, scope, epoch, agent and transport provenance', () => {
    const p = projectMemoryContext(hostContext(), 'purpose-1') as any;
    expect(p.trusted_context).toMatchObject({ store_id: 'store-1', scope_ref: 'scope-1', policy_epoch: '2' });
    expect(p.agent_id).toBe('agent-1');
    expect(p.routing_provenance.active_generation).toBe('1');
    expect(p.session_attachment.transport_attachment_ref).toBe('attachment-1');
    expect(p.envelope_bindings.idempotency_key).toBeUndefined();
  });
  it.each(['claims_provenance_receipt', 'tenant_membership_receipt', 'connection_proof_digest', 'agent_id', 'store_id', 'scope_ref'])(
    'refuses missing %s', (key) => {
      const ctx = hostContext() as any;
      delete ctx.memory.binding[key];
      expect(() => projectMemoryContext(ctx, 'purpose-1')).toThrow();
    },
  );
  it.each(['tenantRef', 'connectorInstanceId', 'auditId', 'correlationId'])('refuses substituted host %s', (key) => {
    const ctx = hostContext() as any;
    ctx[key] = 'substituted';
    expect(() => projectMemoryContext(ctx, 'purpose-1')).toThrow();
  });
  it.each([
    (p: any) => { p.extra = true; },
    (p: any) => { p.verified_claims.tenant_membership_receipt = 'unverified'; },
    (p: any) => { p.trusted_context.tenant_id = 'other'; },
    (p: any) => { p.session_attachment.connection_proof_digest = 'unverified'; },
  ])('rejects open, unverified or inconsistent projections', mutate => {
    const p = projectMemoryContext(hostContext(), 'purpose-1'); mutate(p);
    expect(validateMemoryProjection(p).length).toBeGreaterThan(0);
  });
});
