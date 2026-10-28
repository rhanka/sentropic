import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import { createConversationFixture } from '../../chat-runtime/tests/fixtures/conversationHost.js';
import ConversationView from './fixtures/ConversationViewHarness.svelte';

const fixtures: Awaited<ReturnType<typeof createConversationFixture>>[] = [];
afterEach(() => { cleanup(); for (const fixture of fixtures.splice(0)) fixture.dispose(); });
async function fixture(options: Parameters<typeof createConversationFixture>[0] = {}) {
  const host = await createConversationFixture(options); fixtures.push(host); return host;
}

it.each(['inline', 'docked', 'floating'] as const)('should preserve the %s layout, region, timeline and composer', async (layout) => {
  const host = await fixture();
  const view = render(ConversationView, { runtime: host.runtime, layout });
  expect(view.getByRole('region', { name: 'chat.panel.label' })).toBeTruthy();
  expect(view.container.querySelector('.chat-conversation')?.getAttribute('data-layout')).toBe(layout);
  expect(view.container.querySelector('.chat-conversation-timeline')?.textContent).toContain('chat.sessions.none');
  expect(view.container.querySelector('.chat-composer-footer')).toBeTruthy();
  expect(view.getByRole('textbox', { name: 'chat.composer.placeholder.chat' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'chat.composer.send' })).toHaveProperty('disabled', false);
});

it('should render catalog and context controls from the injected snapshot', async () => {
  const host = await fixture({ contextProvider: { context: { subscribe(run) {
    run([{ type: 'folder', id: 'f1', label: 'My folder', active: true }]); return () => {};
  } } } });
  const view = render(ConversationView, { runtime: host.runtime });
  expect(view.getByRole('combobox')).toBeTruthy();
  expect(view.container.querySelector('.chat-conversation-header')?.textContent).toContain('My folder');
});

it('should preserve feature defaults and render optional modules only when enabled', async () => {
  const host = await fixture();
  const view = render(ConversationView, { runtime: host.runtime });
  const region = view.container.querySelector('.chat-conversation')!;
  for (const flag of ['steer', 'retry', 'stop']) expect(region.getAttribute(`data-feature-${flag}`)).toBe('true');
  expect(view.queryByText('Comments module')).toBeNull();
  expect(view.queryByText('Documents module')).toBeNull();
  expect(view.queryByText('Jobs module')).toBeNull();
  expect(view.queryByText('Workspace scope module')).toBeNull();
  await view.rerender({ runtime: host.runtime, features: {
    comments: true, documents: true, jobs: true, workspaceScope: true, steer: false,
  } });
  for (const label of ['Comments module', 'Documents module', 'Jobs module', 'Workspace scope module']) {
    expect(view.getByText(label)).toBeTruthy();
  }
  expect(region.getAttribute('data-feature-steer')).toBe('false');
});

it('should use the injected label resolver', async () => {
  const host = await fixture();
  const view = render(ConversationView, { runtime: host.runtime,
    labels: (key) => key === 'chat.composer.send' ? 'Send message' : key });
  expect(view.getByRole('button', { name: 'Send message' })).toBeTruthy();
});
