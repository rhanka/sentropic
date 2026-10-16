import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, read, trainVersion } from './helpers.js';

// MCP tuple (Lot 7): the packed candidate installs alongside the locally-packed
// mcp-platform sibling (the unpublished 0.3.0 candidate) and the registry SDK,
// with every member inside the candidate's declared peer ranges. Runs only on
// the prepared packaging fixtures (CI lazy-package); skipped otherwise.
const installed = (dir: string, name: string): string => {
  try {
    const pkg = JSON.parse(read(join(fixtureDir(dir), 'node_modules', ...name.split('/'), 'package.json')));
    return typeof pkg.version === 'string' ? pkg.version : 'absent';
  } catch {
    return 'absent';
  }
};

describe.skipIf(!enabled)('mcp tuple', () => {
  it('installs candidate, platform sibling and registry SDK together', () => {
    const mesh = installed('mcp-consumer', '@sentropic/cluster-mesh');
    const platform = installed('mcp-consumer', '@sentropic/mcp-platform');
    const sdk = installed('mcp-consumer', '@modelcontextprotocol/sdk');
    expect(mesh, 'cluster-mesh').not.toBe('absent');
    expect(platform, 'mcp-platform').toBe(trainVersion('mcp-platform'));
    expect(sdk, 'sdk').not.toBe('absent');
  });

  it('keeps both peers inside the candidate ranges', () => {
    const peers = JSON.parse(read(new URL('../../package.json', import.meta.url), 'utf8'))
      .peerDependencies as Record<string, string>;
    expect(peers['@sentropic/mcp-platform']).toBe('>=0.3.0 <0.4.0');
    expect(peers['@modelcontextprotocol/sdk']).toBe('^1.31.0');
    expect(installed('mcp-consumer', '@sentropic/mcp-platform')).toBe(trainVersion('mcp-platform'));
  });
});
