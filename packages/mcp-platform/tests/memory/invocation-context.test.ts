/**
 * MCP-L5 Lot 1 — platform verified invocation context tests.
 *
 * Case: P01.platform.invocation-context. Covers the closed host-to-neutral
 * projection, M2 audit refusal and the M4 literal-true verdict matrix, with
 * two principals, two tenants and workspace/tenant separation.
 */
import { describe, expect, it } from 'vitest';
import type { StpConnectorContext } from '../../src/runtime.js';
import { hostContext } from './host-fixture.js';
import {
  MemoryTrustedContextError,
  isLiteralTrueVerdict,
  projectMemoryContext,
  requireTrustedInvocationContext,
  validateMemoryProjection,
} from '../../src/memory/invocation-context.js';

function makeCtx(overrides: Record<string, unknown> = {}): StpConnectorContext {
  return { ...hostContext(), ...overrides } as StpConnectorContext;
}

describe('P01.platform.invocation-context', () => {
  it('P01.platform.invocation-context: projects a verified host context field by field', () => {
    const projection = projectMemoryContext(makeCtx(), 'purpose-1');
    expect(projection.trusted_context).toMatchObject({ principal_id: 'user-1', tenant_id: 'tenant-1', store_id: 'store-1', scope_ref: 'scope-1' });
    expect(projection.routing_provenance).toMatchObject({ active_generation: '1', policy_epoch: '2' });
    expect(validateMemoryProjection(projection)).toEqual([]);
  });

  it('P01.platform.invocation-context: uses only the explicit host agent binding', () => {
    const ctx = makeCtx();
    ctx.principal.claims = { sub: 'user-1', tid: 'tenant-1', agent_ref: 'agent-7' };
    expect(projectMemoryContext(ctx, 'purpose-1').agent_id).toBe('agent-1');
  });

  it('P01.platform.invocation-context: keeps two principals and two tenants isolated', () => {
    const first = projectMemoryContext(
      makeCtx({
        principal: {
          sub: 'user-1',
          claims: { sub: 'user-1', tid: 'tenant-1' },
          scopes: ['mcp:tools:invoke'],
          tenantRef: 'tenant-1',
          authTime: '2026-10-18T00:00:00.000Z',
        },
        tenantRef: 'tenant-1',
        auditId: 'audit-host-1',
      }),
      'purpose-1',
    );
    const second = projectMemoryContext(
      makeCtx({
        principal: {
          sub: 'user-2',
          claims: { sub: 'user-2', tid: 'tenant-2' },
          scopes: ['mcp:tools:invoke'],
          tenantRef: 'tenant-2',
          authTime: '2026-10-18T00:00:00.000Z',
        },
        tenantRef: 'tenant-2',
        auditId: 'audit-host-2',
        memory: { ...hostContext().memory!, binding: { ...hostContext().memory!.binding,
          sub: 'user-2', principal_id: 'user-2', tid: 'tenant-2', tenant_id: 'tenant-2',
          audit_id: 'audit-host-2', purpose_ref: 'purpose-2' } },
      }),
      'purpose-2',
    );
    expect(first.neutral_principal.principal_id).not.toBe(second.neutral_principal.principal_id);
    expect(first.neutral_principal.tenant_id).not.toBe(second.neutral_principal.tenant_id);
    expect(first.envelope_bindings.audit_id).not.toBe(second.envelope_bindings.audit_id);
  });

  it('P01.platform.invocation-context: refuses absent, malformed and synthetic audit context', () => {
    expect(() => requireTrustedInvocationContext(undefined)).toThrow(MemoryTrustedContextError);
    expect(() => requireTrustedInvocationContext(null)).toThrow(MemoryTrustedContextError);
    expect(() => requireTrustedInvocationContext(makeCtx({ auditId: '' }))).toThrow(
      MemoryTrustedContextError,
    );
    expect(() => requireTrustedInvocationContext(makeCtx({ auditId: 'audit_mcp_l0_default' }))).toThrow(
      MemoryTrustedContextError,
    );
    for (const bad of [undefined, null, 42, 'purpose-1']) {
      expect(() => projectMemoryContext(bad as unknown as StpConnectorContext, 'purpose-1')).toThrow(
        MemoryTrustedContextError,
      );
    }
  });

  it('P01.platform.invocation-context: refuses substituted tenant and missing freshness, session or purpose', () => {
    expect(() => projectMemoryContext(makeCtx({ workspaceRef: 'tenant-1' }), 'purpose-1')).toThrow(
      MemoryTrustedContextError,
    );
    const noAuthTime = makeCtx();
    (noAuthTime.principal as { authTime?: unknown }).authTime = undefined;
    expect(() => projectMemoryContext(noAuthTime, 'purpose-1')).toThrow(MemoryTrustedContextError);
    expect(() => projectMemoryContext(makeCtx({ session: {} }), 'purpose-1')).toThrow(
      MemoryTrustedContextError,
    );
    expect(() => projectMemoryContext(makeCtx(), '')).toThrow(MemoryTrustedContextError);
    const noSub = makeCtx();
    noSub.principal.sub = '';
    expect(() => projectMemoryContext(noSub, 'purpose-1')).toThrow(MemoryTrustedContextError);
  });

  it('P01.platform.invocation-context: literal true alone authorizes, every other verdict refuses', () => {
    expect(isLiteralTrueVerdict(true)).toBe(true);
    for (const verdict of [false, undefined, null, 'true', 1, 0, '', {}, []] as unknown[]) {
      expect(isLiteralTrueVerdict(verdict)).toBe(false);
    }
  });
});
