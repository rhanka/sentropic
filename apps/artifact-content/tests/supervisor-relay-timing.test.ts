import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_SOURCE } from '../../../api/src/services/artifacts/live/bootstrap-agent';
import { SERVER_SOURCE } from '../../../api/src/services/artifacts/live/bootstrap-server';
import { SUPERVISOR_COMMAND_TIMEOUT_MS } from '../../../api/src/services/artifacts/live/supervisor-relay';
import { harness } from '../../../api/tests/unit/artifacts-live/bootstrap-harness';
import { createSupervisorRoute } from '../src/host';
import { RELAY_UPSTREAM_TIMEOUT_MS } from '../src/supervisor-relay';
import { apiToListener, baseDomain, cleanup, fakePod, frame, keys, listen, post, relayTo, replyTo, runtime, settle,
  until } from './supervisor-relay-fixture';

/** The pod replies only when a command ends (up to ~300 s): undici's default 300 s headers timeout must sit on no hop. */
const received = (pod: Awaited<ReturnType<typeof fakePod>>) => until(() => pod.seen.length === 1 && pod.seen[0].body.length > 0);
afterEach(cleanup);

describe('supervisor relay timing and end to end (A-LIVE §8.1 relay contract D)', () => {
  it('should deliver a pod reply sent after 310 s (simulated clock) on both hops, without fetch', async () => {
    const pod = await fakePod();
    const { supervisor } = await apiToListener(pod.port);
    vi.stubGlobal('fetch', () => { throw new Error('undici fetch is not a supervisor hop'); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const phase = supervisor().phase(runtime, 'stopped');
    await received(pod);
    await vi.advanceTimersByTimeAsync(310_000);
    pod.seen[0].res.writeHead(200).end(replyTo(pod.seen[0].body));
    await expect(settle(phase)).resolves.toBeUndefined();
  });

  it('should abort the pod request when the API side aborts at its 320 s command bound', async () => {
    const pod = await fakePod();
    const { supervisor } = await apiToListener(pod.port);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const phase = supervisor().phase(runtime, 'stopped');
    await received(pod);
    await vi.advanceTimersByTimeAsync(SUPERVISOR_COMMAND_TIMEOUT_MS - 1);
    let closed = false; void pod.seen[0].closed.then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toBe(false);
    await expect(settle(phase)).rejects.toMatchObject({ code: 'builder_unavailable' });
    await settle(pod.seen[0].closed);
    expect(closed).toBe(true);
  });

  it('should close the pod request with 502 at the 330 s upstream bound', async () => {
    expect(RELAY_UPSTREAM_TIMEOUT_MS).toBe(330_000);
    expect(RELAY_UPSTREAM_TIMEOUT_MS).toBeGreaterThan(SUPERVISOR_COMMAND_TIMEOUT_MS);
    const pod = await fakePod();
    const route = createSupervisorRoute({ relay: relayTo(pod.port), baseDomain });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const response = post(route, frame())!;
    await received(pod);
    await vi.advanceTimersByTimeAsync(RELAY_UPSTREAM_TIMEOUT_MS - 1);
    let settled = false; void response.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    expect((await settle(response)).status).toBe(502);
    await settle(pod.seen[0].closed);
  });

  it('should carry a phase command end to end: API channel, relay listener, real W4 pod bootstrap', async () => {
    const pod = await harness({ publicKey: keys.publicKey });
    pod.clock.now = Date.now();
    const { createControlServer } = await import(/* @vite-ignore */
      `data:text/javascript;base64,${Buffer.from(AGENT_SOURCE + SERVER_SOURCE).toString('base64')}`);
    const { supervisor } = await apiToListener(await listen(createControlServer(pod.agent, 1).server));
    await expect(supervisor({ now: () => pod.clock.now }).phase(runtime, 'stopped')).resolves.toBeUndefined();
    // A frame signed by any other key is refused by the relay before the pod, and by the bootstrap itself.
    const foreign = supervisor({ key: generateKeyPairSync('ed25519').privateKey, now: () => pod.clock.now, id: 'f-2' });
    await expect(foreign.phase(runtime, 'stopped')).rejects.toMatchObject({ code: 'builder_unavailable' });
  });
});
