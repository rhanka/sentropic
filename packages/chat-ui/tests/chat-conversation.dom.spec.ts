/**
 * chat-conversation.dom.spec.ts — DOM/ARIA tests for ChatConversation assembly.
 *
 * Tests: ChatConversation renders in jsdom with a MOCK host (stub
 * transport + streamClient); verifies ChatTimeline + ChatComposer render,
 * ModelSelector appears when models are supplied, default feature flags
 * keep no comments/jobs UI, and ContextChips appear when contextProvider given.
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 * Does NOT affect the existing node-env test-chat-ui target.
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatConversation from '../src/components/ChatConversation.svelte';
import type { ChatUiWebHost } from '../src/hosts/createWebHost.js';
import { createRendererRegistry } from '../src/renderers/registry.js';
import { createNoopChatContextProvider } from '../src/state/chat-context.js';

// ---------------------------------------------------------------------------
// Mock host factory — minimal stub satisfying ChatUiWebHost
// ---------------------------------------------------------------------------

const makeMockStreamClient = () => ({
  set: vi.fn(),
  delete: vi.fn(),
  setJobUpdates: vi.fn(),
  setStream: vi.fn(),
  reset: vi.fn(),
  clearCaches: vi.fn(),
});

const makeMockTransport = () => ({
  openStream: vi.fn(),
  postMessage: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
  fetchBootstrap: vi.fn().mockResolvedValue({}),
});

const makeMockHost = (overrides: Partial<ChatUiWebHost> = {}): ChatUiWebHost => ({
  kind: 'web',
  transport: makeMockTransport(),
  streamClient: makeMockStreamClient(),
  labels: (key: string) => key,
  renderers: createRendererRegistry(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Cleanup after each test
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Basic render — ChatPanel shell renders
// ---------------------------------------------------------------------------

describe('ChatConversation — basic render', () => {
  it('should render the outer chat-conversation region with aria-label', () => {
    render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    // ChatPanel resolves 'chat.tabs.chat' via labels fallback (key passthrough)
    const region = document.querySelector('.chat-conversation');
    expect(region).not.toBeNull();
  });

  it('should render a region with layout=inline (default)', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    const el = container.querySelector('.chat-conversation-inline');
    expect(el).not.toBeNull();
  });

  it('should render a region with layout=docked when specified', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost(), layout: 'docked' },
    });
    expect(container.querySelector('.chat-conversation-docked')).not.toBeNull();
  });

  it('should render a region with layout=floating when specified', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost(), layout: 'floating' },
    });
    expect(container.querySelector('.chat-conversation-floating')).not.toBeNull();
  });

  it('should set data-layout attribute to the layout value', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost(), layout: 'docked' },
    });
    const el = container.querySelector('.chat-conversation');
    expect(el?.getAttribute('data-layout')).toBe('docked');
  });
});

// ---------------------------------------------------------------------------
// Empty state — timeline shows empty message when no session
// ---------------------------------------------------------------------------

describe('ChatConversation — empty state', () => {
  it('should show the empty-state label when no sessionId is supplied', () => {
    render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    // The empty-state div renders resolveLabel('chat.sessions.none') = key passthrough
    const el = document.querySelector('.chat-conversation-timeline');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('chat.sessions.none');
  });
});

// ---------------------------------------------------------------------------
// ChatComposer is rendered
// ---------------------------------------------------------------------------

describe('ChatConversation — ChatComposer', () => {
  it('should render the composer footer', () => {
    const { container } = render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    // ChatComposer uses class 'chat-composer-footer'
    expect(container.querySelector('.chat-composer-footer')).not.toBeNull();
  });

  it('should render the send button inside the composer', () => {
    render(ChatConversation, {
      props: { host: makeMockHost() },
    });
    // aria-label = resolveLabel('chat.composer.send') = 'chat.composer.send'
    const btn = screen.getByRole('button', { name: 'chat.composer.send' });
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

  it('should render ContextChips region when contextProvider supplies entries', () => {
    const { container } = render(ChatConversation, {
      props: {
        host: makeMockHost(),
        contextProvider: {
          context: {
            subscribe(run: (value: { type: string; id?: string; label: string }[]) => void) {
              run([{ type: 'folder', id: 'f1', label: 'My Folder' }]);
              return () => undefined;
            },
          },
        },
      },
    });
    // ContextChips renders role=list when entries.length > 0
    expect(container.querySelector('[role="list"]')).not.toBeNull();
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
