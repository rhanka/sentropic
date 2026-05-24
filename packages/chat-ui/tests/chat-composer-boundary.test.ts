import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const composerPath = resolve(process.cwd(), 'src/components/ChatComposer.svelte');

const readComposer = (): string => readFileSync(composerPath, 'utf8');

describe('ChatComposer package boundary', () => {
  it('exists as a package-owned composer shell', () => {
    expect(existsSync(composerPath)).toBe(true);
  });

  it('does not import app-owned modules or side-effect stores', () => {
    const source = readComposer();
    expect(source).not.toContain('$lib/');
    expect(source).not.toContain("from 'svelte-i18n'");
    expect(source).not.toContain('apiFetch');
    expect(source).not.toContain('streamHub');
  });

  it('exposes shell props and snippets for app-owned composer content', () => {
    const source = readComposer();
    expect(source).toContain('export let mode');
    expect(source).toContain('export let value');
    expect(source).toContain('export let disabled');
    expect(source).toContain('renderComposerSurface');
    expect(source).toContain('renderFloatingLayer');
    expect(source).toContain('renderAttachmentTray');
    expect(source).toContain('renderLeftControls');
    expect(source).toContain('renderRightActions');
  });
});
