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
  const registry = await frozenRegistry(lockedVersions(root), candidateArchives(args, cwd));
  const prefixIndex = args.indexOf('--prefix');
  const consumer = prefixIndex < 0 ? cwd : path.resolve(cwd, args[prefixIndex + 1]);
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
  const childEnv = { ...env, npm_config_registry: registry.url, npm_config_cache: cache, npm_config_audit: 'false' };
  for (const key of Object.keys(childEnv)) if (/^npm_config_.*:registry$/i.test(key)) delete childEnv[key];
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('npm', [...args, '--registry', registry.url, '--cache', cache, '--no-audit', '--no-fund'], { cwd, env: childEnv, stdio });
      child.once('error', reject);
      child.once('close', code => resolve(code ?? 1));
    });
  } finally { await registry.close(); fs.rmSync(cache, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await installConsumer(['install', ...process.argv.slice(2)]);
}
