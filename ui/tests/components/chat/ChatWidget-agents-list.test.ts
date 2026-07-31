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
    expect(source).toContain(
      "import { projectAgentsFeed, queueJobsToAppJobs } from '$lib/chat/agents-feed-adapter'",
    );
    // Jobs MUST go through queueJobsToAppJobs so data.sessionId is lifted and the
    // D5 merge fires; passing $queueStore.jobs raw silently duplicates chat turns
    // (behaviourally covered in agents-feed-queue-jobs.test.ts).
    expect(source).toContain('jobs: queueJobsToAppJobs($queueStore.jobs)');
    expect(source).not.toContain('jobs: $queueStore.jobs })');
    expect(source).toContain('buildAgentsListRows(');
    expect(source).toContain("let agentsView: 'list' | 'conversation' = 'list';");
    expect(source).toContain("{#if canAgentsListBeDefaultView && agentsView === 'list'}");
    expect(source).toContain('<AgentsList');
    expect(source).toContain('rows={agentsRows}');
    expect(source).toContain('onSelect={handleSelectAgentsEntry}');
    expect(source).toContain('onAction={handleAgentsAction}');
    expect(source).toContain('formatRelative={formatAgentsRelative}');
    expect(source).toContain('disabled');
  });
});
