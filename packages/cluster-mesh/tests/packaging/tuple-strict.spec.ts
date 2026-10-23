import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson, read } from './helpers.js';

// Strict published-tuple install (V7-M1): the final immo tuple installs with a
// plain `npm install` — exit 0, no ERESOLVE, no --legacy-peer-deps escape — and
// passes topology preflight. prepare.sh records the outcome; only its
// invariants are asserted here.
const detail = (): Record<string, string> => Object.fromEntries(
  read(join(fixtureDir('latest'), 'npm-install-detail')).trim().split('\n').map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }),
);

const tupleOf = (): Record<string, string> => Object.fromEntries(
  read(join(fixtureDir('latest'), 'tuple.txt')).trim().split('\n').map((line) => {
    const at = line.lastIndexOf('@');
    return [line.slice(0, at), line.slice(at + 1)];
  }),
);

const PREFLIGHT = `
  import { verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
  const out = { topology: verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] }).instances.length };
  console.log(JSON.stringify(out));`;

describe.skipIf(!enabled)('strict published tuple', () => {
  it('installs with a plain npm install: exit 0 and no ERESOLVE', () => {
    const record = detail();
    console.log(`[latest] recorded npm outcome ${JSON.stringify(record)}`);
    expect(record['plain-exit']).toBe('0');
    expect(record['plain-eresolve']).toBe('no');
  });

  it('resolves every tuple member inside the widened peer ranges', () => {
    const tuple = tupleOf();
    for (const name of ['@sentropic/cluster-mesh', '@sentropic/llm-mesh', '@sentropic/llm-gateway',
      '@sentropic/mcp-auth', '@sentropic/auth-hono', '@sentropic/oauth-verify', 'jose', 'hono']) {
      expect(tuple[name], name).not.toBe('absent');
    }
  });

  it('passes topology preflight on the strict tuple', () => {
    expect(nodeJson(fixtureDir('latest'), PREFLIGHT)).toEqual({ topology: 1 });
  });
});
