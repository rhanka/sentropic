import { describe, expect, it } from 'vitest';
// The publication gate is executable JavaScript shared with Make.
// @ts-expect-error gate intentionally has no public package declaration
import { verifyAuthGraph } from '../scripts/auth-registry.mjs';

describe('auth registry dependency graph', () => {
  it.each(['file:../oauth-verify', 'link:../x', 'workspace:*', 'github:a/b',
    'a/b', 'git+https://example.com/a.git', '../x', '/x', 'https://example.com/x.tgz']) (
    'rejects a non-registry edge at any depth: %s', async range => {
      const lookup = async (name: string, version: string) => ({ name, version,
        dependencies: name === 'auth' ? { nested: '^1.0.0' } : { deeper: range },
      });
      await expect(verifyAuthGraph({ auth: '^0.2.1' }, lookup)).rejects.toThrow('Non-registry');
    },
  );
  it('checks optional peers and terminates cycles', async () => {
    const visited: string[] = [];
    await verifyAuthGraph({ auth: '^0.2.1' }, async (name: string, version: string) => {
      visited.push(name);
      return { name, version, peerDependencies: { optional: '^1.0.0' } };
    });
    expect(visited).toEqual(['auth', 'optional']);
  });
  it('fails closed on missing or mismatched metadata', async () => {
    await expect(verifyAuthGraph({ auth: '^0.2.1' }, async () => ({}))).rejects.toThrow();
    await expect(verifyAuthGraph({ auth: '^0.2.1' }, async () => { throw Error(); })).rejects.toThrow();
  });
});
