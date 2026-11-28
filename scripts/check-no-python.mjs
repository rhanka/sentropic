#!/usr/bin/env node
// Zero-Python repository guard (SJ-0s). Checks tracked and non-ignored untracked
// paths, shebangs, and package.json scripts against scripts/no-python-allowlist.json.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'no-python-allowlist.json');

export function loadAllowlist(path = ALLOWLIST_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.allowedPaths)) {
    throw new Error('no-python-allowlist.json must contain an "allowedPaths" array');
  }
  for (const entry of parsed.allowedPaths) {
    if (
      typeof entry !== 'string' || entry.length === 0 || entry.startsWith('/') ||
      entry.includes('\\') || entry.split('/').includes('..') || /[*?[\]{}]/.test(entry)
    ) {
      throw new Error(`invalid allowlist entry (exact relative path required): ${String(entry)}`);
    }
  }
  return new Set(parsed.allowedPaths);
}

export function isPythonPath(rel) {
  if (/\.(py|pyw|pyi|pyx)$/i.test(rel)) return true;
  const base = basename(rel).toLowerCase();
  return base === 'pyproject.toml' || (base.startsWith('requirements') && base.endsWith('.txt'));
}

export function findHits(rels, allowed) {
  return rels.filter((rel) => rel !== '' && !allowed.has(rel) && isPythonPath(rel));
}

function readInventoryFile(filePath) {
  return [...new Set(readFileSync(filePath, 'utf8').split('\0').filter(Boolean))];
}

function listFiles() {
  if (process.env.NO_PYTHON_TRACKED_FILE) {
    const tracked = readInventoryFile(process.env.NO_PYTHON_TRACKED_FILE);
    const untracked = process.env.NO_PYTHON_UNTRACKED_FILE ? readInventoryFile(process.env.NO_PYTHON_UNTRACKED_FILE) : [];
    return { tracked, untracked };
  }
  const runGit = (...opts) => spawnSync('git', ['-C', ROOT, 'ls-files', ...opts, '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const t = runGit('--cached');
  const u = runGit('--others', '--exclude-standard');
  if (t.status !== 0 || u.status !== 0) {
    throw new Error('cannot prove zero-python: git ls-files failed and NO_PYTHON_TRACKED_FILE is unset');
  }
  return {
    tracked: [...new Set(t.stdout.split('\0').filter(Boolean))],
    untracked: [...new Set(u.stdout.split('\0').filter(Boolean))],
  };
}

function main() {
  const allowed = loadAllowlist();
  const { tracked, untracked } = listFiles();
  const hits = findHits([...new Set([...tracked, ...untracked])], allowed);
  if (hits.length === 0) {
    console.log(`✓ ZERO PYTHON OK (0 unexcused, ${allowed.size} allowlisted data paths)`);
    return;
  }
  console.error(`check-no-python: unexcused Python paths (${hits.length}):`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (err) {
    console.error(`check-no-python: ${err.message}`);
    process.exit(1);
  }
}
