// The Make target mounts only these scripts and verified archives, never the repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { planArchives } from './archive-plan.mjs';
import { PUBLIC_LIBRARIES } from './packages.mjs';

const slugs = process.env.PACKAGE ? [process.env.PACKAGE] : PUBLIC_LIBRARIES;
const packages = planArchives(slugs, { directory: '/input', headSha: process.env.CONSUMER_HEAD_SHA });
for (const { slug, archive, manifest } of packages) {
  test(`should import every exported Node entry from the packed @sentropic/${slug} archive`, () => {
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), `consumer-${slug}-`));
    try {
      fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      const env = { ...process.env, HOME: consumer, npm_config_cache: path.join(consumer, '.cache'), NPM_CONFIG_USERCONFIG: path.join(consumer, '.npmrc') };
      delete env.NODE_PATH;
      delete env.NODE_OPTIONS;
      const install = spawnSync('npm', ['install', archive, '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], {
        cwd: consumer, env, encoding: 'utf8',
      });
      assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);
      const entries = Object.keys(manifest.exports ?? { '.': manifest.main }).filter((entry) => !entry.endsWith('.json'));
      assert.ok(entries.length, 'the package must declare a public entry');
      for (const entry of entries) {
        const specifier = entry === '.' ? manifest.name : manifest.name + entry.slice(1);
        const result = spawnSync('node', ['--input-type=module', '--eval', `await import(${JSON.stringify(specifier)});`], {
          cwd: consumer, env, encoding: 'utf8',
        });
        assert.equal(result.status, 0, `${specifier}: ${result.stdout}\n${result.stderr}`);
      }
    } finally {
      fs.rmSync(consumer, { recursive: true, force: true });
    }
  });
}
