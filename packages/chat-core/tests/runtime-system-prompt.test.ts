/**
 * BR14b Lot 16a — `ChatRuntime.ensureSessionTitle` unit tests.
 * BR14b Lot 16b — `ChatRuntime.prepareSystemPrompt` unit tests added below.
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
 * The Lot 16b suite (`prepareSystemPrompt`) exercises the Slice B body
 * delegation: input mapping from `AssistantRunContext` + caller options
 * to the typed `BuildSystemPromptInput`, callback dispatch, and result
 * forwarding. The runtime method is a trivial wrapper because the
 * 605-line build chain itself lives on the chat-service side
 * (`buildSystemPromptInternal`) — the unit tests therefore exercise
 * the boundary contract only, not the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  AssistantRunContext,
  BuildSystemPromptInput,
  BuildSystemPromptResult,
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
  InMemoryStreamSequencer,
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
  const streamSequencer = new InMemoryStreamSequencer();
  const checkpointStore = new InMemoryCheckpointStore<ChatState>();
  const mesh = new InMemoryMeshDispatch();
  const ensureSessionTitleSpy = vi.fn(async () => 'Generated title');
  const deps: ChatRuntimeDeps = {
    messageStore,
    sessionStore,
    streamBuffer,
    streamSequencer,
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

const buildAssistantRunContext = (
  overrides: Partial<AssistantRunContext> = {},
): AssistantRunContext => ({
  session: buildSession(),
  sessionWorkspaceId: 'ws-1',
  readOnly: false,
  canWrite: true,
  currentUserRole: 'editor',
  contextsOverride: [
    { contextType: 'initiative', contextId: 'init-1' },
  ],
  focusContext: { contextType: 'initiative', contextId: 'init-1' },
  messages: [],
  assistantRow: {
    id: 'msg-assistant',
    sessionId,
    role: 'assistant',
    content: '',
    contexts: null,
    toolCalls: null,
    toolCallId: null,
    reasoning: null,
    model: null,
    promptId: null,
    promptVersionId: null,
    sequence: 2,
    createdAt: new Date('2026-05-01T10:00:00Z'),
  },
  conversation: [
    { role: 'user', content: 'Help me draft a roadmap' },
  ],
  lastUserMessage: 'Help me draft a roadmap',
  ...overrides,
});

const buildPromptResult = (
  overrides: Partial<BuildSystemPromptResult> = {},
): BuildSystemPromptResult => ({
  systemPrompt: 'You are an assistant.',
  tools: undefined,
  localTools: [],
  localToolNames: new Set<string>(),
  allowedByType: {
    organization: new Set<string>(),
    folder: new Set<string>(),
    usecase: new Set<string>(['init-1']),
    executive_summary: new Set<string>(),
  },
  allowedFolderIds: new Set<string>(),
  allowedDocContexts: [],
  allowedCommentContexts: [],
  hasContextType: () => false,
  primaryContextType: 'initiative',
  primaryContextId: 'init-1',
  vscodeCodeAgentPayload: null,
  enforceTodoUpdateMode: false,
  todoStructuralMutationIntent: false,
  todoProgressionFocusMode: false,
  hasActiveSessionTodo: false,
  ...overrides,
});

describe('ChatRuntime.prepareSystemPrompt (Lot 16b)', () => {
  it('throws when buildSystemPrompt dep is not wired', async () => {
    const fixture = buildFixture({ buildSystemPrompt: undefined });
    const ctx = buildAssistantRunContext();
    await expect(
      fixture.runtime.prepareSystemPrompt(ctx, {
        userId: 'user-x',
        sessionId,
        requestedTools: [],
      }),
    ).rejects.toThrow(
      'ChatRuntime.prepareSystemPrompt requires deps.buildSystemPrompt',
    );
  });

  it('forwards AssistantRunContext fields and caller options to the callback', async () => {
    const buildSystemPrompt = vi.fn(async () => buildPromptResult());
    const fixture = buildFixture({ buildSystemPrompt });
    const ctx = buildAssistantRunContext();
    await fixture.runtime.prepareSystemPrompt(ctx, {
      userId: 'user-x',
      sessionId,
      requestedTools: ['plan', 'web_search'],
      localToolDefinitions: [{ kind: 'fake' }],
      vscodeCodeAgent: { workspaceKey: 'wk-1' },
    });
    expect(buildSystemPrompt).toHaveBeenCalledTimes(1);
    const call = buildSystemPrompt.mock.calls[0]?.[0] as BuildSystemPromptInput;
    expect(call.userId).toBe('user-x');
    expect(call.sessionId).toBe(sessionId);
    expect(call.session.id).toBe(sessionId);
    expect(call.sessionWorkspaceId).toBe('ws-1');
    expect(call.readOnly).toBe(false);
    expect(call.currentUserRole).toBe('editor');
    expect(call.contextsOverride).toEqual([
      { contextType: 'initiative', contextId: 'init-1' },
    ]);
    expect(call.focusContext).toEqual({
      contextType: 'initiative',
      contextId: 'init-1',
    });
    expect(call.lastUserMessage).toBe('Help me draft a roadmap');
    expect(call.requestedTools).toEqual(['plan', 'web_search']);
    expect(call.localToolDefinitions).toEqual([{ kind: 'fake' }]);
    expect(call.vscodeCodeAgent).toEqual({ workspaceKey: 'wk-1' });
  });

  it('forwards readOnly=true from the precheck context', async () => {
    const buildSystemPrompt = vi.fn(async () => buildPromptResult());
    const fixture = buildFixture({ buildSystemPrompt });
    const ctx = buildAssistantRunContext({
      readOnly: true,
      canWrite: false,
      currentUserRole: 'viewer',
    });
    await fixture.runtime.prepareSystemPrompt(ctx, {
      userId: 'user-x',
      sessionId,
      requestedTools: [],
    });
    const call = buildSystemPrompt.mock.calls[0]?.[0] as BuildSystemPromptInput;
    expect(call.readOnly).toBe(true);
    expect(call.currentUserRole).toBe('viewer');
  });

  it('forwards focusContext=null and an empty contextsOverride', async () => {
    const buildSystemPrompt = vi.fn(async () => buildPromptResult());
    const fixture = buildFixture({ buildSystemPrompt });
    const ctx = buildAssistantRunContext({
      focusContext: null,
      contextsOverride: [],
    });
    await fixture.runtime.prepareSystemPrompt(ctx, {
      userId: 'user-x',
      sessionId,
      requestedTools: [],
    });
    const call = buildSystemPrompt.mock.calls[0]?.[0] as BuildSystemPromptInput;
    expect(call.focusContext).toBeNull();
    expect(call.contextsOverride).toEqual([]);
  });

  it('returns the BuildSystemPromptResult struct verbatim from the callback', async () => {
    const customResult = buildPromptResult({
      systemPrompt: 'CUSTOM PROMPT',
      enforceTodoUpdateMode: true,
      hasActiveSessionTodo: true,
      todoProgressionFocusMode: true,
      primaryContextType: 'folder',
      primaryContextId: 'folder-9',
    });
    const buildSystemPrompt = vi.fn(async () => customResult);
    const fixture = buildFixture({ buildSystemPrompt });
    const ctx = buildAssistantRunContext();
    const result = await fixture.runtime.prepareSystemPrompt(ctx, {
      userId: 'user-x',
      sessionId,
      requestedTools: [],
    });
    expect(result.systemPrompt).toBe('CUSTOM PROMPT');
    expect(result.enforceTodoUpdateMode).toBe(true);
    expect(result.hasActiveSessionTodo).toBe(true);
    expect(result.todoProgressionFocusMode).toBe(true);
    expect(result.primaryContextType).toBe('folder');
    expect(result.primaryContextId).toBe('folder-9');
  });

  it('omits localToolDefinitions and vscodeCodeAgent when not provided', async () => {
    const buildSystemPrompt = vi.fn(async () => buildPromptResult());
    const fixture = buildFixture({ buildSystemPrompt });
    const ctx = buildAssistantRunContext();
    await fixture.runtime.prepareSystemPrompt(ctx, {
      userId: 'user-x',
      sessionId,
      requestedTools: [],
    });
    const call = buildSystemPrompt.mock.calls[0]?.[0] as BuildSystemPromptInput;
    expect(call.localToolDefinitions).toBeUndefined();
    expect(call.vscodeCodeAgent).toBeUndefined();
  });

  it('propagates an error thrown by the callback', async () => {
    const buildSystemPrompt = vi.fn(async () => {
      throw new Error('catalog unavailable');
    });
    const fixture = buildFixture({ buildSystemPrompt });
    const ctx = buildAssistantRunContext();
    await expect(
      fixture.runtime.prepareSystemPrompt(ctx, {
        userId: 'user-x',
        sessionId,
        requestedTools: [],
      }),
    ).rejects.toThrow('catalog unavailable');
  });
});
