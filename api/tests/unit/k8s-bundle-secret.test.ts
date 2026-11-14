import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const makefile = readFileSync(resolve(__dirname, '../../../Makefile'), 'utf8');
const recipe = makefile.match(/^k8s-bundle-secret:[^\n]*\n((?:\t[^\n]*\n|\n)+)/m)![1];

// Execute the actual recipe after Make variable expansion; no make or cluster tools in the toolbox.
const bundle = (jwt: string | undefined, encryption: string | undefined) => {
  const dir = mkdtempSync(join(tmpdir(), 't1-bundle-'));
  const envFile = join(dir, 'input.env');
  const callsFile = join(dir, 'calls');
  writeFileSync(envFile, [jwt === undefined ? '' : `JWT_SECRET="${jwt}"`,
    encryption === undefined ? '' : `SECRET_ENCRYPTION_KEY="${encryption}"`,
    'OAUTH_SIGNING_KEK=synthetic-kek-for-bundle-only'].join('\n'));
  writeFileSync(join(dir, 'kubectl'), `#!/usr/bin/env node
import('node:fs').then(fs => {
  const args = process.argv.slice(2).map(arg => arg.startsWith('--from-literal=') ? arg.split('=')[1] : arg);
  fs.appendFileSync(process.env.T1_CALLS, JSON.stringify(args) + '\\n');
  if (args.includes('create')) process.stdout.write('{}');
  else process.stdin.resume();
});
`, { mode: 0o755 });
  try {
    const script = recipe.replace(/^\t@?/gm, '')
      .replaceAll('$(K8S_ENV_FILE)', envFile).replaceAll('$(K8S_NAMESPACE)', 'synthetic-preprod')
      .replaceAll('$(KUBECONFIG)', join(dir, 'no-cluster-access')).replaceAll('$$', '$');
    const result = spawnSync('sh', ['-c', script], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, T1_CALLS: callsFile },
    });
    return { status: result.status, output: result.stdout + result.stderr,
      calls: existsSync(callsFile) ? readFileSync(callsFile, 'utf8') : '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('k8s secret bundle preflight', () => {
  it.each([undefined, '', 'x', 'x'.repeat(31), ' '.repeat(32), ` ${'x'.repeat(31)} `])(
    'should refuse incomplete keys before any kubectl call (case %i)', value => {
      for (const name of ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY']) {
        const result = bundle(name === 'JWT_SECRET' ? value : 'j'.repeat(32),
          name === 'SECRET_ENCRYPTION_KEY' ? value : 'e'.repeat(32));
        expect(result.status).not.toBe(0);
        expect(result.calls).toBe('');
        expect(result.output).toContain(name);
        if (value?.trim()) expect(result.output).not.toContain(value);
      }
    });

  it('should bundle all three key names at the 32-character boundary without disclosing values', () => {
    const jwt = 'j'.repeat(32);
    const encryption = 'e'.repeat(32);
    const result = bundle(jwt, encryption);
    expect(result.status).toBe(0);
    for (const name of ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY', 'OAUTH_SIGNING_KEK']) expect(result.calls).toContain(name);
    expect(result.calls).toContain('apply');
    expect(result.output + result.calls).not.toContain(jwt);
    expect(result.output + result.calls).not.toContain(encryption);
  });
});
