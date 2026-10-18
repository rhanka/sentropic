/**
 * MCP-L5 Lot 1 — platform verified invocation context tests.
 *
 * Case: P01.platform.invocation-context. Covers the closed host-to-neutral
 * projection, M2 audit refusal and the M4 literal-true verdict matrix, with
 * two principals, two tenants and workspace/tenant separation.
 */
import { describe, expect, it } from 'vitest';
import type { StpConnectorContext } from '../../src/runtime.js';
import {
  MemoryTrustedContextError,
  isLiteralTrueVerdict,
  projectMemoryContext,
  requireTrustedInvocationContext,
  validateMemoryProjection,
} from '../../src/memory/invocation-context.js';

function makeCtx(overrides: Record<string, unknown> = {}): StpConnectorContext {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-host-1',
    principal: {
      sub: 'user-1',
      claims: { sub: 'user-1', tid: 'tenant-1' },
      scopes: ['mcp:tools:invoke'],
      tenantRef: 'tenant-1',
      authTime: '2026-10-18T00:00:00.000Z',
    },
    surface: 'backend',
    session: { mcpSessionId: 'session-1' },
    tenantRef: 'tenant-1',
    connectorInstanceId: 'ci-1',
    consentRefs: [],
    grantRefs: [],
    getSecret: async () => '',
    connectorConfig: {},
    audit: { emit: async () => undefined },
    logger: undefined,
    ...overrides,
  } as StpConnectorContext;
}

describe('P01.platform.invocation-context', () => {
  it('P01.platform.invocation-context: projects a verified host context field by field', () => {
    const projection = projectMemoryContext(makeCtx(), 'purpose-1');
    expect(projection).toEqual({
      principalNamespace: 'sentropic.principal',
      principalId: 'user-1',
      tenantId: 'tenant-1',
      storeRef: 'ci-1',
      scopeRef: 'tenant-1',
      purposeRef: 'purpose-1',
      agentRef: 'user-1',
      connectorInstanceRef: 'ci-1',
      policyEpoch: '2026-10-18T00:00:00.000Z',
      attachmentGeneration: 'req-1',
      auditRef: 'audit-host-1',
      idempotencyKey: 'corr-1',
      elicitationRef: null,
    });
    expect(validateMemoryProjection(projection)).toEqual([]);
  });

  it('P01.platform.invocation-context: honors a host-supplied agent_ref claim', () => {
    const ctx = makeCtx();
    ctx.principal.claims = { sub: 'user-1', tid: 'tenant-1', agent_ref: 'agent-7' };
    expect(projectMemoryContext(ctx, 'purpose-1').agentRef).toBe('agent-7');
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
        auditId: 'audit-tenant-1',
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
        auditId: 'audit-tenant-2',
      }),
      'purpose-2',
    );
    expect(first.principalId).not.toBe(second.principalId);
    expect(first.tenantId).not.toBe(second.tenantId);
    expect(first.auditRef).not.toBe(second.auditRef);
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
