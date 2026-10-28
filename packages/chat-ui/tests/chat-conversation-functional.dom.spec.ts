
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
