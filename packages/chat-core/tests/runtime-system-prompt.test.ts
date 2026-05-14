/**
 * BR14b Lot 16a — `ChatRuntime.ensureSessionTitle` unit tests.
 *
 * Exercises the title-generation side effect migrated from the leading
 * block of `ChatService.runAssistantGeneration` (chat-service.ts lines
 * 1889-1907 pre-Lot 16). Confirms:
 *   - the runtime short-circuits when the session already has a title
 *   - the runtime short-circuits when the trimmed last user message is empty
 *   - the runtime short-circuits when the callback is not wired
 *   - the runtime forwards session / workspace / focus / message to the
 *     callback unchanged
 *   - the runtime returns whatever the callback returns
 *
 * Lot 16b will extend this file with `prepareSystemPrompt` coverage
 * (system prompt body + tool catalog + context blocks) once the
 * full Slice B body migrates into the runtime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatRuntimeDeps,
  EnsureSessionTitleOptions,
} from '../src/runtime.js';
import type { ChatSessionRow } from '../src/session-port.js';
import type { ChatState } from '../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
} from '../src/in-memory/index.js';

const sessionId = 'session-title-1';
const userId = 'user-title-1';

const ALLOWED_CONTEXT_TYPES = new Set([
  'organization',
  'project',
  'initiative',
  'chat_session',
]);

const buildFixture = (overrides: Partial<ChatRuntimeDeps> = {}) => {
  const messageStore = new InMemoryMessageStore();
  const sessionStore = new InMemorySessionStore();
  const streamBuffer = new InMemoryStreamBuffer();
  const checkpointStore = new InMemoryCheckpointStore<ChatState>();
  const mesh = new InMemoryMeshDispatch();
  const ensureSessionTitleSpy = vi.fn(async () => 'Generated title');
  const deps: ChatRuntimeDeps = {
    messageStore,
    sessionStore,
    streamBuffer,
    checkpointStore,
    mesh,
    normalizeVsCodeCodeAgent: () => null,
    resolveModelSelection: async () => ({
      provider_id: 'openai',
      model_id: 'gpt-test',
    }),
    normalizeMessageContexts: () => [],
    isChatContextType: (value: unknown) =>
      typeof value === 'string' && ALLOWED_CONTEXT_TYPES.has(value),
    resolveSessionWorkspaceId: async (session) => session.workspaceId ?? null,
    listSessionDocuments: async () => [],
    listAssistantDetailsByMessageId: async () => ({}),
    resolveWorkspaceAccess: async () => ({
      readOnly: false,
      canWrite: true,
      currentUserRole: 'editor',
    }),
    ensureSessionTitle: ensureSessionTitleSpy,
    ...overrides,
  };
  return {
    runtime: new ChatRuntime(deps),
    deps,
    messageStore,
    sessionStore,
    streamBuffer,
    checkpointStore,
    ensureSessionTitleSpy,
  };
};

const buildSession = (overrides: Partial<ChatSessionRow> = {}): ChatSessionRow => ({
  id: sessionId,
  userId,
  workspaceId: 'ws-1',
  primaryContextType: null,
  primaryContextId: null,
  title: null,
  createdAt: new Date('2026-05-01T10:00:00Z'),
  updatedAt: new Date('2026-05-01T10:00:00Z'),
  ...overrides,
});

const buildEnsureOptions = (
  overrides: Partial<EnsureSessionTitleOptions> = {},
): EnsureSessionTitleOptions => ({
  session: buildSession(),
  sessionWorkspaceId: 'ws-1',
  focusContext: null,
  lastUserMessage: 'Help me draft a roadmap',
  ...overrides,
});

describe('ChatRuntime.ensureSessionTitle (Lot 16a)', () => {
  let fixture: ReturnType<typeof buildFixture>;
  beforeEach(() => {
    fixture = buildFixture();
  });
  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
  });

  it('returns null and skips callback when session already has a title', async () => {
    const options = buildEnsureOptions({
      session: buildSession({ title: 'Existing title' }),
    });
    const result = await fixture.runtime.ensureSessionTitle(options);
    expect(result).toBeNull();
    expect(fixture.ensureSessionTitleSpy).not.toHaveBeenCalled();
  });

  it('returns null and skips callback when trimmed last user message is empty', async () => {
    const options = buildEnsureOptions({ lastUserMessage: '   \n   ' });
    const result = await fixture.runtime.ensureSessionTitle(options);
    expect(result).toBeNull();
    expect(fixture.ensureSessionTitleSpy).not.toHaveBeenCalled();
  });

  it('returns null when the ensureSessionTitle dep is not provided', async () => {
    const fixtureNoCallback = buildFixture({ ensureSessionTitle: undefined });
    const options = buildEnsureOptions();
    const result = await fixtureNoCallback.runtime.ensureSessionTitle(options);
    expect(result).toBeNull();
  });

  it('forwards session, workspace, focusContext, and lastUserMessage to the callback unchanged', async () => {
    const focus = { contextType: 'initiative', contextId: 'init-42' };
    const options = buildEnsureOptions({
      session: buildSession({
        primaryContextType: 'initiative',
        primaryContextId: 'init-42',
      }),
      focusContext: focus,
      lastUserMessage: 'Compute the matrix score',
    });
    await fixture.runtime.ensureSessionTitle(options);
    expect(fixture.ensureSessionTitleSpy).toHaveBeenCalledTimes(1);
    const firstCall = fixture.ensureSessionTitleSpy.mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({
      sessionWorkspaceId: 'ws-1',
      focusContext: focus,
      lastUserMessage: 'Compute the matrix score',
    });
    expect(firstCall?.session.id).toBe(sessionId);
    expect(firstCall?.session.primaryContextId).toBe('init-42');
  });

  it('propagates the title returned by the callback', async () => {
    const ensureSessionTitle = vi.fn(async () => 'Roadmap draft');
    const fixtureCustom = buildFixture({ ensureSessionTitle });
    const result = await fixtureCustom.runtime.ensureSessionTitle(
      buildEnsureOptions(),
    );
    expect(result).toBe('Roadmap draft');
    expect(ensureSessionTitle).toHaveBeenCalledTimes(1);
  });

  it('propagates a null result from the callback (callback chose to skip)', async () => {
    const ensureSessionTitle = vi.fn(async () => null);
    const fixtureNullReturn = buildFixture({ ensureSessionTitle });
    const result = await fixtureNullReturn.runtime.ensureSessionTitle(
      buildEnsureOptions(),
    );
    expect(result).toBeNull();
    expect(ensureSessionTitle).toHaveBeenCalledTimes(1);
  });
});
