/**
 * BR14a Lot 10 - StreamMessage package boundary tests.
 *
 * The package component must be usable without Sentropic app imports.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const streamMessagePath = resolve(
  process.cwd(),
  'src/components/StreamMessage.svelte',
);

const readComponent = (): string => readFileSync(streamMessagePath, 'utf8');

describe('StreamMessage package boundary', () => {
  it('does not import app-owned $lib modules', () => {
    const source = readComponent();
    expect(source).not.toContain('$lib/');
    expect(source).not.toContain("from 'svelte-i18n'");
  });

  it('uses an injected streamClient instead of the app streamHub singleton', () => {
    const source = readComponent();
    expect(source).not.toContain("from '$lib/stores/streamHub'");
    expect(source).toContain('export let streamClient');
    expect(source).toContain('streamClient.setStream');
    expect(source).toContain('streamClient.delete');
  });

  it('uses injected labels instead of the app i18n singleton', () => {
    const source = readComponent();
    expect(source).toContain('export let labels');
    expect(source).toContain('labels(');
    expect(source).not.toContain('$_(');
  });
});
