import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/components/ChatWidget.svelte');

const readWidget = (): string => readFileSync(widgetPath, 'utf8');

describe('ChatWidget package boundary', () => {
  it('exists as a package-owned launcher and panel shell', () => {
    expect(existsSync(widgetPath)).toBe(true);
  });

  it('does not import app-owned queue, API, or i18n modules', () => {
    const source = readWidget();
    expect(source).not.toContain('$lib/');
    expect(source).not.toContain('QueueMonitor');
    expect(source).not.toContain("from 'svelte-i18n'");
    expect(source).not.toContain("apiPost('/queue");
    expect(source).not.toContain('/queue/purge-mine');
  });

  it('exposes injected jobs, comments, chat panels, badges, and queue callbacks', () => {
    const source = readWidget();
    expect(source).toContain('export let activeTab');
    expect(source).toContain('export let activeJobsCount');
    expect(source).toContain('export let failedJobsCount');
    expect(source).toContain('export let queueTabLabel');
    expect(source).toContain('export let onPurgeJobs');
    expect(source).toContain('renderJobsPanel');
    expect(source).toContain('renderCommentsPanel');
    expect(source).toContain('renderChatPanel');
  });
});
