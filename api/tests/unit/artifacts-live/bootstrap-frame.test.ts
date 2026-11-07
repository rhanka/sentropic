import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { fence, harness, POD, seal } from './bootstrap-harness';

const CONFIG = { path: '/tmp/artifact-vite.config.mjs', source: 'export default {}' };
const written = async (pod: Awaited<ReturnType<typeof harness>>) =>
  readFile(pod.path('tmp/artifact-vite.config.mjs'), 'utf8').then(() => true, () => false);

describe('pod bootstrap: W3 signed frames verified in the pod before any operation', () => {
  it('should execute only frames signed with the pod-spec public key, before reading the body', async () => {
    const pod = await harness();
    const other = generateKeyPairSync('ed25519');
    expect(await pod.deliver(seal(other.privateKey, pod.body('hostFile', CONFIG)))).toBeNull();
    const tampered = seal(pod.keys.privateKey, pod.body('hostFile', CONFIG)); tampered[tampered.length - 3] ^= 1;
    expect(await pod.deliver(tampered)).toBeNull();
    expect(await pod.deliver(seal(pod.keys.privateKey, pod.body('hostFile', CONFIG)).subarray(0, 64))).toBeNull();
    expect(await pod.deliver(Buffer.from(JSON.stringify(pod.body('hostFile', CONFIG))))).toBeNull();
    expect(await written(pod)).toBe(false);
    const frame = pod.body('hostFile', CONFIG);
    expect(await pod.deliver(seal(pod.keys.privateKey, frame))).toMatchObject({ id: frame.id, ok: true });
    expect(await written(pod)).toBe(true);
  });

  it('should enforce the 2 MiB cap, the 30 s delivery window, 5 s skew and the closed frame shape', async () => {
    const pod = await harness(); const now = pod.clock.now;
    const sealed = (patch: Record<string, unknown>, op = 'phase', args: unknown = { phase: 'stopped' }) =>
      pod.deliver(seal(pod.keys.privateKey, { ...pod.body(op, args as Record<string, unknown>), ...patch }));
    expect(await sealed({ args: { phase: 'stopped', pad: 'x'.repeat(2 * 1024 * 1024) } })).toBeNull();
    expect(await sealed({ issuedAt: now, expiresAt: now + 30_001 })).toBeNull();
    expect(await sealed({ issuedAt: now - 31_000, expiresAt: now - 1_000 })).toBeNull();
    expect(await sealed({ issuedAt: now + 5_001, expiresAt: now + 6_000 })).toBeNull();
    expect(await sealed({ v: 2 })).toBeNull();
    expect(await sealed({ op: 'exec' })).toBeNull();
    expect(await sealed({ extra: true })).toBeNull();
    expect(await sealed({ id: 'bad id' })).toBeNull();
    expect(await sealed({ args: [] })).toBeNull();
    expect(await sealed({ issuedAt: now + 4_000, expiresAt: now + 30_000 })).toMatchObject({ ok: true, data: { phase: 'stopped' } });
  });

  it('should refuse a replayed frame id within its window and after it expired', async () => {
    const pod = await harness();
    const frame = seal(pod.keys.privateKey, pod.body('phase', { phase: 'stopped' }));
    expect(await pod.deliver(frame)).toMatchObject({ ok: true });
    expect(await pod.deliver(frame)).toBeNull();
    const same = pod.body('phase', { phase: 'offline' }); same.id = 'f-1';
    expect(await pod.deliver(seal(pod.keys.privateKey, same))).toBeNull();
    pod.clock.now += 31_000;
    expect(await pod.deliver(frame)).toBeNull();
    expect(await pod.send('phase', { phase: 'stopped' })).toMatchObject({ phase: 'stopped' });
  });

  it('should bind every frame to this pod and a monotonic generation, lease and route fence', async () => {
    const pod = await harness();
    await expect(pod.send('phase', { phase: 'stopped' }, { ...fence(), podUid: 'other-uid' })).rejects.toThrow('fenced:');
    await expect(pod.send('phase', { phase: 'stopped' }, { ...fence(), podName: `artifact-${'b'.repeat(40)}` })).rejects.toThrow('fenced:');
    await expect(pod.send('phase', { phase: 'stopped' }, { ...fence(), extra: 1 } as never)).rejects.toThrow('fenced:');
    const { podUid: _uid, ...partial } = fence();
    await expect(pod.send('phase', { phase: 'stopped' }, partial as never)).rejects.toThrow('fenced:');
    await pod.send('phase', { phase: 'stopped' }, fence(2, 2, 's1', 2));
    await expect(pod.send('phase', { phase: 'stopped' }, fence(3, 2, 's1', 1))).rejects.toThrow('fenced:stale_fence');
    await expect(pod.send('phase', { phase: 'stopped' }, fence(9, 1, 's1', 2))).rejects.toThrow('fenced:stale_fence');
    await expect(pod.send('phase', { phase: 'stopped' }, fence(1, 2, 's1', 2))).rejects.toThrow('fenced:stale_fence');
    await expect(pod.send('phase', { phase: 'stopped' }, fence(2, 2, 's2', 2))).rejects.toThrow('fenced:stale_fence');
    await pod.send('phase', { phase: 'stopped' }, fence(3, 2, 's1', 2));
    await pod.send('phase', { phase: 'stopped' }, fence(1, 1, 's9', 3));
    expect(POD.podUid).toBe(fence().podUid);
  });

  it('should answer with the closed W3 reply envelope and refusal codes only', async () => {
    const pod = await harness();
    const frame = pod.body('phase', { phase: 'live', note: 1 });
    const reply = await pod.deliver(seal(pod.keys.privateKey, frame));
    expect(reply).toEqual({ id: frame.id, ok: false, code: 'failed', reason: 'unknown_field' });
    await expect(pod.send('phase', { phase: 'live' })).rejects.toThrow('failed:invalid_phase');
    await expect(pod.send('phase', {})).rejects.toThrow('failed:missing_field');
  });
});

describe('pod bootstrap: liveness lease (A-LIVE Amendment 1 §3)', () => {
  it('should kill the whole process tree and exit after 30 minutes without a valid fenced frame', async () => {
    let alive = [41, 42];
    const pod = await harness({ processes: { list: async () => alive, kill: () => { alive = []; }, killGroup: () => undefined } });
    const minutes = (n: number) => { pod.clock.now += n * 60_000; };
    minutes(29); expect(await pod.agent.checkLease()).toBe(false);
    await pod.send('phase', { phase: 'stopped' });
    minutes(29); expect(await pod.agent.checkLease()).toBe(false);
    const other = generateKeyPairSync('ed25519');
    await pod.deliver(seal(other.privateKey, pod.body('phase', { phase: 'stopped' })));
    await pod.send('phase', { phase: 'stopped' }, fence(5));
    await expect(pod.send('phase', { phase: 'stopped' }, fence(4))).rejects.toThrow('fenced:stale_fence');
    minutes(29); expect(await pod.agent.checkLease()).toBe(false);
    minutes(1); expect(alive).toEqual([41, 42]);
    expect(await pod.agent.checkLease()).toBe(true);
    expect(alive).toEqual([]); expect(pod.exits).toEqual([3]);
    expect(await pod.deliver(seal(pod.keys.privateKey, pod.body('phase', { phase: 'stopped' }, fence(6))))).toBeNull();
    expect(await pod.agent.checkLease()).toBe(false); expect(pod.exits).toEqual([3]);
  });

  it('should renew the lease on a valid fenced frame even when its operation is refused', async () => {
    const pod = await harness();
    pod.clock.now += 29 * 60_000;
    await expect(pod.send('phase', { phase: 'live' })).rejects.toThrow('failed:invalid_phase');
    pod.clock.now += 29 * 60_000;
    expect(await pod.agent.checkLease()).toBe(false); expect(pod.exits).toEqual([]);
  });
});
