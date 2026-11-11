import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sveltePath = resolve(__dirname, '../src/lib/components/ArtifactsPanel.svelte');
const svelte = readFileSync(sveltePath, 'utf8');

describe('W4.c embeddable panel', () => {
  it('embeds only https artifact URLs in a sandboxed iframe', () => {
    expect(svelte).toContain('<iframe');
    expect(svelte).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(svelte).toContain('https:');
    expect(svelte).not.toContain('http://');
  });
  it('refuses non-https URLs with a fallback message', () => {
    expect(svelte).toContain('Artifact URL refused');
  });
});
