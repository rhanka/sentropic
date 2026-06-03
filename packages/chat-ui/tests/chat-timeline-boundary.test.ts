import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const timelinePath = resolve(process.cwd(), 'src/components/ChatTimeline.svelte');

const readTimeline = (): string => readFileSync(timelinePath, 'utf8');

describe('ChatTimeline package boundary', () => {
  it('exists as a package-owned render component', () => {
    expect(existsSync(timelinePath)).toBe(true);
  });

  it('does not import app-owned modules or runtime singletons', () => {
    const source = readTimeline();
    expect(source).not.toContain('$lib/');
    expect(source).not.toContain("from 'svelte-i18n'");
    expect(source).not.toContain('apiFetch');
    expect(source).not.toContain('streamHub');
  });

  it('renders keyed projected timeline items through injected renderers', () => {
    const source = readTimeline();
    expect(source).toContain('export let items');
    expect(source).toContain('renderUserMessage');
    expect(source).toContain('renderMessageAttachments');
    expect(source).toContain('renderAssistantSegment');
    expect(source).toContain('renderRuntimeSegment');
    expect(source).toContain('{#each items as item (item.key)}');
  });
});
