import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SUPERVISOR_PATH } from '../../../api/src/services/artifacts/live/bootstrap-server';
import { MAX_FRAME_BYTES, MAX_REPLY_BYTES, supervisorPublicKey } from '../../../api/src/services/artifacts/live/supervisor-frame';
import { createRelaySupervisorChannel } from '../../../api/src/services/artifacts/live/supervisor-relay';
import { createSupervisorRoute } from '../src/host';
import { startContentServer } from '../src/index';
import { supervisorRelayFromEnv } from '../src/supervisor-relay';
import { baseDomain, cleanup, fakePod, frame, INTERNAL, keys, loopback, NS, own, POD, post, relayTo, replyTo, resolved, status,
  type Seen } from './supervisor-relay-fixture';

const artifactId = '11111111-1111-4111-8111-111111111111';
const refused = { status: 403, body: '' };
const answering = () => fakePod(seen => seen.res.end(replyTo(seen.body)));
afterEach(cleanup);

describe('artifact-content supervisor relay (A-LIVE §8.1 relay contract B)', () => {
  it('should refuse an unsigned, foreign-signed or expired frame with an empty 403 and no pod call', async () => {
    const pod = await answering();
    const route = createSupervisorRoute({ relay: relayTo(pod.port), baseDomain });
    for (const body of [Buffer.alloc(200, 3), frame(generateKeyPairSync('ed25519').privateKey),
      frame(keys.privateKey, POD.podName, 'f-1', Date.now() - 60_000)]) expect(await status(post(route, body))).toEqual(refused);
    expect(await status(post(route, frame(), { headers: { 'content-type': 'application/json' } }))).toEqual(refused);
    expect(pod.seen).toHaveLength(0);
  });

  it('should refuse a malformed pod name or a frame fenced to another pod with 403', async () => {
    const pod = await answering();
    const route = createSupervisorRoute({ relay: relayTo(pod.port), baseDomain });
    expect(await status(post(route, frame(), { path: `/_live-supervisor/v1/artifact-${'c'.repeat(40)}` }))).toEqual(refused);
    for (const name of ['artifact-xyz', `artifact-${'A'.repeat(40)}`, `artifact-${'a'.repeat(40)}%2F..`, '']) {
      expect(await status(post(route, frame(), { path: `/_live-supervisor/v1/${name}` }))).toEqual(refused);
    }
    expect(pod.seen).toHaveLength(0);
  });

  it('should refuse a body over 2 MiB or under 65 bytes with 413 before any pod call', async () => {
    const pod = await answering();
    const route = createSupervisorRoute({ relay: relayTo(pod.port), baseDomain });
    for (const body of [Buffer.alloc(MAX_FRAME_BYTES + 1), Buffer.alloc(64), Buffer.alloc(0)]) {
      expect((await status(post(route, body)))?.status).toBe(413);
    }
    expect((await status(post(route, frame(), { headers: { 'content-length': String(MAX_FRAME_BYTES + 1) } })))?.status).toBe(413);
    expect(pod.seen).toHaveLength(0);
  });

  it('should answer 404 on a public content host, a pages host, a foreign Host header or another method', async () => {
    const pod = await answering();
    const route = createSupervisorRoute({ relay: relayTo(pod.port), baseDomain });
    for (const host of [baseDomain, `${artifactId}.${baseDomain}`, `${artifactId}.pages.preprod.immo.example`, 'localhost:8791',
      `${INTERNAL}.evil.example`]) expect((await status(post(route, frame(), { host })))?.status).toBe(404);
    expect((await status(post(route, frame(), { headers: { host: `${artifactId}.${baseDomain}` } })))?.status).toBe(404);
    expect((await status(post(route, frame(), { method: 'GET' })))?.status).toBe(404);
    expect(post(route, frame(), { path: '/_live-fence/v1' })).toBeUndefined();
    expect(pod.seen).toHaveLength(0);
  });

  it('should answer 404 when the relay is disabled, independent of the live and content flags', async () => {
    expect(supervisorRelayFromEnv({ APP_ARTIFACT_LIVE_ENABLED: '1', APP_ARTIFACT_CONTENT_ENABLED: '1' })).toBeUndefined();
    expect(supervisorRelayFromEnv({ APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED: 'true' })).toBeUndefined();
    expect((await status(post(createSupervisorRoute({ baseDomain }), frame())))).toMatchObject({ status: 404 });
    const server = own(await startContentServer({ env: {}, hostname: '127.0.0.1', port: 0 }));
    const channel = createRelaySupervisorChannel({ baseUrl: `http://${INTERNAL}:${(server.address() as AddressInfo).port}`, lookup: loopback });
    await expect(channel.send(POD, frame(), new AbortController().signal)).rejects.toMatchObject({ code: 'builder_unavailable' });
  });

  it('should compose only from one or two Ed25519 SPKI public keys and a valid builder namespace', async () => {
    const pod = await answering();
    const next = generateKeyPairSync('ed25519');
    const pair = `${supervisorPublicKey(keys.privateKey)} ${supervisorPublicKey(next.privateKey)}`;
    const on = { APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED: '1', APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS: pair };
    expect(supervisorRelayFromEnv(on)).toBeDefined();
    const ed448 = generateKeyPairSync('ed448').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    for (const value of [undefined, '', 'not-base64!', 'AAAA', ed448, `${pair} ${supervisorPublicKey(generateKeyPairSync('ed25519').privateKey)}`,
      `${supervisorPublicKey(keys.privateKey)} ${supervisorPublicKey(keys.privateKey)}`]) {
      expect(() => supervisorRelayFromEnv({ ...on, APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS: value })).toThrow(/APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS/);
    }
    expect(() => supervisorRelayFromEnv({ ...on, APP_ARTIFACT_LIVE_BUILDER_NAMESPACE: 'Bad_NS' })).toThrow(/namespace/);
    await expect(startContentServer({ env: { ...on, APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS: 'AAAA' }, port: 0 })).rejects.toThrow();
    // Rotation: a frame signed by either configured key is relayed.
    const route = createSupervisorRoute({ relay: relayTo(pod.port, [keys.publicKey, next.publicKey]), baseDomain });
    expect((await status(post(route, frame(next.privateKey))))?.status).toBe(200);
  });

  it('should forward the same bytes only, to the pod Service on :5173, and map the pod status', async () => {
    let answer = (seen: Seen) => { seen.res.writeHead(200, { 'content-type': 'application/json' }).end(replyTo(seen.body)); };
    const pod = await fakePod(seen => answer(seen));
    const route = createSupervisorRoute({ relay: relayTo(pod.port), baseDomain });
    const sent = frame();
    const ok = await post(route, sent, { headers: { cookie: 'sid=secret', authorization: 'Bearer x', 'x-forwarded-for': '1.2.3.4' } });
    expect(ok?.status).toBe(200);
    expect(Buffer.from(await ok!.arrayBuffer())).toEqual(replyTo(sent));
    expect(pod.seen[0]).toMatchObject({ method: 'POST', url: SUPERVISOR_PATH, body: Buffer.from(sent) });
    expect(SUPERVISOR_PATH).toBe('/_supervisor/v1/frame');
    expect(Object.keys(pod.seen[0].headers).sort()).toEqual(['connection', 'content-length', 'content-type', 'host']);
    expect(pod.seen[0].headers['content-type']).toBe('application/octet-stream');
    expect(resolved).toContain(`${POD.podName}.${NS}.svc.cluster.local`);
    for (const [code, text] of [[403, ''], [500, 'x'], [404, ''], [413, '']] as const) {
      answer = seen => { seen.res.writeHead(code).end(text); };
      expect(await status(post(route, frame()))).toEqual({ status: code === 403 ? 403 : 502, body: '' });
    }
    answer = seen => { seen.res.writeHead(200); seen.res.write(Buffer.alloc(MAX_REPLY_BYTES)); seen.res.end(Buffer.alloc(1)); };
    expect(await status(post(route, frame()))).toEqual({ status: 502, body: '' });
    answer = seen => { seen.res.writeHead(200).end(Buffer.alloc(MAX_REPLY_BYTES, 7)); };
    expect((await post(route, frame()))?.status).toBe(200);
    answer = seen => { seen.res.socket?.destroy(); };
    expect(await status(post(route, frame()))).toEqual({ status: 502, body: '' });
    expect(await status(post(createSupervisorRoute({ relay: relayTo(1), baseDomain }), frame()))).toEqual({ status: 502, body: '' });
  });
});
