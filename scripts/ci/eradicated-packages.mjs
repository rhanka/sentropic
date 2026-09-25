#!/usr/bin/env node
// Eradication guard (make check-eradicated-packages). The CLI and focus are owned by h2a:
// sentropic must not host a workspace package named @sentropic/cli, @sentropic/build-cli or
// @sentropic/focus, and no workspace may depend on @sentropic/focus through a local path.
// Runs only behind a root Make target inside $(MANIFEST_GUARD_IMAGE); never on the host.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ERADICATED_NAMES = ['@sentropic/cli', '@sentropic/build-cli', '@sentropic/focus'];
export const NO_LOCAL_DEPENDENCY = ['@sentropic/focus'];
export const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
// Local-path specs: npm protocols that point at the working tree, and relative/absolute/home paths.
export const LOCAL_SPEC = /^(?:file:|link:|portal:|workspace:|\.{1,2}(?:[\\/]|$)|[\\/]|~(?:[\\/]|$)|[a-z]:[\\/])/i;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Root manifest plus every workspace manifest declared by the root `workspaces` field.
// Supported patterns: a literal directory (`api`) or one trailing wildcard level (`packages/*`).
export function workspaceManifests(root) {
  const manifest = readJson(path.join(root, 'package.json'));
  const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : (manifest.workspaces?.packages ?? []);
  const files = ['package.json'];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*') && !/[*?[\]{}!]/.test(pattern.slice(0, -2))) {
      const dir = pattern.slice(0, -2);
      const abs = path.join(root, dir);
      if (!fs.existsSync(abs)) continue;
      for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = path.posix.join(dir, entry.name, 'package.json');
        if (entry.isDirectory() && fs.existsSync(path.join(root, rel))) files.push(rel);
      }
    } else if (!/[*?[\]{}!]/.test(pattern)) {
      const rel = path.posix.join(pattern, 'package.json');
      if (fs.existsSync(path.join(root, rel))) files.push(rel);
    } else {
      throw new Error(`unsupported workspace pattern "${pattern}" (extend scripts/ci/eradicated-packages.mjs)`);
    }
  }
  return files;
}

export function findViolations(root) {
  const violations = [];
  for (const rel of workspaceManifests(root)) {
    const manifest = readJson(path.join(root, rel));
    if (ERADICATED_NAMES.includes(manifest.name)) {
      violations.push(`${rel}: workspace package "${manifest.name}" is eradicated from sentropic (owned by h2a)`);
    }
    for (const section of DEP_SECTIONS) {
      for (const name of NO_LOCAL_DEPENDENCY) {
        const spec = manifest[section]?.[name];
        if (typeof spec === 'string' && LOCAL_SPEC.test(spec.trim())) {
          violations.push(`${rel}: ${section}["${name}"] = "${spec}" is a local-path dependency on an eradicated package`);
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? '.');
  const violations = findViolations(root);
  for (const v of violations) console.log(`::error title=Eradicated package::${v}`);
  if (violations.length > 0) {
    console.log(`check-eradicated-packages: FAIL (${violations.length} violation(s)); CLI and focus are owned by h2a (rules/MASTER.md)`);
    process.exit(1);
  }
  console.log('check-eradicated-packages: PASS');
}
