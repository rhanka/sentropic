import { describe, expect, it } from 'vitest';
import { FRAME_TTL_MS } from '../../../src/services/artifacts/live/supervisor-frame';
import { BUILD_RECIPE, LIVE_RECIPE, PREBUNDLE_RECIPE, artifactEnvironment, buildEnvironment, liveEnvironment }
  from '../../../src/services/artifacts/live/recipes';
import { fakePod, refuse, runtime, sha256 } from './supervisor-pod';

const stale = { code: 'git_live_conflict', reason: 'stale_fence' };
const unavailable = { code: 'builder_unavailable' };

describe('supervisor transport fencing', () => {
  it('should sign every command with the full fence, the leased pod identity and a short delivery window', async () => {
    const pod = fakePod();
    await pod.supervisor.terminate(runtime);
    expect(pod.bodies[0]).toMatchObject({ v: 1, op: 'terminate', issuedAt: 1_000, expiresAt: 1_000 + FRAME_TTL_MS,
      fence: { generation: 1, sessionId: 'sess-1', leaseEpoch: 2, routeEpoch: 3, podName: runtime.podName, podUid: 'uid-1' } });
  });
  it('should refuse without sending when no pod is leased or the fence is older than one already sent', async () => {
    const pod = fakePod();
    await expect(pod.supervisor.terminate({ ...runtime, podUid: null })).rejects.toMatchObject(unavailable);
    await pod.supervisor.terminate({ ...runtime, routeEpoch: 4 });
    await expect(pod.supervisor.terminate(runtime)).rejects.toMatchObject(stale);
    await expect(pod.supervisor.terminate({ ...runtime, routeEpoch: 4, sessionId: 'other' })).rejects.toMatchObject(stale);
    await pod.supervisor.terminate({ ...runtime, generation: 2, leaseEpoch: 1, routeEpoch: 1 });
    expect(pod.channel.send).toHaveBeenCalledTimes(2);
  });
  it('should cancel older in-flight commands on terminate and require the whole process tree to be gone', async () => {
    let aborted = false;
    const pod = fakePod({
      build: (_body, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
      terminate: () => ({ treeGone: false }),
    });
    const pending = pod.supervisor.build(runtime, { id: 'a' } as never, BUILD_RECIPE, buildEnvironment()).catch(e => e);
    await expect(pod.supervisor.terminate({ ...runtime, routeEpoch: 4 })).rejects.toMatchObject(unavailable);
    expect(aborted).toBe(true);
    expect(await pending).toMatchObject(unavailable);
  });
  it('should time out a silent pod, abort its request and surface no transport text', async () => {
    let aborted = false;
    const silent = fakePod({ phase: (_b, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }) });
    await expect(silent.supervisor.phase(runtime, 'offline')).rejects.toMatchObject(unavailable);
    expect(aborted).toBe(true);
    const down = fakePod({ terminate: () => { throw new Error('ECONNREFUSED secret-token'); } });
    const error = await down.supervisor.terminate(runtime).catch(e => e);
    expect(error).toMatchObject(unavailable);
    expect(String(error.message) + JSON.stringify(error)).not.toContain('secret-token');
  });
  it('should map pod refusals to closed codes', async () => {
    await expect(fakePod({ terminate: () => refuse('fenced') }).supervisor.terminate(runtime)).rejects.toMatchObject(stale);
    await expect(fakePod({ clear: () => refuse('limit') }).supervisor.clear(runtime, ['/tmp'])).rejects.toMatchObject({ code: 'limit_exceeded' });
  });
});

describe('supervisor transport commands', () => {
  it('should confirm a phase by echo only, since W2 makes the relay fence a static policy proven by Q1', async () => {
    const pod = fakePod();
    await pod.supervisor.phase(runtime, 'offline');
    await pod.supervisor.phase(runtime, 'stopped');
    expect(pod.bodies.map(b => b.args)).toEqual([{ phase: 'offline' }, { phase: 'stopped' }]);
    await expect(fakePod({ phase: () => ({ phase: 'stopped' }) }).supervisor.phase(runtime, 'offline')).rejects.toMatchObject(unavailable);
  });
  it('should clear only the writable phase roots and require the echoed set', async () => {
    const pod = fakePod();
    await pod.supervisor.clear(runtime, ['/workspace', '/dependencies', '/tmp']);
    for (const paths of [[], ['/'], ['/workspace/../etc'], ['/tmp', '/tmp']]) {
      await expect(pod.supervisor.clear(runtime, paths)).rejects.toMatchObject(unavailable);
    }
    expect(pod.channel.send).toHaveBeenCalledTimes(1);
    await expect(fakePod({ clear: () => ({ cleared: ['/tmp'] }) }).supervisor.clear(runtime, ['/workspace'])).rejects.toMatchObject(unavailable);
  });
  it('should write only whitelisted bounded host files and require their digest', async () => {
    const pod = fakePod();
    await pod.supervisor.hostFile(runtime, '/tmp/artifact-vite.config.mjs', 'export default {}');
    expect(pod.bodies[0].args).toEqual({ path: '/tmp/artifact-vite.config.mjs', source: 'export default {}' });
    // HOST_FILES stays at 3: the bootstrap writes its frozen pre-bundle script itself.
    for (const path of ['/workspace/x', '/tmp/artifact-vite-prebundle.mjs']) {
      await expect(pod.supervisor.hostFile(runtime, path, 'x')).rejects.toMatchObject(unavailable);
    }
    await expect(pod.supervisor.hostFile(runtime, '/tmp/artifact-vite.config.mjs', 'x'.repeat(70_000))).rejects.toMatchObject(unavailable);
    expect(pod.channel.send).toHaveBeenCalledTimes(1);
    const wrong = fakePod({ hostFile: () => ({ sha256: sha256('other') }) });
    await expect(wrong.supervisor.hostFile(runtime, '/tmp/host-npmrc', '')).rejects.toMatchObject(unavailable);
  });
  it('should run the pre-bundle by recipe name only with the live environment and require its acknowledgement', async () => {
    const env = liveEnvironment();
    const pod = fakePod();
    await pod.supervisor.prebundle(runtime, PREBUNDLE_RECIPE, env);
    expect(pod.bodies[0]).toMatchObject({ op: 'prebundle', args: { recipe: 'prebundle' } });
    await expect(pod.supervisor.prebundle(runtime, { ...PREBUNDLE_RECIPE, args: ['/tmp/x.mjs'] } as never, env)).rejects.toMatchObject(unavailable);
    for (const other of [artifactEnvironment(), buildEnvironment()]) {
      await expect(pod.supervisor.prebundle(runtime, PREBUNDLE_RECIPE, other as never)).rejects.toMatchObject(unavailable);
    }
    expect(pod.channel.send).toHaveBeenCalledTimes(1);
    await expect(fakePod({ prebundle: () => ({}) }).supervisor.prebundle(runtime, PREBUNDLE_RECIPE, env)).rejects.toMatchObject(unavailable);
    await expect(fakePod({ prebundle: () => refuse('failed') }).supervisor.prebundle(runtime, PREBUNDLE_RECIPE, env))
      .rejects.toMatchObject(unavailable);
  });
  it('should start Vite by recipe name only and fence the acknowledged route epoch and revision type', async () => {
    const env = liveEnvironment();
    const pod = fakePod();
    expect(await pod.supervisor.dev(runtime, LIVE_RECIPE, env)).toEqual({ revision: 7, routeEpoch: 3 });
    expect(pod.bodies[0].args).toEqual({ recipe: 'live' });
    await expect(pod.supervisor.dev(runtime, { ...LIVE_RECIPE, args: ['--evil'] } as never, env)).rejects.toMatchObject(unavailable);
    await expect(pod.supervisor.dev(runtime, LIVE_RECIPE, { ...env, NODE_OPTIONS: '--inspect' } as never)).rejects.toMatchObject(unavailable);
    for (const other of [artifactEnvironment(), buildEnvironment()]) {
      await expect(pod.supervisor.dev(runtime, LIVE_RECIPE, other as never)).rejects.toMatchObject(unavailable);
    }
    const old = fakePod({ dev: () => ({ revision: 7, routeEpoch: 2 }) });
    await expect(old.supervisor.dev(runtime, LIVE_RECIPE, env)).rejects.toMatchObject(stale);
    const typed = fakePod({ dev: () => ({ revision: '7', routeEpoch: 3 }) });
    await expect(typed.supervisor.dev(runtime, LIVE_RECIPE, env)).rejects.toMatchObject(unavailable);
  });
});
