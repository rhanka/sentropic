import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

/**
 * L-C-shell S3 (app side): the gate-ready content branch's three panels (jobs, comments, chat)
 * are wrapped in host snippets and rendered IN PLACE, ready to be handed to the package's
 * renderJobsPanel/renderCommentsPanel/renderChatPanel slots at S8. QueueMonitor stays inside the
 * jobs snippet (app-only — the package boundary test forbids importing it). No visible change (I4),
 * no rename (L-A').
 */
describe('ChatWidget content panel host snippets (L-C-shell S3)', () => {
  it('exists', () => {
    expect(existsSync(widgetPath)).toBe(true);
  });

  it('wraps jobs/comments/chat panels in host snippets, rendered in place', () => {
    const source = readFileSync(widgetPath, 'utf8');
    for (const name of ['renderJobsPanelHost', 'renderCommentsPanelHost', 'renderChatPanelHost']) {
      expect(source).toContain(`{#snippet ${name}()}`);
      expect(source).toContain(`{@render ${name}()}`);
    }
  });

  it('keeps QueueMonitor inside the app jobs snippet (package boundary forbids importing it)', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('<QueueMonitor />');
  });
});
