#!/usr/bin/env node
// Packed-consumer exception: exercise npm's real solver against a frozen registry universe.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { candidateArchives, frozenRegistry, lockedVersions } from './frozen-registry.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function installConsumer(args, { cwd = process.cwd(), env = process.env, stdio = 'inherit' } = {}) {
  if (args[0] !== 'install') throw new Error('Only packed-consumer install is supported');
  if (args.some(arg => arg.startsWith('--registry') || /^(https?:|git\+|github:)/.test(arg))) throw new Error('Consumer cannot override frozen registry');
  const versions = lockedVersions(root);
  const registry = await frozenRegistry(versions, candidateArchives(args, cwd));
  const prefixIndex = args.indexOf('--prefix');
  const consumer = prefixIndex < 0 ? cwd : path.resolve(cwd, args[prefixIndex + 1]);
  for (const directory of new Set([cwd, consumer])) {
    const config = path.join(directory, '.npmrc');
    if (fs.existsSync(config) && /(?:^|\n)\s*(?:@[^\s=:]+:)?registry\s*=/i.test(fs.readFileSync(config, 'utf8'))) {
      await registry.close();
      throw new Error('Consumer project cannot override frozen registry');
    }
  }
  const lockPath = path.join(consumer, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath));
    for (const record of Object.values(lock.packages ?? {})) {
      if (record.resolved?.match(/^http:\/\/127\.0\.0\.1:\d+\//)) {
        record.resolved = record.resolved.replace(/^http:\/\/127\.0\.0\.1:\d+/, registry.url);
      }
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
  // An empty private cache prevents metadata from a previous live-registry run entering this solve.
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-consumer-cache-'));
  fs.writeFileSync(path.join(cache, 'user.npmrc'), '');
  fs.writeFileSync(path.join(cache, 'global.npmrc'), '');
  const childEnv = { ...env, npm_config_registry: registry.url, npm_config_cache: cache, npm_config_audit: 'false' };
  for (const key of Object.keys(childEnv)) if (/^npm_config_.*:registry$/i.test(key)) delete childEnv[key];
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('npm', [...args, '--registry', registry.url, '--cache', cache,
        '--userconfig', path.join(cache, 'user.npmrc'), '--globalconfig', path.join(cache, 'global.npmrc'),
        '--no-audit', '--no-fund'], { cwd, env: childEnv, stdio });
      child.once('error', reject);
      child.once('close', code => resolve(code ?? 1));
    });
  } finally {
    try {
    // Retained consumer locks must replay after this temporary registry is closed.
    if (fs.existsSync(lockPath)) {
      const lock = JSON.parse(fs.readFileSync(lockPath));
      for (const [location, record] of Object.entries(lock.packages ?? {})) {
        if (!record.resolved?.startsWith(registry.url)) continue;
        const candidate = registry.candidates.find(c => c.integrity === record.integrity);
        const name = record.name ?? location.split('node_modules/').at(-1);
        const locked = versions.get(name)?.get(record.version);
        if (candidate) record.resolved = `file:${candidate.file}`;
        else if (locked?.dist.integrity === record.integrity) record.resolved = locked.dist.tarball;
        else throw new Error(`Consumer lock escaped frozen inputs: ${name}@${record.version}`);
      }
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    }
    } finally { await registry.close(); fs.rmSync(cache, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await installConsumer(['install', ...process.argv.slice(2)]);
}
