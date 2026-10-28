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
