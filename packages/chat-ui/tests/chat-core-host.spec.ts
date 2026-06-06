/**
 * chat-core-host.spec.ts — compile + runtime proof of the ChatCoreHost contract.
 *
 * Tests:
 * 1. A fake host literal that `satisfies ChatCoreHost` — compile-time proof.
 * 2. Trivial runtime assertion that the fake host methods exist and return
 *    the right shapes.
 * 3. Export-surface registration (package.json + export-manifest.json).
 * 4. Sentropic-string scan — ZERO domain strings in the contract source file.
 *
 * Environment: node (no DOM, no Svelte rendering).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ChatCoreHost, SessionSummary, RunHandle, ModelCatalog, SendMessagePayload } from '../src/client/chat-core-host.js';
import type { StreamHubClient, StreamHubEventHandler } from '../src/client/streamTypes.js';

// ---------------------------------------------------------------------------
// 1. Fake host — compile proof (satisfies ChatCoreHost)
// ---------------------------------------------------------------------------

/**
 * A minimal fake StreamHubClient — satisfies the StreamHubClient interface
 * with no-op implementations so the fake host can include `streamClient`.
 */
const fakeStreamClient: StreamHubClient = {
  reset() {},
  clearCaches() {},
  set(_key: string, _onEvent: StreamHubEventHandler) {},
  setJobUpdates(_key: string, _onEvent: StreamHubEventHandler) {},
  setStream(_key: string, _streamId: string, _onEvent: StreamHubEventHandler) {},
  delete(_key: string) {},
};

const SESSION_A: SessionSummary = {
  id: 'session-a',
  title: 'Test session',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const RUN_HANDLE: RunHandle = {
  sessionId: 'session-a',
  userMessageId: 'user-msg-1',
  assistantMessageId: 'asst-msg-1',
  streamId: 'stream-1',
  jobId: 'job-1',
};

const MODEL_CATALOG: ModelCatalog = {
  providers: [{ provider_id: 'openai', label: 'OpenAI', status: 'ready' }],
  models: [{ provider_id: 'openai', model_id: 'gpt-4o', label: 'GPT-4o', default_contexts: [] }],
  defaults: { provider_id: 'openai', model_id: 'gpt-4o' },
};

/**
 * This object literal uses `satisfies ChatCoreHost` — TypeScript will error
 * at compile time if any method is missing or has an incompatible signature.
 * This is the primary compile proof.
 */
const fakeChatCoreHost = {
  fetchSessions: async () => ({ sessions: [SESSION_A] }),

  fetchSessionHistory: async (_sessionId: string, _detail: 'summary' | 'full') =>
    new Response('{"type":"session_meta"}\n', {
      headers: { 'content-type': 'application/x-ndjson' },
    }),

  sendMessage: async (_payload: SendMessagePayload) => ({ ...RUN_HANDLE }),

  retryMessage: async (
    _messageId: string,
    _opts: { providerId: string; model: string },
  ) => ({ ...RUN_HANDLE }),

  stopMessage: async (_messageId: string) => {},

  editMessage: async (_messageId: string, _content: string) => {},

  setFeedback: async (
    _messageId: string,
    _vote: 'up' | 'down' | 'clear',
  ) => {},

  deleteSession: async (_sessionId: string) => {},

  pollJob: async (_jobId: string) => ({ status: 'completed' as string | undefined }),

  postLocalToolResult: async (
    _streamId: string,
    _toolCallId: string,
    _result: unknown,
  ) => {},

  fetchModelCatalog: async () => ({ ...MODEL_CATALOG }),

  postSteer: async (_streamId: string, _message: string) => {},

  streamClient: fakeStreamClient,
} satisfies ChatCoreHost;

// ---------------------------------------------------------------------------
// 2. Runtime assertions
// ---------------------------------------------------------------------------

describe('ChatCoreHost — fake host compile + runtime proof', () => {
  it('should have all required method keys', () => {
    const requiredKeys: Array<keyof ChatCoreHost> = [
      'fetchSessions',
      'fetchSessionHistory',
      'sendMessage',
      'retryMessage',
      'stopMessage',
      'editMessage',
      'setFeedback',
      'deleteSession',
      'pollJob',
      'postLocalToolResult',
      'fetchModelCatalog',
      'postSteer',
      'streamClient',
    ];
    for (const key of requiredKeys) {
      expect(key in fakeChatCoreHost, `Missing key: ${key}`).toBe(true);
    }
  });

  it('fetchSessions should return sessions array', async () => {
    const result = await fakeChatCoreHost.fetchSessions();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.id).toBe('session-a');
  });

  it('fetchSessionHistory should return a Response', async () => {
    const response = await fakeChatCoreHost.fetchSessionHistory('session-a', 'summary');
    expect(response).toBeInstanceOf(Response);
  });

  it('sendMessage should return a RunHandle', async () => {
    const payload: SendMessagePayload = { content: 'hello' };
    const result = await fakeChatCoreHost.sendMessage(payload);
    expect(result.sessionId).toBe('session-a');
    expect(result.streamId).toBe('stream-1');
    expect(result.jobId).toBe('job-1');
  });

  it('retryMessage should return a RunHandle', async () => {
    const result = await fakeChatCoreHost.retryMessage('msg-1', {
      providerId: 'openai',
      model: 'gpt-4o',
    });
    expect(result.assistantMessageId).toBe('asst-msg-1');
  });

  it('stopMessage should resolve without value', async () => {
    const result = await fakeChatCoreHost.stopMessage('msg-1');
    expect(result).toBeUndefined();
  });

  it('editMessage should resolve without value', async () => {
    const result = await fakeChatCoreHost.editMessage('msg-1', 'updated text');
    expect(result).toBeUndefined();
  });

  it('setFeedback should resolve without value for all vote values', async () => {
    for (const vote of ['up', 'down', 'clear'] as const) {
      const result = await fakeChatCoreHost.setFeedback('msg-1', vote);
      expect(result).toBeUndefined();
    }
  });

  it('deleteSession should resolve without value', async () => {
    const result = await fakeChatCoreHost.deleteSession('session-a');
    expect(result).toBeUndefined();
  });

  it('pollJob should return an object with status', async () => {
    const result = await fakeChatCoreHost.pollJob('job-1');
    expect(result.status).toBe('completed');
  });

  it('postLocalToolResult should resolve without value', async () => {
    const result = await fakeChatCoreHost.postLocalToolResult(
      'stream-1',
      'tool-call-1',
      { output: 'done' },
    );
    expect(result).toBeUndefined();
  });

  it('fetchModelCatalog should return providers and models', async () => {
    const catalog = await fakeChatCoreHost.fetchModelCatalog();
    expect(catalog.providers).toHaveLength(1);
    expect(catalog.models).toHaveLength(1);
    expect(catalog.providers[0]?.provider_id).toBe('openai');
  });

  it('postSteer should resolve without value', async () => {
    const result = await fakeChatCoreHost.postSteer('stream-1', 'focus on X');
    expect(result).toBeUndefined();
  });

  it('streamClient should have set / setStream / setJobUpdates / delete / reset / clearCaches', () => {
    const client = fakeChatCoreHost.streamClient;
    expect(typeof client.set).toBe('function');
    expect(typeof client.setStream).toBe('function');
    expect(typeof client.setJobUpdates).toBe('function');
    expect(typeof client.delete).toBe('function');
    expect(typeof client.reset).toBe('function');
    expect(typeof client.clearCaches).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 3. Export surface — package.json + export-manifest.json registration
// ---------------------------------------------------------------------------

describe('ChatCoreHost — export surface registration', () => {
  const PACKAGE_ROOT = process.cwd();
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as { version: string; exports: Record<string, unknown> };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'export-manifest.json'), 'utf8'),
  ) as { _version: string; subpaths: Record<string, unknown> };

  const SUBPATH = './client/chat-core-host';

  it('should export the chat-core-host subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain(SUBPATH);
  });

  it('should list chat-core-host in export-manifest.json subpaths', () => {
    expect(Object.keys(manifest.subpaths)).toContain(SUBPATH);
  });

  it('should have version 0.17.0 in package.json (minor — documents module + DocumentHost seam)', () => {
    expect(pkgJson.version).toBe('0.17.0');
  });

  it('should have _version 0.17.0 in export-manifest.json', () => {
    expect(manifest._version).toBe('0.17.0');
  });

  it('should resolve the chat-core-host source file to an existing path', () => {
    const entry = pkgJson.exports[SUBPATH] as Record<string, string> | undefined;
    expect(entry).toBeTruthy();
    const file = (entry?.['import'] ?? entry?.['types']) as string;
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file);
    expect(fs.existsSync(abs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Sentropic-string scan — ZERO domain strings in contract source
// ---------------------------------------------------------------------------

describe('ChatCoreHost — sentropic-string scan', () => {
  const PACKAGE_ROOT = process.cwd();
  const contractSource = fs.readFileSync(
    path.join(PACKAGE_ROOT, 'src', 'client', 'chat-core-host.ts'),
    'utf8',
  );

  /**
   * Patterns that must NOT appear in a generic contract file.
   * These are sentropic domain strings — org/folder/initiative/usecase entity
   * names and policy terms that belong in app adapters, not generic contracts.
   */
  const forbiddenPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\borganization\b/i, label: 'organization' },
    { pattern: /\binitiative\b/i, label: 'initiative' },
    { pattern: /\busecase\b/i, label: 'usecase' },
    { pattern: /\bsentropic\b/i, label: 'sentropic' },
    { pattern: /\brhanka\b/i, label: 'rhanka' },
    { pattern: /\bworkspaceType\b/, label: 'workspaceType (domain enum)' },
  ];

  // folder is allowed because `folderId` appears in generic stream event types
  // (StreamHubEvent has folder_update). We allow 'folder' in types.ts context.
  // The contract file itself only references StreamHubClient (no folder strings).

  for (const { pattern, label } of forbiddenPatterns) {
    it(`should contain NO "${label}" domain string`, () => {
      expect(contractSource, `Found forbidden domain string: ${label}`).not.toMatch(pattern);
    });
  }
});
