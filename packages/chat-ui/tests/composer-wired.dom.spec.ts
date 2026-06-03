/**
 * composer-wired.dom.spec.ts — DOM tests for ChatComposer auto-grow (P6).
 *
 * Tests: render ChatComposer with autoGrow=false (default) and autoGrow=true;
 * verify that the default-off behavior is unchanged, that new props are
 * accepted, and that the data-auto-grow attribute is correctly set.
 *
 * Note on height growth assertions: jsdom does not implement layout (scrollHeight
 * always returns 0), so we cannot assert pixel growth from typing. Instead we
 * assert the structural contract:
 *  - data-auto-grow attribute reflects the prop
 *  - max-height style uses the maxHeight prop when autoGrow=false
 *  - max-height style uses the baseHeight when autoGrow=true and no content
 *
 * Environment: jsdom via vitest.dom.config.ts (test-chat-ui-dom target).
 * Does NOT affect the existing node-env test-chat-ui target.
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import ChatComposer from '../src/components/ChatComposer.svelte';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Minimal snippet stubs — @testing-library/svelte requires real Svelte snippets.
// We pass empty render functions via the props to avoid the "required snippet"
// runtime error without pulling in Svelte's snippet factory.
// ---------------------------------------------------------------------------

/**
 * Build the minimal props required by ChatComposer.
 * renderComposerSurface, renderFloatingLayer, renderLeftControls,
 * renderRightActions are required Snippet<[]> props — we pass no-op snippets.
 */
function makeRequiredSnippets() {
  // @testing-library/svelte 5 accepts snippets via the props object.
  // We pass undefined for non-required snippets and use the simplest possible
  // implementation: a function that renders nothing (returns void).
  const noop = () => undefined;
  return {
    renderComposerSurface: noop,
    renderFloatingLayer: noop,
    renderLeftControls: noop,
    renderRightActions: noop,
  };
}

// ---------------------------------------------------------------------------
// Default behavior (autoGrow=false) — existing API must be unchanged
// ---------------------------------------------------------------------------

describe('ChatComposer — default behavior (autoGrow=false)', () => {
  it('should render the composer footer', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets() },
    });
    expect(container.querySelector('.chat-composer-footer')).not.toBeNull();
  });

  it('should render the surface div with role=textbox', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets() },
    });
    const surface = container.querySelector('[role="textbox"]');
    expect(surface).not.toBeNull();
  });

  it('should apply the maxHeight prop as max-height style when autoGrow=false', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), maxHeight: 80, autoGrow: false },
    });
    const surface = container.querySelector('.chat-composer-surface') as HTMLElement | null;
    expect(surface).not.toBeNull();
    expect(surface?.style.maxHeight).toBe('80px');
  });

  it('should set data-auto-grow=false when autoGrow is not set (default)', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets() },
    });
    const surface = container.querySelector('.chat-composer-surface') as HTMLElement | null;
    // Default autoGrow=false → attribute should be the string "false"
    expect(surface?.dataset.autoGrow).toBe('false');
  });

  it('should expose data-empty-value=true when value is empty', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), value: '' },
    });
    const surface = container.querySelector('[data-empty-value]') as HTMLElement | null;
    expect(surface).not.toBeNull();
    expect(surface?.getAttribute('data-empty-value')).toBe('true');
  });

  it('should expose data-empty-value=false when value is non-empty', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), value: 'Hello' },
    });
    const surface = container.querySelector('[data-empty-value]') as HTMLElement | null;
    expect(surface?.getAttribute('data-empty-value')).toBe('false');
  });

  it('should apply data-mode attribute', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), mode: 'comments' },
    });
    const footer = container.querySelector('.chat-composer-footer') as HTMLElement | null;
    expect(footer?.getAttribute('data-mode')).toBe('comments');
  });
});

// ---------------------------------------------------------------------------
// P6 opt-in auto-grow behavior (autoGrow=true)
// ---------------------------------------------------------------------------

describe('ChatComposer — P6 auto-grow opt-in (autoGrow=true)', () => {
  it('should accept autoGrow=true without errors', () => {
    expect(() => {
      render(ChatComposer, {
        props: { ...makeRequiredSnippets(), autoGrow: true, baseHeight: 40 },
      });
    }).not.toThrow();
  });

  it('should set data-auto-grow=true when autoGrow is enabled', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), autoGrow: true },
    });
    const surface = container.querySelector('.chat-composer-surface') as HTMLElement | null;
    expect(surface?.dataset.autoGrow).toBe('true');
  });

  it('should use baseHeight as initial max-height when autoGrow=true and content is empty', () => {
    // jsdom does not implement scrollHeight (always 0), so the auto-grow logic
    // falls back to baseHeight.
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), autoGrow: true, baseHeight: 40 },
    });
    const surface = container.querySelector('.chat-composer-surface') as HTMLElement | null;
    // scrollHeight=0 in jsdom → computeAutosizeResult uses baseHeight as safeContent.
    // maxHeight = max(40, 40) = 40 when containerHeight=0.
    expect(surface?.style.maxHeight).toBe('40px');
  });

  it('should ignore the maxHeight prop and use autoGrow calculation when autoGrow=true', () => {
    const { container } = render(ChatComposer, {
      props: {
        ...makeRequiredSnippets(),
        autoGrow: true,
        baseHeight: 40,
        maxHeight: 999, // should be ignored when autoGrow=true
      },
    });
    const surface = container.querySelector('.chat-composer-surface') as HTMLElement | null;
    // In jsdom, scrollHeight=0 → autoGrowMaxHeight=40, not 999
    expect(surface?.style.maxHeight).not.toBe('999px');
  });

  it('should accept containerHeight prop without errors', () => {
    expect(() => {
      render(ChatComposer, {
        props: {
          ...makeRequiredSnippets(),
          autoGrow: true,
          baseHeight: 40,
          containerHeight: 600,
        },
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Existing prop API (regression: no removed props)
// ---------------------------------------------------------------------------

describe('ChatComposer — existing prop API intact', () => {
  it('should accept all original props without errors', () => {
    expect(() => {
      render(ChatComposer, {
        props: {
          ...makeRequiredSnippets(),
          mode: 'ai',
          value: 'test',
          disabled: false,
          isMultiline: false,
          maxHeight: 40,
          surfaceEnabled: true,
          surfaceDisabled: false,
          ariaLabel: 'Type here',
          tabIndex: 0,
        },
      });
    }).not.toThrow();
  });

  it('should set aria-label on the surface', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), ariaLabel: 'Message composer' },
    });
    const surface = container.querySelector('[role="textbox"]') as HTMLElement | null;
    expect(surface?.getAttribute('aria-label')).toBe('Message composer');
  });

  it('should set aria-disabled=true when disabled', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), disabled: true },
    });
    const surface = container.querySelector('[role="textbox"]') as HTMLElement | null;
    expect(surface?.getAttribute('aria-disabled')).toBe('true');
  });

  it('should apply composer-single-line class when isMultiline=false', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), isMultiline: false },
    });
    const surface = container.querySelector('.chat-composer-surface') as HTMLElement | null;
    expect(surface?.classList.contains('composer-single-line')).toBe(true);
  });

  it('should NOT apply composer-single-line class when isMultiline=true', () => {
    const { container } = render(ChatComposer, {
      props: { ...makeRequiredSnippets(), isMultiline: true },
    });
    const surface = container.querySelector('.chat-composer-surface') as HTMLElement | null;
    expect(surface?.classList.contains('composer-single-line')).toBe(false);
  });
});
