import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pagerSource = readFileSync(resolve(process.cwd(), '../packages/chat-ui/src/components/ChatWidgetPager.svelte'), 'utf8');
const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

describe('ChatWidget agents list wiring', () => {
  it('renders adapter rows as the default desktop conversations view', () => {
    expect(existsSync(widgetPath)).toBe(true);
    const source = readFileSync(widgetPath, 'utf8');

    expect(source).toContain(
      "import PackageChatWidget from '@sentropic/chat-ui/components/ChatWidget.svelte'",
    );
    expect(source).toContain("import { IconButton, Toggle } from '@sentropic/design-system-svelte'");
    expect(source).toContain("from '$lib/chat/agents-feed-adapter'");
    expect(source).toContain('projectAgentsFeed,');
    expect(source).toContain('queueJobsToAppJobs,');
    // Jobs MUST go through queueJobsToAppJobs so data.sessionId is lifted and the
    // D5 merge fires; passing $queueStore.jobs raw silently duplicates chat turns
    // (behaviourally covered in agents-feed-queue-jobs.test.ts).
    expect(source).toContain('jobs: queueJobsToAppJobs($queueStore.jobs)');
    expect(source).not.toContain('jobs: $queueStore.jobs })');
    expect(source).toContain('buildAgentsListRows(');
    // Option 3 (owner 2026-07-30): default to conversation, land on the list
    // only when there are sessions to choose from but none is active. A derived
    // value would fight the back button, so the default is set on the open edge.
    expect(source).toContain("let agentsView: 'list' | 'conversation' = 'conversation';");
    expect(source).toContain(
      "chatSessionId != null || chatSessions.length === 0 ? 'conversation' : 'list'",
    );
    expect(pagerSource).toContain("{#if canAgentsListBeDefaultView && agentsView === 'list'}");
    expect(source).toContain('<PackageChatWidget');
    expect(source).toContain('rows: agentsRows');
    expect(source).toContain('onSelect: handleSelectAgentsEntry');
    expect(source).toContain('onAction: handleAgentsAction');
    expect(source).toContain('formatRelative: formatAgentsRelative');
    expect(source).toContain('jobLabel: agentsJobLabel');
    expect(source).toContain('<IconButton');
    expect(source).toContain('aria-label={$_(\'chat.sessions.new\')}');
    expect(source).toContain('title={$_(\'chat.sessions.new\')}');
    expect(pagerSource).toContain('class="min-h-0 flex-1 overflow-y-auto p-3"');
    expect(source).toContain('disabled');
  });

  it('loads the all-workspaces session scope through the DS toggle', () => {
    const source = readFileSync(widgetPath, 'utf8');

    expect(source).toContain(
      "import { IconButton, Toggle } from '@sentropic/design-system-svelte'",
    );
    expect(source).toContain('let showAllWorkspaceSessions = false;');
    expect(source).toContain("allWorkspaces ? '/chat/sessions?scope=all' : '/chat/sessions'");
    expect(source).toContain('const handleAllWorkspaceScopeChange');
    expect(source).toContain('<Toggle');
    expect(source).toContain("label={$_('chat.agents.scope.allWorkspaces')}");
    expect(source).toContain('onchange={handleAllWorkspaceScopeChange}');
    expect(source).toContain('workspaceLabelsById: showAllWorkspaceSessions');
    expect(source).not.toContain('Interim: no toggle');
    expect(source).not.toContain('dedicated branch, architect-co-signed');
  });

  it('remounts the list while keeping the conversation mounted with CSS motion', () => {
    const source = readFileSync(widgetPath, 'utf8');
    const listMountStart = pagerSource.indexOf(
      "{#if canAgentsListBeDefaultView && agentsView === 'list'}",
    );
    const listSectionStart = pagerSource.indexOf('<section', listMountStart);
    const listSectionEnd = pagerSource.indexOf('</section>', listSectionStart);
    const listMountEnd = pagerSource.indexOf('{/if}', listSectionEnd);
    const conversationStart = pagerSource.indexOf(
      '<div\n  class="h-full min-h-0 flex flex-col"',
      listMountEnd,
    );
    const viewsEnd = pagerSource.indexOf(
      '<div class="sr-only" aria-live="polite" aria-atomic="true">',
      conversationStart,
    );
    const listMount = pagerSource.slice(listMountStart, listMountEnd);
    const conversationLead = pagerSource.slice(
      listMountEnd + '{/if}'.length,
      conversationStart,
    );
    const views = pagerSource.slice(listMountStart, viewsEnd);

    expect(listMountStart).toBeGreaterThan(-1);
    expect(listSectionStart).toBeGreaterThan(listMountStart);
    expect(listSectionEnd).toBeGreaterThan(listSectionStart);
    expect(listMountEnd).toBeGreaterThan(listSectionEnd);
    expect(conversationStart).toBeGreaterThan(listMountEnd);
    expect(viewsEnd).toBeGreaterThan(conversationStart);
    expect(listMount).not.toContain("class:hidden={agentsView !== 'list'}");
    expect(listMount).toContain(
      'chat-agents-view-slide-from-inline-start',
    );
    expect(conversationLead.trim()).toBe('');
    expect(views).toContain(
      "class:hidden={canAgentsListBeDefaultView && agentsView === 'list'}",
    );
    expect(views).toContain(
      "class:chat-agents-view-slide-from-inline-end={canAgentsListBeDefaultView && agentsView === 'conversation'}",
    );
    expect(source).toContain('bind:this={chatPanelRef}');
    expect(source).toContain('renderChatPanel={renderChatBodyHost}');
    expect(pagerSource).toContain('{@render renderChatPanel()}');
    expect(views).not.toContain('in:fly=');
    expect(views).not.toContain('out:fly=');
    expect(views).not.toContain('chat-agents-pager');
    expect(views).not.toContain('aria-hidden');
    expect(views).not.toContain('inert');

    expect(source).not.toContain("import { fly } from 'svelte/transition'");
    expect(pagerSource).toContain('@keyframes chat-agents-view-slide-from-inline-start');
    expect(pagerSource).toContain('@keyframes chat-agents-view-slide-from-inline-end');
    expect(pagerSource).toContain('inset-inline-start: -24px');
    expect(pagerSource).toContain('inset-inline-end: -24px');
    expect(pagerSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(pagerSource).toContain('animation: none');
    expect(source).toContain('onBack={canAgentsListBeDefaultView ? returnToAgentsList : undefined}');
    expect(source).toContain("backLabel={$_('chat.agents.back')}");
    expect(source).toContain(
      'renderSessionsMenu={canAgentsListBeDefaultView ? undefined : renderChatSessionsMenu}',
    );
    expect(source).not.toContain('on:click={() => (agentsView = \'list\')}');
    expect(pagerSource).toContain('aria-live="polite"');
    expect(source).toContain('focusConversationHeading');
    expect(source).toContain('focusAgentsListRow');

    const selectHandler = source.slice(
      source.indexOf('const handleSelectAgentsEntry'),
      source.indexOf('const handleAgentsAction'),
    );
    const actionHandler = source.slice(
      source.indexOf('const handleAgentsAction'),
      source.indexOf('const onJobUpdate'),
    );
    expect(selectHandler).toContain('await handleSelectSession(entryId);');
    expect(selectHandler).not.toContain('await tick();');
    expect(actionHandler).toContain('await handleSelectSession(entryId);');
    expect(actionHandler).not.toContain('await tick();');
  });
});
