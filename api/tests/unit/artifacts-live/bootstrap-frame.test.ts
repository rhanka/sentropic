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
    expect(await pod.send('renew')).toEqual({ renewed: true });
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

describe('pod bootstrap: warm-pool poolEpoch fence (L3 §7.3.2)', () => {
  const epoch = (poolEpoch: number, bound: 0 | 1, over: Record<string, unknown> = {}) =>
    ({ generation: 0, sessionId: 'pool-session', leaseEpoch: 0, routeEpoch: 0, ...POD, poolEpoch, bound, ...over });
  it('should order pool epochs above generations and reject replayed epoch frames', async () => {
    const pod = await harness();
    await pod.send('phase', { phase: 'stopped' }, epoch(1, 0));
    // A session frame at an older epoch is stale even with a newer generation.
    await expect(pod.send('phase', { phase: 'stopped' }, fence(9, 9, 's9', 9))).rejects.toThrow('fenced:stale_fence');
    // Bound-0 frames must not carry session epochs.
    await expect(pod.send('phase', { phase: 'stopped' },
      epoch(2, 0, { generation: 1 }))).rejects.toThrow('fenced:invalid_fence');
    // The next epoch unbinds again after a full cycle below; here epoch 2 bound 0 advances.
    await pod.send('phase', { phase: 'stopped' }, epoch(2, 0));
    await expect(pod.send('phase', { phase: 'stopped' }, epoch(1, 0))).rejects.toThrow('fenced:stale_fence');
  });
  it('should refuse a second claim at the same fence instead of double-binding', async () => {
    const pod = await harness();
    await expect(pod.send('claim', {}, epoch(0, 1))).toEqual({ claimed: true, poolEpoch: 0 });
    await expect(pod.send('claim', {}, epoch(0, 1))).rejects.toThrow('failed:already_bound');
    const other = { ...epoch(0, 1), sessionId: 'other-session' };
    await expect(pod.send('claim', {}, other)).rejects.toThrow('fenced:stale_fence');
  });
  it('should scrub to the next epoch, clearing workspace and tmp but keeping host files and dependencies', async () => {
    const { writeFile, readFile } = await import('node:fs/promises');
    const pod = await harness();
    await writeFile(pod.path('workspace/app.ts'), 'console.log(1)');
    await writeFile(pod.path('tmp/junk.bin'), 'junk');
    await writeFile(pod.path('tmp/artifact-vite.config.mjs'), 'host');
    await writeFile(pod.path('dependencies/package.json'), '{}');
    await pod.send('claim', {}, epoch(0, 1));
    await expect(pod.send('scrub', { nextEpoch: 1 }, epoch(0, 1))).toEqual({ cleared: ['/workspace', '/tmp'], poolEpoch: 1 });
    await expect(readFile(pod.path('workspace/app.ts'), 'utf8').then(() => true, () => false)).toBe(false);
    await expect(readFile(pod.path('tmp/junk.bin'), 'utf8').then(() => true, () => false)).toBe(false);
    await expect(readFile(pod.path('tmp/artifact-vite.config.mjs'), 'utf8')).toBe('host');
    await expect(readFile(pod.path('dependencies/package.json'), 'utf8')).toBe('{}');
    // A replayed scrub at the old epoch is refused; a fresh claim binds the next epoch.
    await expect(pod.send('scrub', { nextEpoch: 1 }, epoch(0, 1))).rejects.toThrow('failed:not_bound');
    await expect(pod.send('claim', {}, epoch(1, 1))).toEqual({ claimed: true, poolEpoch: 1 });
  });
  it('should refuse scrub without a claim and on epoch mismatch', async () => {
    const pod = await harness();
    await expect(pod.send('scrub', { nextEpoch: 1 }, epoch(0, 1))).rejects.toThrow('failed:not_bound');
    await pod.send('claim', {}, epoch(0, 1));
    await expect(pod.send('scrub', { nextEpoch: 7 }, epoch(0, 1))).rejects.toThrow('failed:epoch_mismatch');
  });
  it('should refuse session ops on an unbound pool pod', async () => {
    const pod = await harness();
    await pod.send('phase', { phase: 'stopped' }, epoch(0, 0));
    await expect(pod.send('overlay', {}, epoch(0, 0))).rejects.toThrow('fenced:unbound_pool');
    await expect(pod.send('dev', {}, epoch(0, 0))).rejects.toThrow('fenced:unbound_pool');
    await pod.send('claim', {}, epoch(0, 1));
    await expect(pod.send('overlay', {})).rejects.toThrow('failed:');
  });
});
