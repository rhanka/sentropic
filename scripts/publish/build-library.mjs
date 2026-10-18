// Called only by Make inside a disposable Node container. No host node_modules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PUBLIC_LIBRARIES } from './packages.mjs';

const [action, ...requested] = process.argv.slice(2);
const slugs = requested.length ? requested : PUBLIC_LIBRARIES;
if (!['build', 'test'].includes(action) || slugs.some((s) => !PUBLIC_LIBRARIES.includes(s))) {
  throw new Error('Expected build|test and declared public library slugs');
}
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'public-libraries-'));
const run = (command, args, cwd = temp) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} failed (${result.status})`);
};
try {
  const dependencies = { typescript: '5.4.5', '@types/node': '22.10.10' };
  if (action === 'test') dependencies.vitest = '4.1.0';
  for (const slug of slugs) {
    const manifest = JSON.parse(fs.readFileSync(`packages/${slug}/package.json`, 'utf8'));
    Object.assign(dependencies, manifest.dependencies);
  }
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }));
  run('npm', ['install', '--no-audit', '--no-fund', ...(action === 'build' ? ['--ignore-scripts'] : [])]);
  // Existing connector tests exercise the sibling platform's experimental fixtures.
  const copy = (slug) => {
    const source = path.join(root, 'packages', slug);
    const target = path.join(temp, 'packages', slug);
    fs.mkdirSync(target, { recursive: true });
    for (const entry of ['src', 'tests', 'package.json', 'tsconfig.json', 'vitest.config.ts']) {
      if (fs.existsSync(path.join(source, entry))) fs.cpSync(path.join(source, entry), path.join(target, entry), { recursive: true });
    }
    return target;
  };
  if (action === 'test') copy('mcp-platform');
  for (const slug of slugs) {
    console.log(`${action}: @sentropic/${slug}`);
    const target = copy(slug);
    if (action === 'build') {
      run(path.join(temp, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], target);
      // SKILL.md assets must accompany the compiled bundle loader.
      if (slug === 'skills') {
        for (const entry of fs.readdirSync(path.join(target, 'src'), { recursive: true })) {
          if (!entry.endsWith('.md')) continue;
          const out = path.join(target, 'dist', entry);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.copyFileSync(path.join(target, 'src', entry), out);
        }
      }
      const dist = path.join(root, 'packages', slug, 'dist');
      fs.rmSync(dist, { recursive: true, force: true });
      fs.cpSync(path.join(target, 'dist'), dist, { recursive: true });
    } else if (fs.existsSync(path.join(target, 'tests'))) {
      run(path.join(temp, 'node_modules/.bin/vitest'), ['run', 'tests', '--environment', 'node'], target);
    }
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
