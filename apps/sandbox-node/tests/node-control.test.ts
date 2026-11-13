import { describe, expect, it, vi } from 'vitest';
import { NodeControl } from '../src/node-control.js';

describe('control-plane heartbeat versus operator monitoring', () => {
  it('should fence stale/node-substituted heartbeats and refuse the operator role', () => {
    const heartbeat = vi.fn();
    const control = new NodeControl('n', 2, { heartbeat }, { authorize: vi.fn() }, () => 10_000);
    const body = { expectedNodeInstanceId: 'n', expectedNodeEpoch: 2, sentAt: new Date(10_000).toISOString() };
    expect(() => control.heartbeat('operator', body)).toThrow();
    expect(() => control.heartbeat('control-plane', { ...body, expectedNodeEpoch: 1 })).toThrow();
    expect(() => control.heartbeat('control-plane', { ...body, sentAt: new Date(0).toISOString() })).toThrow();
    expect(heartbeat).not.toHaveBeenCalled();
    expect(control.heartbeat('control-plane', body)).toMatchObject({ nodeInstanceId: 'n', nodeEpoch: 2 });
    expect(heartbeat).toHaveBeenCalledOnce();
  });
  it('should change drain state only after a valid operator authorization', () => {
    const authorize = vi.fn();
    const control = new NodeControl('n', 2, { heartbeat: vi.fn() }, { authorize });
    expect(() => control.operate('control-plane', 'drain', 'token')).toThrow();
    expect(control.draining).toBe(false);
    control.operate('operator', 'drain', 'token'); expect(control.draining).toBe(true);
    authorize.mockImplementationOnce(() => { throw new Error('invalid'); });
    expect(() => control.operate('operator', 'undrain', 'invalid')).toThrow();
    expect(control.draining).toBe(true);
    control.operate('operator', 'undrain', 'fresh'); expect(control.draining).toBe(false);
  });
});
