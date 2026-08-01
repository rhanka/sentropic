import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

describe('ChatWidget agents list wiring', () => {
  it('renders adapter rows as the default desktop conversations view', () => {
    expect(existsSync(widgetPath)).toBe(true);
    const source = readFileSync(widgetPath, 'utf8');

    expect(source).toContain(
      "import AgentsList from '@sentropic/chat-ui/components/AgentsList.svelte'",
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
    expect(source).toContain(
      "{#if canAgentsListBeDefaultView && agentsView === 'list'}",
    );
    expect(source).toContain('<AgentsList');
    expect(source).toContain('rows={agentsRows}');
    expect(source).toContain('onSelect={handleSelectAgentsEntry}');
    expect(source).toContain('onAction={handleAgentsAction}');
    expect(source).toContain('formatRelative={formatAgentsRelative}');
    expect(source).toContain('jobLabel: agentsJobLabel');
    expect(source).toContain('<IconButton');
    expect(source).toContain('aria-label={$_(\'chat.sessions.new\')}');
    expect(source).toContain('title={$_(\'chat.sessions.new\')}');
    expect(source).toContain('class="min-h-0 flex-1 overflow-y-auto p-3"');
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
    const listMountStart = source.indexOf(
      "{#if canAgentsListBeDefaultView && agentsView === 'list'}",
    );
    const listSectionStart = source.indexOf('<section', listMountStart);
    const listSectionEnd = source.indexOf('</section>', listSectionStart);
    const listMountEnd = source.indexOf('{/if}', listSectionEnd);
    const conversationStart = source.indexOf(
      '<div\n              class="h-full min-h-0 flex flex-col"',
      listMountEnd,
    );
    const viewsEnd = source.indexOf(
      '<div class="sr-only" aria-live="polite" aria-atomic="true">',
      conversationStart,
    );
    const listMount = source.slice(listMountStart, listMountEnd);
    const conversationLead = source.slice(
      listMountEnd + '{/if}'.length,
      conversationStart,
    );
    const views = source.slice(listMountStart, viewsEnd);

    expect(listMountStart).toBeGreaterThan(-1);
    expect(listSectionStart).toBeGreaterThan(listMountStart);
    expect(listSectionEnd).toBeGreaterThan(listSectionStart);
    expect(listMountEnd).toBeGreaterThan(listSectionEnd);
    expect(conversationStart).toBeGreaterThan(listMountEnd);
    expect(viewsEnd).toBeGreaterThan(conversationStart);
    expect(listMount).not.toContain("class:hidden={agentsView !== 'list'}");
    expect(listMount).toContain(
      "class:chat-agents-view-slide-from-inline-start={agentsView === 'list'}",
    );
    expect(conversationLead.trim()).toBe('');
    expect(views).toContain(
      "class:hidden={canAgentsListBeDefaultView && agentsView === 'list'}",
    );
    expect(views).toContain(
      "class:chat-agents-view-slide-from-inline-end={canAgentsListBeDefaultView && agentsView === 'conversation'}",
    );
    expect(views).toContain('bind:this={chatPanelRef}');
    expect(views).not.toContain('in:fly=');
    expect(views).not.toContain('out:fly=');
    expect(views).not.toContain('chat-agents-pager');
    expect(views).not.toContain('aria-hidden');
    expect(views).not.toContain('inert');

    expect(source).not.toContain("import { fly } from 'svelte/transition'");
    expect(source).toContain('@keyframes chat-agents-view-slide-from-inline-start');
    expect(source).toContain('@keyframes chat-agents-view-slide-from-inline-end');
    expect(source).toContain('inset-inline-start: -24px');
    expect(source).toContain('inset-inline-end: -24px');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('animation: none');
    expect(source).toContain('onBack={canAgentsListBeDefaultView ? returnToAgentsList : undefined}');
    expect(source).toContain("backLabel={$_('chat.agents.back')}");
    expect(source).toContain(
      'renderSessionsMenu={canAgentsListBeDefaultView ? undefined : renderChatSessionsMenu}',
    );
    expect(source).not.toContain('on:click={() => (agentsView = \'list\')}');
    expect(source).toContain('aria-live="polite"');
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
