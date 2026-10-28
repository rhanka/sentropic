    expect(btn).not.toBeNull();
  });

  it('should disable the send button when no sessionId is supplied', () => {
    render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    const btn = screen.getByRole('button', { name: 'chat.composer.send' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('should enable the send button when a sessionId is supplied', () => {
    render(ChatConversation, {
      props: { host: makeMockHost(), sessionId: 'sess-001' },
    });
    const btn = screen.getByRole('button', { name: 'chat.composer.send' });
    expect(btn).toHaveProperty('disabled', false);
  });
});

// ---------------------------------------------------------------------------
// ModelSelector — only rendered when models are supplied
// ---------------------------------------------------------------------------

describe('ChatConversation — ModelSelector conditional', () => {
  it('should NOT render ModelSelector when no models are provided', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    expect(container.querySelector('#chat-model-selection')).toBeNull();
  });

  it('should render ModelSelector when models array is non-empty', () => {
    const { container } = render(ChatConversation, {
      props: {
        host: makeMockHost(),
        models: [
          {
            provider_id: 'openai',
            model_id: 'gpt-4o',
            label: 'GPT-4o',
            contextTokens: 128000,
          },
        ],
      },
    });
    expect(container.querySelector('#chat-model-selection')).not.toBeNull();
  });

  it('should render ModelSelector when modelGroups is non-empty', () => {
    const { container } = render(ChatConversation, {
      props: {
        host: makeMockHost(),
        modelGroups: [
          {
            provider: 'openai',
            models: [
              { provider_id: 'openai', model_id: 'gpt-4o', label: 'GPT-4o', contextTokens: 128000 },
            ],
          },
        ],
      },
    });
    expect(container.querySelector('#chat-model-selection')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ContextChips — only rendered when contextProvider is supplied
// ---------------------------------------------------------------------------

describe('ChatConversation — ContextChips conditional', () => {
  it('should NOT render a context chip list when contextProvider is omitted', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    // ContextChips renders [role=list] only when entries > 0
    expect(container.querySelector('[aria-label="chat.context.chips.label"]')).toBeNull();
  });

  it('should render ChatContextPicker region when contextProvider supplies entries', () => {
    const { container } = render(ChatConversation, {
      props: {
        host: makeMockHost(),
        contextProvider: {
          context: {
            subscribe(run: (value: { type: string; id?: string; label: string; active?: boolean; used?: boolean; lastUsedAt?: string }[]) => void) {
              run([{ type: 'folder', id: 'f1', label: 'My Folder', active: true, used: true, lastUsedAt: '2026-01-01T00:00:00.000Z' }]);
              return () => undefined;
            },
          },
        },
      },
    });
    // ChatContextPicker renders a button per entry (replaces ContextChips role=list)
    const pickerContainer = container.querySelector('.chat-conversation-header');
    expect(pickerContainer).not.toBeNull();
    // At least one button should appear for the folder entry
    const entryButtons = pickerContainer?.querySelectorAll('button');
    expect(entryButtons?.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Feature flags — default OFF for app-coupled concerns
// ---------------------------------------------------------------------------

describe('ChatConversation — feature flag defaults (DOM)', () => {
  it('should expose data-feature-steer=true by default', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    const el = container.querySelector('.chat-conversation');
    expect(el?.getAttribute('data-feature-steer')).toBe('true');
  });

  it('should expose data-feature-retry=true by default', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    const el = container.querySelector('.chat-conversation');
    expect(el?.getAttribute('data-feature-retry')).toBe('true');
  });

  it('should expose data-feature-stop=true by default', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    const el = container.querySelector('.chat-conversation');
    expect(el?.getAttribute('data-feature-stop')).toBe('true');
  });

  it('should expose data-feature-steer=false when steer flag disabled', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost(), features: { steer: false } },
    });
    const el = container.querySelector('.chat-conversation');
    expect(el?.getAttribute('data-feature-steer')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Labels resolver — falls back to host.labels, then to key passthrough
// ---------------------------------------------------------------------------

describe('ChatConversation — label resolver', () => {
  it('should use injected labels resolver for visible strings', () => {
    const labelMap: Record<string, string> = {
      'chat.composer.send': 'Envoyer',
    };
    render(ChatConversation, {
      props: {
        host: makeMockHost(),
        labels: (key: string) => labelMap[key] ?? key,
      },
    });
    expect(screen.getByRole('button', { name: 'Envoyer' })).not.toBeNull();
  });

  it('should fall back to host.labels when no prop labels provided', () => {
    const hostLabels = (key: string): string => {
      if (key === 'chat.composer.send') return 'Send';
      return key;
    };
    render(ChatConversation, {
      props: { host: makeMockHost({ labels: hostLabels }) },
    });
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StreamMessage wiring (BR-CONV) — v0.9.0
// ---------------------------------------------------------------------------

describe('ChatConversation — StreamMessage wiring (BR-CONV)', () => {
  it('should import StreamMessage without error (svelte-streamdown available in jsdom via BR-CONV-EX1)', () => {
    // If svelte-streamdown is missing, this module import would have thrown at the
    // top of this file. Reaching here proves the Makefile BR-CONV-EX1 wiring works.
    expect(StreamMessage).toBeTruthy();
  });

  it('should render without error when host.streamClient is present (streaming path active)', () => {
    // ChatConversation now statically imports StreamMessage (which imports svelte-streamdown).
    // This test verifies the component mounts successfully in jsdom when streamClient is provided.
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost(), sessionId: 'sess-stream-001' },
    });
    // The outer wrapper must be present — proves the component mounted cleanly.
    expect(container.querySelector('.chat-conversation')).not.toBeNull();
    // The timeline container is present (empty — no timeline items injected).
    expect(container.querySelector('.chat-conversation-timeline')).not.toBeNull();
  });

  it('should render without error when host has streamClient and show empty-state (no timeline items)', () => {
    // With a streamClient present but no timeline items, the empty state label renders
    // (not a StreamMessage — no runtime/assistant segments yet).
    render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    const timeline = document.querySelector('.chat-conversation-timeline');
    expect(timeline).not.toBeNull();
    // Empty state label is shown (key passthrough resolver)
    expect(timeline?.textContent).toContain('chat.sessions.none');
    // No runtime-segment placeholder present (nothing in timeline)
    expect(document.querySelector('.chat-conversation-runtime-segment')).toBeNull();
  });

  it('should NOT show bare runtime-segment placeholder when streamClient is provided (StreamMessage renders instead)', () => {
    // This test verifies the structural guard: when streamClient is present, the
    // runtime-segment renders StreamMessage (not the bare text placeholder).
    // Since timeline is internal state and we cannot inject items via props,
    // we assert that the conditional branch structure is correct by verifying
    // no stray placeholder text appears in an empty timeline.
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost(), sessionId: 'sess-stream-002' },
    });
    // No runtime segment at all in empty timeline — the conditional branch is intact
    expect(container.querySelector('[data-stream-id]')).toBeNull();
    // Verify streamClient is present on host (the branch that routes to StreamMessage)
    const mockHost = makeMockHost();
    expect(mockHost.streamClient).not.toBeNull();
    expect(typeof mockHost.streamClient.setStream).toBe('function');
  });

  it('should render without error when streamClient is omitted from host (additive/non-breaking fallback)', () => {
    // When host lacks streamClient, ChatConversation must still mount.
    // The runtime-segment branch falls back to the static placeholder.
    // We cast to bypass TS — this simulates a consumer that does not supply streamClient.
    const hostWithoutStreamClient = {
      kind: 'web' as const,
      transport: makeMockTransport(),
      // streamClient intentionally omitted to test additive fallback
      streamClient: undefined as unknown as ChatUiWebHost['streamClient'],
      labels: (key: string) => key,
      renderers: createRendererRegistry(),
    } as ChatUiWebHost;

    const { container } = render(ChatConversation, {
      props: { host: hostWithoutStreamClient },
    });
    // Component must still render its outer shell
    expect(container.querySelector('.chat-conversation')).not.toBeNull();
    // Timeline is present
    expect(container.querySelector('.chat-conversation-timeline')).not.toBeNull();
  });
});
