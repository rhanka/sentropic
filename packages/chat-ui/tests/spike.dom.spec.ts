/**
 * spike.dom.spec.ts — Minimal jsdom spike for @sentropic/chat-ui Svelte 5 components.
 *
 * Proves that a Svelte 5 component renders in vitest+jsdom via @testing-library/svelte@5.
 * This is the A0b feasibility spike; if GREEN, the full harness is viable.
 */
import { render, screen, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

// Import the simplest component that has no icon peer-deps.
import ModelSelector from '../src/components/ModelSelector.svelte';

afterEach(() => cleanup());

describe('jsdom spike — ModelSelector renders', () => {
  it('should render a <select> element with id="chat-model-selection"', () => {
    const { container } = render(ModelSelector, {
      props: {
        value: '',
        groups: [],
        models: [],
        widthCh: 18,
      },
    });
    const select = container.querySelector('#chat-model-selection');
    expect(select).not.toBeNull();
    expect(select?.tagName.toLowerCase()).toBe('select');
  });

  it('should expose the select via ARIA role combobox', () => {
    render(ModelSelector, {
      props: { value: '', groups: [], models: [], widthCh: 18 },
    });
    // Native <select> is a combobox in ARIA
    const select = screen.getByRole('combobox');
    expect(select).not.toBeNull();
    expect(select.tagName.toLowerCase()).toBe('select');
  });

  it('should set aria-label on the <select> (fallback: key when no resolver)', () => {
    render(ModelSelector, {
      props: { value: '', groups: [], models: [], widthCh: 18 },
    });
    // Native <select> with aria-label renders as a named combobox
    const select = screen.getByRole('combobox', { name: 'chat.model.selector.label' });
    expect(select).not.toBeNull();
    expect(select.tagName.toLowerCase()).toBe('select');
  });
});
