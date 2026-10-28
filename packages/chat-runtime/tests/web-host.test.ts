import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRendererRegistry } from '@sentropic/chat-ui/renderers/registry';
import type { ChatCoreTransport } from '../src/client/transport';
import type { StreamHubClient } from '../src/client/streamTypes';
import type { LocalToolsAdapter } from '@sentropic/chat-runtime/hosts/types';
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
