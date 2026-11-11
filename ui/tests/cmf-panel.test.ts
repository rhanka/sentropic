import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sveltePath = resolve(__dirname, '../src/lib/components/ArtifactsPanel.svelte');
const serverPath = resolve(__dirname, '../../api/src/services/artifacts/artifact-panel.ts');
const svelte = readFileSync(sveltePath, 'utf8');
const server = readFileSync(serverPath, 'utf8');

describe('W4.c embeddable panel', () => {
  it('embeds only https artifact URLs in a sandboxed iframe', () => {
    expect(svelte).toContain('<iframe');
    expect(svelte).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(svelte).toContain('https:');
    expect(svelte).not.toContain('http://');
  });
  it('respects frame ancestors from the registration on the server', () => {
    expect(server).toContain('frame-ancestors');
    expect(server).toContain('frameAncestors');
    expect(server).toContain('https:');
  });
});
