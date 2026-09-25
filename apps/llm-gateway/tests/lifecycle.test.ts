import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { createHostApp } from '../src/app';
import { main } from '../src/index';
import { handleShutdownSignals, startHost, type RunningHost } from '../src/lifecycle';
import { chatRequest, fixtureDependencies, gatedGenerate, gatedStream, testConfig } from './fixtures';

const url = (running: RunningHost, path: string) => `http://127.0.0.1:${running.port}${path}`;

const readUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>, text: string, needle: string,
): Promise<string> => {
  const decoder = new TextDecoder();
  while (!text.includes(needle)) {
    const next = await reader.read();
    if (next.done) break;
    text += decoder.decode(next.value, { stream: true });
  }
  return text;
};

const readAll = async (reader: ReadableStreamDefaultReader<Uint8Array>, text: string): Promise<string> => {
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return text;
      text += decoder.decode(next.value, { stream: true });
    }
  } catch {
    return text;
  }
};

const openStream = async (running: RunningHost) => {
  const response = await fetch(url(running, '/v1/chat/completions'), chatRequest(true));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  return { reader, text: await readUntil(reader, '', 'one') };
};

const clean = { drained: true, cancelled: 0, aborted: 0, settled: true };

describe('listen and stop', () => {
  it('listens, serves live health with 503 readiness, and stops idempotently', async () => {
    const lines: string[] = [];
    const running = await main({ env: { NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1' }, log: (line) => lines.push(line) });
    expect(running.port).toBeGreaterThan(0);
    expect(lines).toContain(`llm-gateway-host listening port=${running.port} pending=identity,routing,settlement`);
    expect((await fetch(url(running, '/healthz'))).status).toBe(200);
    expect((await fetch(url(running, '/readyz'))).status).toBe(503);

    const stopped = running.stop();
    expect(running.stop()).toBe(stopped);
    await expect(stopped).resolves.toEqual(clean);
    await expect(fetch(url(running, '/healthz'))).rejects.toThrow();
  });

  it('refuses invalid configuration before listening', async () => {
    await expect(main({ env: { NODE_ENV: 'staging', PORT: '0' }, log: () => undefined }))
      .rejects.toMatchObject({ code: 'invalid_llm_gateway_host_config', field: 'NODE_ENV' });
  });

  it('rejects a startup listen error, then only logs server errors by code once listening', async () => {
    const lines: string[] = [];
    let server!: Server;
    const host = await createHostApp({ config: testConfig(), dependencies: {} });
    const running = await startHost(host, testConfig(), {
      log: (line) => lines.push(line), onListening: (listening) => { server = listening; },
    });
    const taken = await createHostApp({ config: testConfig(), dependencies: {} });
    await expect(startHost(taken, testConfig({ port: running.port }))).rejects.toMatchObject({ code: 'EADDRINUSE' });

    server.emit('error', Object.assign(new Error('secret-bearing detail'), { code: 'ECONNRESET' }));
    expect(lines).toEqual(['llm-gateway-host server error code=ECONNRESET']);
    expect((await fetch(url(running, '/healthz'))).status).toBe(200);
    await expect(running.stop()).resolves.toEqual(clean);
  });

  it('stops once on SIGTERM, keeps its listeners for a repeated signal, and exits 0 or 1', async () => {
    const target = new EventEmitter();
    const exit = vi.fn();
    let finish!: () => void;
    const stop = vi.fn(() => new Promise<typeof clean>((resolve) => { finish = () => resolve(clean); }));
    handleShutdownSignals(target, { port: 1, stop }, exit);
    target.emit('SIGTERM');
    // A second signal mid-drain is absorbed by the attached listener, never the default kill.
    expect(target.listenerCount('SIGTERM')).toBe(1);
    expect(target.listenerCount('SIGINT')).toBe(1);
    target.emit('SIGTERM');
    target.emit('SIGINT');
    expect(stop).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(exit).toHaveBeenCalledOnce();

    const failing = new EventEmitter();
    handleShutdownSignals(failing, { port: 1, stop: async () => { throw new Error('close failed'); } }, exit);
    failing.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});

describe('SIGTERM with an active SSE stream', () => {
  it('marks not-ready, refuses new admission and drains the stream before closing', async () => {
    const gated = gatedStream();
    const { dependencies, settlements } = fixtureDependencies(gated.stream);
    const host = await createHostApp({ config: testConfig(), dependencies });
    const running = await startHost(host, testConfig({ drainTimeoutMs: 5_000 }));
    const { reader, text } = await openStream(running);

    const signals = new EventEmitter();
    const exit = vi.fn();
    handleShutdownSignals(signals, running, exit);
    signals.emit('SIGTERM');
    let stopped = false;
    const stopping = running.stop().then((report) => { stopped = true; return report; });

    expect((await fetch(url(running, '/readyz'))).status).toBe(503);
    const refused = await fetch(url(running, '/v1/chat/completions'), chatRequest(false));
    expect(refused.status).toBe(503);
    expect(stopped).toBe(false);

    gated.release();
    expect(await readAll(reader, text)).toContain('two');
    await expect(stopping).resolves.toEqual(clean);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(settlements.map((settlement) => settlement.outcome)).toEqual(['success']);
  });

  it('cancels a stream still open at the drain bound and records its settlement before stop resolves', async () => {
    const gated = gatedStream();
    const { dependencies, settlements } = fixtureDependencies(gated.stream);
    const host = await createHostApp({ config: testConfig(), dependencies });
    const running = await startHost(host, testConfig({ drainTimeoutMs: 100 }));
    const { reader, text } = await openStream(running);

    const report = await running.stop();
    // Asserted synchronously on resolution: settlement precedes the stop outcome (and exit).
    expect(settlements.map((settlement) => settlement.outcome)).toEqual(['cancelled']);
    expect(gated.finished).toHaveBeenCalledOnce();
    expect(report).toEqual({ drained: false, cancelled: 1, aborted: 0, settled: true });
    expect(await readAll(reader, text)).not.toContain('two');
  });

  it('bounds settlement when the provider ignores cancellation', async () => {
    const gated = gatedStream({ ignoreAbort: true });
    const { dependencies } = fixtureDependencies(gated.stream);
    const lines: string[] = [];
    const host = await createHostApp({ config: testConfig(), dependencies });
    const running = await startHost(host, testConfig({ drainTimeoutMs: 100 }), {
      log: (line) => lines.push(line), settleTimeoutMs: 100,
    });
    const { reader } = await openStream(running);

    await expect(running.stop()).resolves.toEqual({ drained: false, cancelled: 1, aborted: 0, settled: false });
    expect(lines).toEqual(['llm-gateway-host shutdown settlement bound reached pending=1']);
    gated.release();
    await reader.cancel().catch(() => undefined);
  });
});

describe('SIGTERM with requests still computing their response', () => {
  it('aborts an in-flight JSON request at the drain bound and settles it before stop resolves', async () => {
    const gated = gatedGenerate();
    const { dependencies, settlements } = fixtureDependencies(gatedStream().stream, gated.generate);
    const host = await createHostApp({ config: testConfig(), dependencies });
    const running = await startHost(host, testConfig({ drainTimeoutMs: 100 }));
    const responding = fetch(url(running, '/v1/chat/completions'), chatRequest(false)).then(
      (response) => response.status, () => 'closed',
    );
    await vi.waitFor(() => expect(gated.generate).toHaveBeenCalledOnce());

    const report = await running.stop();
    expect(settlements.map((settlement) => settlement.outcome)).toEqual(['cancelled']);
    expect(report).toEqual({ drained: false, cancelled: 0, aborted: 1, settled: true });
    expect(await responding).not.toBe(200);
  });

  it('aborts an SSE request that has not emitted its first frame and settles it before stop resolves', async () => {
    const gated = gatedStream({ beforeFirst: true });
    const { dependencies, settlements } = fixtureDependencies(gated.stream);
    const host = await createHostApp({ config: testConfig(), dependencies });
    const running = await startHost(host, testConfig({ drainTimeoutMs: 100 }));
    const responding = fetch(url(running, '/v1/chat/completions'), chatRequest(true)).then(
      async (response) => (response.body ? readAll(response.body.getReader(), '') : ''), () => '',
    );
    await vi.waitFor(() => expect(gated.stream).toHaveBeenCalledOnce());

    const report = await running.stop();
    expect(settlements.map((settlement) => settlement.outcome)).toEqual(['cancelled']);
    expect(gated.finished).toHaveBeenCalledOnce();
    expect(report).toEqual({ drained: false, cancelled: 0, aborted: 1, settled: true });
    expect(await responding).not.toContain('one');
  });
});
