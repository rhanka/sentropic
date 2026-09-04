import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutPath = resolve(process.cwd(), 'src/routes/+layout.svelte');

describe('root layout stream workspace fence', () => {
  it('reconnects the stream hub when the authenticated workspace scope changes', () => {
    const source = readFileSync(layoutPath, 'utf8');
    const scopeChangeBlock = source.slice(
      source.indexOf('if (currentUserId !== lastUserId || currentScope !== lastAdminScope)'),
      source.indexOf('lastUserId = currentUserId;'),
    );

    expect(scopeChangeBlock).toContain('streamHub.reset()');
    expect(scopeChangeBlock).not.toContain('streamHub.clearCaches()');
  });
});
