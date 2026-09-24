import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

/** Domain panels stay host-owned; the package owns their routing. */
describe('ChatWidget content panel host snippets (L-C-shell S3)', () => {
  it('exists', () => {
    expect(existsSync(widgetPath)).toBe(true);
  });

  it('passes jobs/comments/chat panels as package slots', () => {
    const source = readFileSync(widgetPath, 'utf8');
    for (const name of ['renderJobsPanelHost', 'renderCommentsPanelHost', 'renderChatBodyHost']) {
      expect(source).toContain(`{#snippet ${name}()}`);
      const slot = name === 'renderChatBodyHost' ? 'renderChatPanel' : name.replace('Host', '');
      expect(source).toContain(`${slot}={${name}}`);
    }
  });

  it('keeps QueueMonitor inside the app jobs snippet (package boundary forbids importing it)', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('<QueueMonitor />');
  });
});
