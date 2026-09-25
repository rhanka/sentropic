import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/components/ChatWidget.svelte');

const readWidget = (): string => readFileSync(widgetPath, 'utf8');

describe('ChatWidget package boundary', () => {
  it('removes widget takeover from implementation, declarations and manifest', () => {
    for (const file of ['src/components/ChatWidget.svelte', 'src/components/ChatWidget.svelte.d.ts']) {
      expect(readFileSync(resolve(process.cwd(), file), 'utf8')).not.toContain('renderShell');
    }
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'export-manifest.json'), 'utf8'));
    expect(manifest.subpaths['./components/ChatWidget.svelte']._propSnapshot).not.toContain('renderShell');
    expect(readFileSync(resolve(process.cwd(), 'src/components/ChatPanel.svelte'), 'utf8')).toContain('renderShell');
    const source = readWidget();
    expect(source).toContain('<ChatWidgetPager');
    expect(source).toContain('<ChatWidgetTabBar');
    expect(source).toContain('class:hidden={!panelVisibility.showChatPanel}');
    expect(source).toContain('renderContentGate(renderReady)');
    expect(source).not.toContain('overflow-hidden');
  });

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
