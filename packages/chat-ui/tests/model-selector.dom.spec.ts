/**
 * model-selector.dom.spec.ts — DOM/ARIA tests for @sentropic/chat-ui ModelSelector.
 *
 * Tests the native <select> semantics: optgroups, provider::model composite value
 * binding, change event, and a11y (aria-label, keyboard).
 *
 * Environment: jsdom via vitest.config.ts (BR-A0b-EX1 target: test-chat-ui-dom).
 * Does NOT affect the existing node-env test-chat-ui target.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ModelSelector from '../src/components/ModelSelector.svelte';
import type { ModelCatalogGroup, ModelCatalogModel } from '../src/utils/model-selection.js';
import { groupModelsByProvider } from '../src/utils/model-selection.js';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROVIDERS = [
  { provider_id: 'openai' as const, label: 'OpenAI', status: 'ready' as const },
  { provider_id: 'anthropic' as const, label: 'Anthropic', status: 'ready' as const },
  { provider_id: 'gemini' as const, label: 'Gemini', status: 'planned' as const },
];

const MODELS: ModelCatalogModel[] = [
  { provider_id: 'openai', model_id: 'gpt-4o', label: 'GPT-4o', default_contexts: [] },
  { provider_id: 'openai', model_id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', default_contexts: [] },
  { provider_id: 'anthropic', model_id: 'claude-opus-4', label: 'Claude Opus 4', default_contexts: [] },
  { provider_id: 'gemini', model_id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', default_contexts: [] },
];

const GROUPS: ModelCatalogGroup[] = groupModelsByProvider(PROVIDERS, MODELS);

// ---------------------------------------------------------------------------
// Native <select> semantics
// ---------------------------------------------------------------------------

describe('ModelSelector — native <select> semantics', () => {
  it('should render a native <select> element (not a custom listbox)', () => {
    render(ModelSelector, { props: { value: '', groups: [], models: [], widthCh: 18 } });
    const select = screen.getByRole('combobox');
    expect(select.tagName.toLowerCase()).toBe('select');
  });

  it('should have id="chat-model-selection"', () => {
    const { container } = render(ModelSelector, {
      props: { value: 'openai::gpt-4o', groups: GROUPS, models: MODELS, widthCh: 18 },
    });
    const select = container.querySelector('#chat-model-selection');
    expect(select).not.toBeNull();
  });

  it('should render <optgroup> elements for each provider', () => {
    const { container } = render(ModelSelector, {
      props: { value: 'openai::gpt-4o', groups: GROUPS, models: MODELS, widthCh: 18 },
    });
    const optgroups = container.querySelectorAll('optgroup');
    expect(optgroups.length).toBe(3);
    expect(optgroups[0].getAttribute('label')).toBe('OpenAI');
    expect(optgroups[1].getAttribute('label')).toBe('Anthropic');
    // Gemini is 'planned' — providerGroupLabel appends status
    expect(optgroups[2].getAttribute('label')).toBe('Gemini (planned)');
  });

  it('should render <option> elements for each model inside the correct optgroup', () => {
    const { container } = render(ModelSelector, {
      props: { value: 'openai::gpt-4o', groups: GROUPS, models: MODELS, widthCh: 18 },
    });
    const openaiGroup = container.querySelector('optgroup[label="OpenAI"]');
    const options = openaiGroup?.querySelectorAll('option');
    expect(options?.length).toBe(2);

    // Option values must be 'provider::model' composite keys
    const values = Array.from(options ?? []).map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('openai::gpt-4o');
    expect(values).toContain('openai::gpt-4.1-nano');
  });

  it('should apply min-width style from widthCh prop', () => {
    const { container } = render(ModelSelector, {
      props: { value: '', groups: GROUPS, models: MODELS, widthCh: 24 },
    });
    const select = container.querySelector('#chat-model-selection') as HTMLSelectElement;
    expect(select?.style.minWidth).toBe('24ch');
  });
});

// ---------------------------------------------------------------------------
// Provider::model composite value binding
// ---------------------------------------------------------------------------

describe('ModelSelector — provider::model value binding', () => {
  it('should reflect the passed value prop as selected option value', () => {
    const { container } = render(ModelSelector, {
      props: { value: 'anthropic::claude-opus-4', groups: GROUPS, models: MODELS, widthCh: 18 },
    });
    const select = container.querySelector('#chat-model-selection') as HTMLSelectElement;
    expect(select?.value).toBe('anthropic::claude-opus-4');
  });

  it('should show fallback option when groups is empty and models has matching entry', () => {
    const { container } = render(ModelSelector, {
      props: { value: 'openai::gpt-4o', groups: [], models: MODELS, widthCh: 18 },
    });
    const options = container.querySelectorAll('option');
    // Only one fallback option rendered when groups is empty
    expect(options.length).toBe(1);
    expect((options[0] as HTMLOptionElement).value).toBe('openai::gpt-4o');
    expect(options[0].textContent).toBe('GPT-4o');
  });
});

// ---------------------------------------------------------------------------
// Change event
// ---------------------------------------------------------------------------

describe('ModelSelector — change event', () => {
  it('should call onChange with parsed { providerId, modelId } when selection changes', async () => {
    const onChange = vi.fn();
    const { container } = render(ModelSelector, {
      props: {
        value: 'openai::gpt-4o',
        groups: GROUPS,
        models: MODELS,
        widthCh: 18,
        onChange,
      },
    });
    const select = container.querySelector('#chat-model-selection') as HTMLSelectElement;
    // Simulate user picking anthropic::claude-opus-4
    await fireEvent.change(select, { target: { value: 'anthropic::claude-opus-4' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ providerId: 'anthropic', modelId: 'claude-opus-4' });
  });

  it('should NOT call onChange when the new value does not parse to a valid pair', async () => {
    const onChange = vi.fn();
    const { container } = render(ModelSelector, {
      props: {
        value: 'openai::gpt-4o',
        groups: GROUPS,
        models: MODELS,
        widthCh: 18,
        onChange,
      },
    });
    const select = container.querySelector('#chat-model-selection') as HTMLSelectElement;
    // Simulate an invalid selection (missing separator)
    await fireEvent.change(select, { target: { value: 'invalid-value' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ARIA / a11y
// ---------------------------------------------------------------------------

describe('ModelSelector — ARIA', () => {
  it('should expose the native select as role="combobox" (a11y tree)', () => {
    render(ModelSelector, { props: { value: '', groups: GROUPS, models: MODELS, widthCh: 18 } });
    // screen.getByRole throws if element not found — acts as assertion
    const el = screen.getByRole('combobox');
    expect(el).not.toBeNull();
  });

  it('should have aria-label set via the labels resolver', () => {
    render(ModelSelector, {
      props: {
        value: '',
        groups: [],
        models: [],
        widthCh: 18,
        labels: (_key: string) => 'Choose a model',
      },
    });
    // Named combobox should be accessible by its label
    const el = screen.getByRole('combobox', { name: 'Choose a model' });
    expect(el).not.toBeNull();
  });

  it('should fall back to the label key as aria-label when no resolver provided', () => {
    render(ModelSelector, { props: { value: '', groups: [], models: [], widthCh: 18 } });
    const el = screen.getByRole('combobox', { name: 'chat.model.selector.label' });
    expect(el).not.toBeNull();
  });

  it('should be keyboard-accessible as a native select (focus + aria-label)', () => {
    render(ModelSelector, {
      props: {
        value: 'openai::gpt-4o',
        groups: GROUPS,
        models: MODELS,
        widthCh: 18,
        labels: (_key: string) => 'Model',
      },
    });
    const select = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);
    // Verify the element is a native select — keyboard navigation provided by browser
    expect(select.tagName.toLowerCase()).toBe('select');
  });
});
