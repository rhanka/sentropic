#!/usr/bin/env node
// Install an isolated tool graph from the committed catalog, never registry ranges.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function installTools(args, { run = spawnSync } = {}) {
  const prefixIndex = args.indexOf('--prefix');
  if (prefixIndex < 0 || !args[prefixIndex + 1]) throw new Error('--prefix is required');
  const prefix = path.resolve(args[prefixIndex + 1]);
  const rest = args.filter((_, i) => i !== prefixIndex && i !== prefixIndex + 1);
  const allowed = new Set(['--no-save', '--no-audit', '--no-fund', '--ignore-scripts', '--install-strategy=shallow', '--loglevel=error']);
  for (const arg of rest) if (arg.startsWith('-') && !allowed.has(arg)) throw new Error(`Unsupported locked tool option: ${arg}`);
  const specs = rest.filter(arg => !arg.startsWith('-')).sort();
  const shallow = rest.includes('--install-strategy=shallow');
  const key = (shallow ? 'shallow:' : '') + specs.join(' ');
  const catalog = JSON.parse(fs.readFileSync(new URL('./tool-locks.json', import.meta.url)));
  const profile = catalog[key];
  if (!profile) throw new Error(`No committed tool lock for: ${key}`);
  fs.mkdirSync(prefix, { recursive: true });
  // Tool prefixes are disposable and must never carry an unrelated manifest.
  fs.writeFileSync(path.join(prefix, 'package.json'), JSON.stringify(profile.manifest));
  fs.writeFileSync(path.join(prefix, 'package-lock.json'), JSON.stringify(profile.lock));
  const ciArgs = ['ci', '--prefix', prefix, '--no-audit', '--no-fund'];
  if (rest.includes('--ignore-scripts')) ciArgs.push('--ignore-scripts');
  if (shallow) ciArgs.push('--install-strategy=shallow');
  const result = run('npm', ciArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Locked tool install failed: ${result.status}`);
  return prefix;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installTools(process.argv.slice(2));
}
