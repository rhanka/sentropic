/**
 * CMP-L1 app workload principal (GD-14), code only.
 * Pure validation: no database, no migration.
 */
import { describe, it, expect } from 'vitest';
import {
  assertAppWorkloadPrincipal,
  assertServiceClientWorkloadBinding,
  appWorkloadCostContext,
  createAppPartitionPolicy,
  isCmAppWorkloadEnabled,
} from '../../src/services/llm-runtime/gateway-cm-app-workload';
import {
  createCmAuthResolver,
  createCmDispatchPort,
  createCmPoolPort,
} from '../../src/services/llm-runtime/gateway-cm-ports';

const principal = { tenantId: 't1', workspaceId: 'w1', appInstanceId: 'radar-immobilier-preprod' };

describe('CMP-L1 app workload (GD-14)', () => {
  it('is disabled by default (preprod-safe)', () => {
    delete process.env.CM_APP_WORKLOAD_ENABLED;
    expect(isCmAppWorkloadEnabled()).toBe(false);
  });

  it('rejects malformed principals fail-closed', () => {
    expect(() => assertAppWorkloadPrincipal({ ...principal, tenantId: '' })).toThrow();
    expect(() => assertAppWorkloadPrincipal({ ...principal, appInstanceId: 'bad/slug' })).toThrow();
    expect(() => assertAppWorkloadPrincipal({ ...principal, appInstanceId: 'has space' })).toThrow();
  });

  it('builds a scope-pinned cost context', () => {
    const cost = appWorkloadCostContext(principal, '/api/v1/gw');
    expect(cost.tenantId).toBe('t1');
    expect(cost.workspaceId).toBe('w1');
    expect(cost.budgetScope).toBe('app:radar-immobilier-preprod');
  });

  it('rejects revoked, expired or scope-mismatched service bindings', () => {
    const binding = {
      clientId: 'c1', tenantId: 't1', workspaceId: 'w1',
      appInstanceId: 'radar-immobilier-preprod', revoked: false,
    };
    expect(() => assertServiceClientWorkloadBinding(binding, principal)).not.toThrow();
    expect(() => assertServiceClientWorkloadBinding(
      { ...binding, revoked: true }, principal,
    )).toThrow();
    expect(() => assertServiceClientWorkloadBinding(
      { ...binding, expiresAt: new Date(Date.now() - 1000).toISOString() }, principal,
    )).toThrow();
    expect(() => assertServiceClientWorkloadBinding(
      { ...binding, workspaceId: 'other' }, principal,
    )).toThrow();
  });

  it('bounds the per-app partition policy fail-closed', () => {
    expect(createAppPartitionPolicy({ quotaBytes: 1024 }).quotaBytes).toBe(1024);
    expect(() => createAppPartitionPolicy({ quotaBytes: 0 })).toThrow();
    expect(() => createAppPartitionPolicy({ quotaBytes: 1024, maxBytes: -1 })).toThrow();
  });

  it('keeps refused behavior by default, fails closed on seats when enabled', async () => {
    delete process.env.CM_APP_WORKLOAD_ENABLED;
    await expect(createCmPoolPort().select({} as never)).rejects.toThrow('not available');
    await expect(createCmAuthResolver().resolve({} as never)).rejects.toThrow('not available');
    await expect(createCmDispatchPort().dispatch({} as never)).rejects.toThrow('not available');
    process.env.CM_APP_WORKLOAD_ENABLED = '1';
    try {
      await expect(createCmPoolPort().select({} as never)).rejects.toThrow('CMP-L2');
      await expect(createCmAuthResolver().resolve({} as never)).rejects.toThrow('CMP-L2');
      await expect(createCmDispatchPort().dispatch({} as never)).rejects.toThrow('CMP-L2');
    } finally {
      delete process.env.CM_APP_WORKLOAD_ENABLED;
    }
  });
});
