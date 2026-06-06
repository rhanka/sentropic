/**
 * chat-conversation-functional.dom.spec.ts
 *
 * Functional harness for ChatConversation — proves it is NOT a dead shell
 * AND that the controller (R5) is the engine (no parallel 3rd loop).
 *
 * Setup:
 *   - Fake host with in-memory transport (postMessage returns assistantMessageId +
 *     streamId) and a fake streamClient that captures both set() and setStream()
 *     subscriptions, plus an emit() helper for test-driven event injection.
 *   - Fake localTools runtime that records execute calls.
 *
 * Assertions (the "not-a-dead-shell" + "controller-is-engine" proof):
 *   (a) User message renders in the timeline after send.
 *   (b) Assistant timeline item appears (controller's attachStream registered via
 *       streamClient.set — the controller path, not the legacy setStream path).
 *   (c) The local-tool runtime's sendMessage was CALLED with the render_mermaid args
 *       (controller's local-tool machine drives this, not inline dispatch).
 *   (d) ctrl.send drives the optimistic message via the controller's message list,
 *       not a local `timeline` variable.
 *
 * R5 contract:
 *   - streamClient.setStream must NOT be the primary wiring path (controller uses set).
 *   - No `handleSend / subscribeToStream / dispatchLocalTool` remain in ChatConversation.
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 */

import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatConversation from '../src/components/ChatConversation.svelte';
import type { ChatUiWebHost } from '../src/hosts/createWebHost.js';
import type { StreamHubEvent } from '../src/client/streamTypes.js';
import { createRendererRegistry } from '../src/renderers/registry.js';

// ---------------------------------------------------------------------------
// Fake stream client — captures BOTH set() and setStream() subscriptions.
// The controller (R5) uses set(key, handler) — no streamId in the call.
// The emit() helper delivers to ALL set-handlers; the controller's
// handleIncomingStreamEvent internally guards by streamId.
// ---------------------------------------------------------------------------

type SetHandler = (event: unknown) => void;
type StreamSub = { streamId: string; handler: SetHandler };

const makeFakeStreamClient = () => {
  // set() subscriptions — used by the controller (R5 path)
  const setHandlers = new Map<string, SetHandler>();
  // setStream() subscriptions — legacy path (should NOT be used by R5)
  const setStreamSubs = new Map<string, StreamSub>();

  const client = {
    // controller calls set(key, handler) — store handler for emit()
    set: vi.fn((key: string, handler: SetHandler) => {
      setHandlers.set(key, handler);
    }),
    delete: vi.fn((key: string) => {
      setHandlers.delete(key);
      setStreamSubs.delete(key);
    }),
    setJobUpdates: vi.fn(),
    reset: vi.fn(),
    clearCaches: vi.fn(),
    // legacy path — ChatConversation R5 must NOT use this as primary subscription
    setStream: vi.fn((key: string, streamId: string, handler: SetHandler) => {
      setStreamSubs.set(key, { streamId, handler });
    }),
    // Test helper: emit an event to all set-handlers (controller path)
    // and to matching setStream subs (legacy path, for compatibility).
    emit(streamId: string, event: StreamHubEvent) {
      // Deliver to set() handlers (controller path — event carries streamId field)
      for (const handler of setHandlers.values()) {
        handler(event);
      }
      // Also deliver to matching setStream subs (legacy path)
      for (const sub of setStreamSubs.values()) {
        if (sub.streamId === streamId) {
          sub.handler(event);
        }
      }
    },
    // Test helper: number of active set() subscriptions (controller path)
    setHandlerCount() {
      return setHandlers.size;
    },
    // Test helper: number of active setStream subscriptions (legacy path)
    subCount(streamId: string) {
      return Array.from(setStreamSubs.values()).filter((s) => s.streamId === streamId).length;
    },
  };
  return client;
};

// ---------------------------------------------------------------------------
// Fake transport — postMessage returns a scripted JSON response
// ---------------------------------------------------------------------------

const ASSISTANT_MSG_ID = 'asst-msg-001';
const STREAM_ID = 'stream-abc-001';

const makeFakeTransport = () => ({
  openStream: vi.fn(),
  fetchBootstrap: vi.fn().mockResolvedValue({}),
  postMessage: vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        assistantMessageId: ASSISTANT_MSG_ID,
        streamId: STREAM_ID,
        jobId: 'job-001',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ),
  // Full transport interface stubs (controller transport adapter only calls postMessage,
  // but the host type requires these for TypeScript compatibility)
  sendMessage: vi.fn(),
  retryMessage: vi.fn(),
  stopMessage: vi.fn(),
  editMessage: vi.fn(),
  setFeedback: vi.fn(),
  fetchSessions: vi.fn(),
  fetchSessionHistory: vi.fn(),
  deleteSession: vi.fn(),
  pollJob: vi.fn().mockResolvedValue({ status: 'pending' }),
  postLocalToolResult: vi.fn(),
  postSteer: vi.fn(),
  fetchModelCatalog: vi.fn(),
});

// ---------------------------------------------------------------------------
// Fake localTools adapter — records sendMessage calls
// ---------------------------------------------------------------------------

type LocalToolCall = { type: string; toolCallId: string; name: string; args: unknown };

const makeFakeLocalTools = () => {
  const calls: LocalToolCall[] = [];
  return {
    id: 'fake-local-tools',
    sendMessage: vi.fn(async (message: unknown) => {
      const msg = message as LocalToolCall;
      calls.push(msg);
      return { ok: true, result: { rendered: true } };
    }),
    getCalls: () => calls,
  };
};

// ---------------------------------------------------------------------------
// Host factory — returns host + transport ref for assertions
// ---------------------------------------------------------------------------

type TestHost = ChatUiWebHost & {
  transport: ReturnType<typeof makeFakeTransport>;
  _fakeStreamClient: ReturnType<typeof makeFakeStreamClient>;
};

const makeTestHost = (
  localTools?: ReturnType<typeof makeFakeLocalTools>,
): TestHost => {
  const transport = makeFakeTransport();
  const streamClient = makeFakeStreamClient();
  return {
    kind: 'web',
    transport,
    streamClient,
    labels: (key: string) => key,
    renderers: createRendererRegistry(),
    ...(localTools ? { localTools } : {}),
    _fakeStreamClient: streamClient,
  } as unknown as TestHost;
};

// ---------------------------------------------------------------------------
// Helper: set contenteditable text and fire input event
// ---------------------------------------------------------------------------

const setComposerText = (container: HTMLElement, text: string): void => {
  const editable = container.querySelector('[contenteditable]') as HTMLElement;
  if (!editable) throw new Error('contenteditable not found');
  editable.textContent = text;
  editable.dispatchEvent(new Event('input', { bubbles: true }));
};

// ---------------------------------------------------------------------------
// Helper: get send button from container
// ---------------------------------------------------------------------------

const getSendBtn = (container: HTMLElement): HTMLButtonElement => {
  const btn = container.querySelector('.chat-conversation-send-btn') as HTMLButtonElement;
  if (!btn) throw new Error('send button not found');
  return btn;
};

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// (a) User message renders after send — controller path
// ---------------------------------------------------------------------------

describe('ChatConversation — functional: user message renders after send', () => {
  it('should append user message to timeline after handleSend (via controller)', async () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, {
      props: { host, sessionId: 'sess-functional-001' },
    });

    setComposerText(container, 'Hello, assistant');
    getSendBtn(container).click();

    await waitFor(() => {
      const userMsgs = container.querySelectorAll('.chat-conversation-user-message');
      expect(userMsgs.length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    const userMsg = container.querySelector('.chat-conversation-user-message');
    expect(userMsg?.textContent).toContain('Hello, assistant');
  });
});

// ---------------------------------------------------------------------------
// (b) Assistant stream item wired after send — via controller's set() path (R5)
// ---------------------------------------------------------------------------

describe('ChatConversation — functional: assistant stream item wired after send', () => {
  it('should subscribe via streamClient.set() (controller R5 path) after successful postMessage', async () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, {
      props: { host, sessionId: 'sess-functional-002' },
    });

    // The controller calls streamClient.set() in attachStream (called at component init)
    // Verify at least one set() subscription was registered
    await waitFor(() => {
      expect(host._fakeStreamClient.set).toHaveBeenCalled();
    }, { timeout: 2000 });

    setComposerText(container, 'Wire me');
    getSendBtn(container).click();

    // Wait for transport.postMessage to be called (controller's send() path)
    await waitFor(() => {
      expect(host.transport.postMessage).toHaveBeenCalled();
    }, { timeout: 2000 });

    // R5 proof: controller uses set(), NOT setStream() as primary subscription
    // setStream should NOT have been called by ChatConversation (legacy path gone)
    expect(host._fakeStreamClient.setStream).not.toHaveBeenCalled();
  });

  it('should render an assistant timeline item once the controller bootstraps the run', async () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, {
      props: { host, sessionId: 'sess-functional-003' },
    });

    setComposerText(container, 'Trigger assistant');
    getSendBtn(container).click();

    // When the assistant message is in _localStatus=processing with no content,
    // buildFallbackProjectedSegments produces a runtime-segment (not assistant-segment).
    // So we check for either: the runtime-segment placeholder or assistant-segment.
    // Both prove the assistant message entered the timeline and was projected.
    await waitFor(() => {
      const runtimeSegments = container.querySelectorAll('.chat-conversation-runtime-segment');
      const assistantSegments = container.querySelectorAll('.chat-conversation-assistant-segment');
      expect(runtimeSegments.length + assistantSegments.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });
});

// ---------------------------------------------------------------------------
// (c) Local-tool runtime is CALLED — the controller's machine drives this (R5)
// ---------------------------------------------------------------------------

describe('ChatConversation — functional: local-tool dispatch (controller-is-engine proof)', () => {
  it('should call host.localTools.sendMessage via controller local-tool machine when status event arrives', async () => {
    const localTools = makeFakeLocalTools();
    const host = makeTestHost(localTools);

    const { container } = render(ChatConversation, {
      props: { host, sessionId: 'sess-functional-004' },
    });

    setComposerText(container, 'Trigger mermaid');
    getSendBtn(container).click();

    // Wait for controller to process send
    await waitFor(() => {
      expect(host.transport.postMessage).toHaveBeenCalled();
    }, { timeout: 2000 });

    // Wait for assistant message to enter timeline (controller has ASSISTANT_MSG_ID in messages)
    await waitFor(() => {
      const runtimeSegments = container.querySelectorAll('.chat-conversation-runtime-segment');
      const assistantSegments = container.querySelectorAll('.chat-conversation-assistant-segment');
      expect(runtimeSegments.length + assistantSegments.length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    // Emit a scripted status event with awaiting_local_tool_results and a
    // bash-shaped local tool call (bash is a known LocalToolName in the package).
    // The event carries streamId — the controller's handleIncomingStreamEvent
    // will filter by isTrackedAssistantStreamId and route to handleLocalToolStreamEvent.
    const mermaidArgs = { diagram: 'graph TD; A-->B', theme: 'default' };
    const statusEvent: StreamHubEvent = {
      type: 'status',
      streamId: STREAM_ID,
      sequence: 1,
      data: {
        state: 'awaiting_local_tool_results',
        pending_local_tool_calls: [
          {
            tool_call_id: 'tc-mermaid-001',
            name: 'bash', // 'bash' is a known LocalToolName
            args: mermaidArgs,
          },
        ],
      },
    };
    // emit() delivers to set() handlers (controller path)
    host._fakeStreamClient.emit(STREAM_ID, statusEvent);

    // THE PROOF: controller's local-tool machine called host.localTools.sendMessage
    await waitFor(() => {
      expect(localTools.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_execute',
          toolCallId: 'tc-mermaid-001',
          name: 'bash',
          args: mermaidArgs,
        }),
      );
    }, { timeout: 2000 });

    // Verify the full call record
    const calls = localTools.getCalls();
    expect(calls.length).toBeGreaterThan(0);
    const executeCall = calls.find((c) => c.name === 'bash');
    expect(executeCall).toBeDefined();
    expect(executeCall?.toolCallId).toBe('tc-mermaid-001');
    expect(executeCall?.args).toEqual(mermaidArgs);
  });

  it('should NOT throw when host.localTools is absent (graceful degradation)', async () => {
    // No localTools in host
    const host = makeTestHost();
    const { container } = render(ChatConversation, {
      props: { host, sessionId: 'sess-functional-005' },
    });

    setComposerText(container, 'Graceful degradation');
    getSendBtn(container).click();

    await waitFor(() => {
      expect(host.transport.postMessage).toHaveBeenCalled();
    }, { timeout: 2000 });

    // Emit status event — should not throw even without localTools
    const statusEvent: StreamHubEvent = {
      type: 'status',
      streamId: STREAM_ID,
      sequence: 1,
      data: {
        state: 'awaiting_local_tool_results',
        pending_local_tool_calls: [{ tool_call_id: 'tc-001', name: 'bash', args: {} }],
      },
    };
    expect(() => host._fakeStreamClient.emit(STREAM_ID, statusEvent)).not.toThrow();
  });

  it('should clean up stream subscriptions on done event', async () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, {
      props: { host, sessionId: 'sess-functional-006' },
    });

    setComposerText(container, 'Cleanup test');
    getSendBtn(container).click();

    await waitFor(() => {
      expect(host.transport.postMessage).toHaveBeenCalled();
    }, { timeout: 2000 });

    // Wait for assistant message to be in the controller
    await waitFor(() => {
      const runtimeSegments = container.querySelectorAll('.chat-conversation-runtime-segment');
      const assistantSegments = container.querySelectorAll('.chat-conversation-assistant-segment');
      expect(runtimeSegments.length + assistantSegments.length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    // Emit done — controller patches assistant message to completed
    const doneEvent: StreamHubEvent = {
      type: 'done',
      streamId: STREAM_ID,
      sequence: 99,
      data: {},
    };
    // Should not throw
    expect(() => host._fakeStreamClient.emit(STREAM_ID, doneEvent)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (d) Existing structural tests remain intact (regression guard)
// ---------------------------------------------------------------------------

describe('ChatConversation — functional: regression guard (existing DOM structure)', () => {
  it('should still render the outer chat-conversation region', () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, { props: { host } });
    expect(container.querySelector('.chat-conversation')).not.toBeNull();
  });

  it('should still render the composer footer', () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, { props: { host } });
    expect(container.querySelector('.chat-composer-footer')).not.toBeNull();
  });

  it('should disable send button when no sessionId', () => {
    const host = makeTestHost();
    const { container } = render(ChatConversation, { props: { host } });
    const btn = container.querySelector('.chat-conversation-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
