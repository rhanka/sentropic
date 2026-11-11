/**
 * CMP-L3 internal calls through the in-process gateway, code only.
 * Pure wrapper: no database, no provider change.
 */
import { describe, it, expect } from 'vitest';
import {
  admitInternalCall,
  callViaGateway,
  isInternalGatewayEnabled,
  selectInternalCallMode,
} from '../../src/services/llm-runtime/gateway-internal-calls';

const principal = { tenantId: 't1', workspaceId: 'w1', appInstanceId: 'radar-immobilier-preprod' };

describe('CMP-L3 internal gateway', () => {
  it('is direct by default (preprod-safe)', () => {
    delete process.env.CM_INTERNAL_GW_ENABLED;
    expect(isInternalGatewayEnabled()).toBe(false);
    expect(selectInternalCallMode()).toBe('direct');
  });

  it('delegates directly when disabled', async () => {
    delete process.env.CM_INTERNAL_GW_ENABLED;
    await expect(callViaGateway(principal, 1024, 'test', async () => 42)).resolves.toBe(42);
  });

  it('admits scope-pinned workloads when enabled, refuses malformed', async () => {
    process.env.CM_INTERNAL_GW_ENABLED = '1';
    try {
      expect(selectInternalCallMode()).toBe('gateway');
      expect(admitInternalCall(principal, 1024, 'test').budgetScope)
        .toBe('app:radar-immobilier-preprod');
      await expect(callViaGateway(principal, 1024, 'test', async () => 7)).resolves.toBe(7);
      expect(() => admitInternalCall({ ...principal, tenantId: '' }, 1024, 'test')).toThrow();
      await expect(callViaGateway(principal, 0, 'test', async () => 1)).rejects.toThrow();
    } finally {
      delete process.env.CM_INTERNAL_GW_ENABLED;
    }
  });
});
