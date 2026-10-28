import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRendererRegistry } from '../src/renderers/registry';
import type { ChatCoreTransport } from '../src/client/transport';
import type { StreamHubClient } from '../src/client/streamTypes';
import type { LocalToolsAdapter } from '../src/hosts/types';
import { createWebHost } from '../src/hosts/createWebHost';

const hostPath = resolve(process.cwd(), 'src/hosts/createWebHost.ts');

const createTransport = (): ChatCoreTransport => ({
  openStream: vi.fn(() => ({ close: vi.fn() }) as unknown as EventSource),
  postMessage: vi.fn(async () => new Response('{}')),
  fetchBootstrap: vi.fn(async () => ({})),
});

const createStreamClient = (): StreamHubClient => ({
  reset: vi.fn(),
  clearCaches: vi.fn(),
  set: vi.fn(),
  setJobUpdates: vi.fn(),
  setStream: vi.fn(),
  delete: vi.fn(),
});

describe('createWebHost', () => {
  it('exists as a package-owned host factory without app imports', () => {
    expect(existsSync(hostPath)).toBe(true);
    const source = readFileSync(hostPath, 'utf8');
    expect(source).not.toContain('$lib/');
    expect(source).not.toContain("from 'svelte-i18n'");
    expect(source).not.toContain('QueueMonitor');
    expect(source).not.toContain("apiPost('/queue");
    expect(source).toContain('export const createWebHost');
    expect(source).toContain('ChatUiJobsHostAdapter');
    expect(source).toContain('ChatUiCommentsHostAdapter');
    expect(source).toContain('ChatUiDocumentHostAdapter');
  });

  it('composes web transport, stream client, labels, renderers, jobs, comments, documents, and local tools', async () => {
    const transport = createTransport();
    const streamClient = createStreamClient();
    const renderers = createRendererRegistry();
    const localTools: LocalToolsAdapter = {
      id: 'web-test',
      sendMessage: vi.fn(async () => ({ ok: true, result: { id: 'ok' } })),
    };
    const purgeMine = vi.fn();
    const labels = vi.fn((key: string) => `label:${key}`);
    const jobs = {
      renderPanel: { id: 'jobs-panel' },
      activeJobsCount: 2,
      failedJobsCount: 1,
      queueTabLabel: 'Jobs',
      purgeMine,
    };
    const comments = {
      renderPanel: { id: 'comments-panel' },
      openThread: vi.fn(),
    };
    const documents = {
      createSessionContext: vi.fn((sessionId: string) => ({ sessionId })),
      extractGeneratedFileCards: vi.fn(() => []),
    };

    const host = createWebHost({
      transport,
      streamClient,
      labels,
      renderers,
      localTools,
      jobs,
      comments,
      documents,
      contextProvider: { id: 'context' },
      auth: { getSession: vi.fn(() => ({ userId: 'user-1' })) },
      navigation: { navigate: vi.fn() },
      storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    });

    expect(host.kind).toBe('web');
    expect(host.transport).toBe(transport);
    expect(host.streamClient).toBe(streamClient);
    expect(host.labels('chat.tabs.jobs')).toBe('label:chat.tabs.jobs');
    expect(host.renderers).toBe(renderers);
    expect(host.localTools).toBe(localTools);
    expect(host.jobs).toBe(jobs);
    expect(host.comments).toBe(comments);
    expect(host.documents).toBe(documents);
    expect(await host.localTools?.sendMessage?.({ type: 'ping' })).toEqual({
      ok: true,
      result: { id: 'ok' },
    });
  });

  it('installs safe default labels and renderer registry when optional adapters are omitted', () => {
    const host = createWebHost({
      transport: createTransport(),
      streamClient: createStreamClient(),
    });

    expect(host.labels('chat.unknown')).toBe('chat.unknown');
    expect(host.renderers.default({ ok: true })).toBe('{"ok":true}');
    expect(host.localTools).toBeUndefined();
  });

  it('fails fast when required transport or stream client adapters are missing', () => {
    expect(() =>
      createWebHost({
        transport: null as unknown as ChatCoreTransport,
        streamClient: createStreamClient(),
      }),
    ).toThrow('transport');
    expect(() =>
      createWebHost({
        transport: createTransport(),
        streamClient: null as unknown as StreamHubClient,
      }),
    ).toThrow('streamClient');
  });
});
