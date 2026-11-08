import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifactLiveService } from '../../../src/services/artifacts/live/service';
import { MAX_FRAME_BYTES, MAX_REPLY_BYTES } from '../../../src/services/artifacts/live/supervisor-frame';
import {
  createRelaySupervisorChannel, SUPERVISOR_COMMAND_TIMEOUT_MS, SUPERVISOR_RELAY_PATH, SUPERVISOR_RELAY_URL_ENV, supervisorRelayUrl,
} from '../../../src/services/artifacts/live/supervisor-relay';

const POD = { podName: `artifact-${'b'.repeat(40)}`, podUid: 'uid-1' };
const HOST = 'artifact-content.sentropic-test.svc.cluster.local';
const unavailable = expect.objectContaining({ code: 'builder_unavailable' });
const unconfigured = expect.objectContaining({ code: 'builder_unavailable', reason: 'relay_unconfigured' });
/** Resolves the internal Service DNS name to the loopback test listener. */
const loopback: LookupFunction = (_host, options, callback) => {
  if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
};
interface Seen { method?: string; url?: string; headers: IncomingMessage['headers']; body: Buffer; closed: Promise<void> }
const open: Server[] = [];
afterEach(() => { for (const server of open.splice(0)) { server.closeAllConnections(); server.close(); } });
async function relay(answer: (seen: Seen, res: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    const entry: Seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.alloc(0),
      closed: new Promise(resolve => res.once('close', () => resolve())) };
    seen.push(entry);
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { entry.body = Buffer.concat(chunks); answer(entry, res); });
  });
  open.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { seen, channel: createRelaySupervisorChannel({ baseUrl: `http://${HOST}:${port}`, lookup: loopback }) };
}
const frame = Buffer.concat([Buffer.alloc(64, 1), Buffer.from('{"v":1}')]);
const signal = () => new AbortController().signal;

describe('API supervisor relay channel (A-LIVE §8.1 relay contract A)', () => {
  it('should read the relay base URL from its fixed per-environment name and refuse an unsafe or absent value', () => {
    expect(SUPERVISOR_RELAY_URL_ENV).toBe('ARTIFACT_SUPERVISOR_RELAY_URL');
    const preprod = 'http://artifact-content.sentropic-preprod.svc.cluster.local:8791';
    expect(supervisorRelayUrl({ [SUPERVISOR_RELAY_URL_ENV]: preprod })).toBe(preprod);
    for (const value of [undefined, '', 'not a url', 'https://artifact-content.sentropic-preprod.svc.cluster.local:8791',
      'http://user:secret@artifact-content.sentropic-preprod.svc.cluster.local:8791',
      'http://artifact-content.sentropic-preprod.svc.cluster.local:8791?x=1',
      'http://artifact-content.sentropic-preprod.svc.cluster.local:8791/#f',
      'http://artifact-content.sentropic-preprod.svc.cluster.local:8791/api',
      'http://artifact-content.svc.cluster.local:8791', 'http://preprod.sentropic.sent-tech.ca',
      'http://artifact-content.sentropic-preprod.svc.cluster.local.evil.example:8791', 'http://10.0.0.1:8791']) {
      expect(() => supervisorRelayUrl({ [SUPERVISOR_RELAY_URL_ENV]: value })).toThrow(unconfigured);
      if (value !== undefined) expect(() => createRelaySupervisorChannel({ baseUrl: value })).toThrow(unconfigured);
    }
  });

  it('should refuse to compose the live service without a valid relay URL', () => {
    const options = { relayUrl: 'https://artifact-content.x.svc.cluster.local' } as unknown as Parameters<typeof createArtifactLiveService>[0];
    expect(() => createArtifactLiveService(options)).toThrow(unconfigured);
  });

  it('should bound every supervisor command between the pod longest command and the relay upstream bound', () => {
    expect(SUPERVISOR_COMMAND_TIMEOUT_MS).toBe(320_000);
  });

  it('should POST the raw frame bytes as octet-stream to the pod route on the internal Service Host', async () => {
    const reply = Buffer.from('{"id":"f-1","ok":true}');
    const { seen, channel } = await relay((_seen, res) => res.writeHead(200).end(reply));
    expect(Buffer.from(await channel.send(POD, frame, signal()))).toEqual(reply);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: `${SUPERVISOR_RELAY_PATH}${POD.podName}` });
    expect(SUPERVISOR_RELAY_PATH).toBe('/_live-supervisor/v1/');
    expect(seen[0].headers['content-type']).toBe('application/octet-stream');
    expect(seen[0].headers.host).toMatch(new RegExp(`^${HOST.replaceAll('.', '\\.')}:\\d+$`));
    expect(seen[0].body).toEqual(frame);
    expect(Object.keys(seen[0].headers).sort()).toEqual(['connection', 'content-length', 'content-type', 'host']);
  });

  it('should throw builder_unavailable on any non-200 status, an oversized reply or a network error', async () => {
    for (const status of [403, 404, 413, 502, 503, 204]) {
      const { channel } = await relay((_seen, res) => res.writeHead(status).end());
      await expect(channel.send(POD, frame, signal())).rejects.toEqual(unavailable);
    }
    const chunked = await relay((_seen, res) => { res.writeHead(200); res.write(Buffer.alloc(MAX_REPLY_BYTES)); res.end(Buffer.alloc(1)); });
    await expect(chunked.channel.send(POD, frame, signal())).rejects.toEqual(unavailable);
    const exact = await relay((_seen, res) => res.writeHead(200).end(Buffer.alloc(MAX_REPLY_BYTES, 7)));
    expect((await exact.channel.send(POD, frame, signal())).byteLength).toBe(MAX_REPLY_BYTES);
    const reset = await relay((_seen, res) => res.socket?.destroy());
    await expect(reset.channel.send(POD, frame, signal())).rejects.toEqual(unavailable);
    const closed = createRelaySupervisorChannel({ baseUrl: `http://${HOST}:1`, lookup: loopback });
    await expect(closed.send(POD, frame, signal())).rejects.toEqual(unavailable);
  });

  it('should refuse an oversized frame or a malformed pod name without any request', async () => {
    const { seen, channel } = await relay((_seen, res) => res.writeHead(200).end('{}'));
    await expect(channel.send(POD, Buffer.alloc(MAX_FRAME_BYTES + 1), signal())).rejects.toEqual(unavailable);
    for (const podName of ['artifact-x', `artifact-${'B'.repeat(40)}`, `../artifact-${'b'.repeat(40)}`, `artifact-${'b'.repeat(41)}`]) {
      await expect(channel.send({ ...POD, podName }, frame, signal())).rejects.toEqual(unavailable);
    }
    expect(seen).toHaveLength(0);
  });

  it('should abort the relay request when the signal aborts', async () => {
    const { seen, channel } = await relay(() => undefined);
    const controller = new AbortController();
    const sending = channel.send(POD, frame, controller.signal);
    while (!seen.length) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    await expect(sending).rejects.toEqual(unavailable);
    await seen[0].closed;
    const aborted = new AbortController(); aborted.abort();
    await expect(channel.send(POD, frame, aborted.signal)).rejects.toEqual(unavailable);
    expect(seen).toHaveLength(1);
  });
});
