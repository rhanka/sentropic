import { describe, expect, it } from 'vitest';

import {
  createChatServer,
  createInMemoryChatServerDeps,
  type ChatServerCapabilities,
} from '../src/index';

type CreateMessageInput = {
  providerApiKey?: string | null;
  [key: string]: unknown;
};

type EnqueueInput = {
  providerApiKey?: string;
  tools?: string[];
  localToolDefinitions?: unknown[];
  vscodeCodeAgent?: unknown;
  [key: string]: unknown;
};

function buildServer(capabilities?: ChatServerCapabilities) {
  const createMessageInputs: CreateMessageInput[] = [];
  const enqueueInputs: EnqueueInput[] = [];
  const deps = createInMemoryChatServerDeps({
    onCreateMessage: (input) => createMessageInputs.push(input as CreateMessageInput),
    onEnqueue: (input) => enqueueInputs.push(input as EnqueueInput),
  });
  const app = createChatServer(deps, { routes: 'canonical', capabilities });
  return { app, createMessageInputs, enqueueInputs };
}

const PRIVILEGED_BODY = {
  content: 'Hello',
  providerApiKey: 'sk-client-injected',
  localToolDefinitions: [{ name: 'rm_rf', schema: {} }],
  vscodeCodeAgent: { id: 'agent-from-client' },
  tools: ['safe_tool', 'forbidden_tool'],
};

async function postMessage(app: ReturnType<typeof buildServer>['app'], body: unknown) {
  return app.request('/chat/sessions/session_capgate/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('chat-server capability gate', () => {
  describe('locked capability set (public mount)', () => {
    const locked: ChatServerCapabilities = {
      acceptClientProviderApiKey: false,
      acceptClientLocalToolDefinitions: false,
      acceptClientVscodeAgent: false,
      allowedTools: ['safe_tool'],
    };

    it('ignores client providerApiKey and falls back to server config (request still succeeds)', async () => {
      const { app, createMessageInputs, enqueueInputs } = buildServer(locked);
      const res = await postMessage(app, PRIVILEGED_BODY);
      expect(res.status).toBe(200);
      expect(createMessageInputs[0].providerApiKey).toBeNull();
      expect(enqueueInputs[0].providerApiKey).toBeUndefined();
    });

    it('ignores client localToolDefinitions', async () => {
      const { app, enqueueInputs } = buildServer(locked);
      await postMessage(app, PRIVILEGED_BODY);
      expect(enqueueInputs[0].localToolDefinitions).toBeUndefined();
    });

    it('ignores client vscodeCodeAgent', async () => {
      const { app, enqueueInputs } = buildServer(locked);
      await postMessage(app, PRIVILEGED_BODY);
      expect(enqueueInputs[0].vscodeCodeAgent).toBeUndefined();
    });

    it('strips tools that are not on the allowlist', async () => {
      const { app, enqueueInputs } = buildServer(locked);
      await postMessage(app, PRIVILEGED_BODY);
      expect(enqueueInputs[0].tools).toEqual(['safe_tool']);
      expect(enqueueInputs[0].tools).not.toContain('forbidden_tool');
    });

    it('returns an explicit empty tool set (not undefined) when every requested tool is denied', async () => {
      const { app, enqueueInputs } = buildServer(locked);
      await postMessage(app, { content: 'Hello', tools: ['forbidden_tool', 'another_forbidden'] });
      // [] not undefined: a queue that reads undefined as "use defaults" must
      // not be tricked into re-adding the denied tools.
      expect(enqueueInputs[0].tools).toEqual([]);
    });

    it('ignores client vscodeCodeAgent on the tool-results fallback path', async () => {
      const { app, enqueueInputs } = buildServer(locked);
      const created = await (await postMessage(app, { content: 'baseline' })).json();
      enqueueInputs.length = 0;
      const res = await app.request(
        `/chat/messages/${created.assistantMessageId}/tool-results`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            toolCallId: 'call_local_1',
            result: { ok: true },
            vscodeCodeAgent: { id: 'agent-from-client' },
          }),
        },
      );
      expect(res.status).toBe(200);
      // The in-memory port returns no vscodeCodeAgent, so the only possible
      // source is the (denied) client body fallback — which must be dropped.
      expect(enqueueInputs[0].vscodeCodeAgent).toBeUndefined();
    });

    it('ignores client vscodeCodeAgent on the retry path', async () => {
      const { app, enqueueInputs } = buildServer(locked);
      const created = await (await postMessage(app, { content: 'baseline' })).json();
      enqueueInputs.length = 0;
      const res = await app.request(`/chat/messages/${created.userMessageId}/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vscodeCodeAgent: { id: 'agent-from-client' } }),
      });
      expect(res.status).toBe(200);
      expect(enqueueInputs[0].vscodeCodeAgent).toBeUndefined();
    });
  });

  describe('permissive default (trusted mount, capabilities omitted)', () => {
    it('passes client providerApiKey, localToolDefinitions, vscodeCodeAgent, and all tools through unchanged', async () => {
      const { app, createMessageInputs, enqueueInputs } = buildServer();
      const res = await postMessage(app, PRIVILEGED_BODY);
      expect(res.status).toBe(200);
      expect(createMessageInputs[0].providerApiKey).toBe('sk-client-injected');
      expect(enqueueInputs[0].providerApiKey).toBe('sk-client-injected');
      expect(enqueueInputs[0].localToolDefinitions).toEqual([{ name: 'rm_rf', schema: {} }]);
      expect(enqueueInputs[0].vscodeCodeAgent).toEqual({ id: 'agent-from-client' });
      expect(enqueueInputs[0].tools).toEqual(['safe_tool', 'forbidden_tool']);
    });

    it('treats allowedTools: "all" identically to the omitted default', async () => {
      const { app, enqueueInputs } = buildServer({ allowedTools: 'all' });
      await postMessage(app, PRIVILEGED_BODY);
      expect(enqueueInputs[0].tools).toEqual(['safe_tool', 'forbidden_tool']);
    });

    it('passes the client vscodeCodeAgent through on the tool-results fallback path', async () => {
      const { app, enqueueInputs } = buildServer();
      const created = await (await postMessage(app, { content: 'baseline' })).json();
      enqueueInputs.length = 0;
      await app.request(`/chat/messages/${created.assistantMessageId}/tool-results`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toolCallId: 'call_local_1',
          result: { ok: true },
          vscodeCodeAgent: { id: 'agent-from-client' },
        }),
      });
      expect(enqueueInputs[0].vscodeCodeAgent).toEqual({ id: 'agent-from-client' });
    });
  });

  describe('partial capability sets', () => {
    it('denies only the provider key while still accepting tool definitions', async () => {
      const { app, createMessageInputs, enqueueInputs } = buildServer({
        acceptClientProviderApiKey: false,
      });
      await postMessage(app, PRIVILEGED_BODY);
      expect(createMessageInputs[0].providerApiKey).toBeNull();
      expect(enqueueInputs[0].localToolDefinitions).toEqual([{ name: 'rm_rf', schema: {} }]);
      expect(enqueueInputs[0].vscodeCodeAgent).toEqual({ id: 'agent-from-client' });
    });
  });
});
