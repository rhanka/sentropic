import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('should install the same packed artifacts candidate in selected, latest and artifacts consumers without registry access', () => {
  const root = mkdtempSync(join(tmpdir(), 'prepare-artifacts-'));
  const work = join(root, 'work');
  try {
    // Stub npm's network operations while running the real preparation and source selection,
    // limited to the asserted artifacts-candidate consumers (prepare.sh default stays full).
    writeFileSync(join(root, 'npm'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'pack') {
  const dest = args[args.indexOf('--pack-destination') + 1];
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  fs.writeFileSync(path.join(dest, pkg.name.replace('@', '').replace('/', '-') + '-' + pkg.version + '.tgz'), JSON.stringify(pkg));
} else if (['install', 'ci'].includes(args[0]) && !args.includes('--prefix')) {
  fs.writeFileSync(path.join(process.cwd(), 'install-command.txt'), args[0]);
}
`, { mode: 0o755 });
    const result = spawnSync('sh', ['tests/packaging/prepare.sh', work], {
      cwd: new URL('../..', import.meta.url),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CLUSTER_MESH_SIBLING_RECEIPTS: '', CLUSTER_MESH_PREPARE_ONLY: 'artifacts' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const dependency = (fixture: string) => JSON.parse(readFileSync(join(work, fixture, 'package.json'), 'utf8'))
      .dependencies['@sentropic/artifacts'] as string;
    const archive = dependency('artifacts-consumer');
    expect(archive).toMatch(/^file:/u);
    expect(dependency('selected')).toBe(archive);
    expect(dependency('latest')).toBe(archive);
    expect(readFileSync(join(work, 'selected', 'install-command.txt'), 'utf8')).toBe('install');
    const packed = JSON.parse(readFileSync(archive.slice(5), 'utf8'));
    const candidate = JSON.parse(readFileSync(new URL('../../../artifacts/package.json', import.meta.url), 'utf8'));
    expect({ name: packed.name, version: packed.version }).toEqual({ name: candidate.name, version: candidate.version });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
