#!/usr/bin/env node
// Deliberate lock authoring only. Runtime installations never call this module.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.env.CI || !process.argv.includes('--write-locks')) {
  throw new Error('Tool lock updates require explicit --write-locks outside CI');
}
for (const catalogName of ['tool-locks.json', 'consumer-locks.json']) {
const catalogUrl = new URL(`./${catalogName}`, import.meta.url);
const catalog = JSON.parse(fs.readFileSync(catalogUrl));
for (const [key, profile] of Object.entries(catalog)) {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-lock-update-'));
  try {
    fs.writeFileSync(path.join(prefix, 'package.json'), JSON.stringify(profile.manifest));
    const args = ['install', '--prefix', prefix, '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'];
    if (profile.shallow) args.push('--install-strategy=shallow');
    const result = spawnSync('npm', args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Cannot update tool lock: ${key}`);
    profile.lock = JSON.parse(fs.readFileSync(path.join(prefix, 'package-lock.json')));
    console.log(`Updated ${key}`);
  } finally { fs.rmSync(prefix, { recursive: true, force: true }); }
}
const text = '{\n' + Object.entries(catalog).map(([key, value]) => `  ${JSON.stringify(key)}:${JSON.stringify(value)}`).join(',\n') + '\n}\n';
fs.writeFileSync(catalogUrl, text);
}
