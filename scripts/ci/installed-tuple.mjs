#!/usr/bin/env node
// Immutable installed tuples for consumer omission proof (BR-83). Resolves
// the exact installed dependency closure of an application from its manifest,
// the root lockfile, and qualified candidate tarballs, plus the Docker input
// digests, into one canonical digest. A semver range or an unchanged manifest
// is insufficient because workspaces and file: dependencies resolve source:
// only locked exact versions with integrity, candidate bytes for linked
// libraries, and hashed Docker inputs count. Any gap throws fail-closed.
// Runs behind root Make targets in $(LLM_MESH_NODE_IMAGE); never on the host.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GuardError, loadSemver } from './publishable-manifests.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const LINKED = /^(?:file|link|workspace|portal):/;

export function resolveInstalledTuple({ manifest = null, lockPackages = null, candidates = [],
  dockerfiles = {}, workspaceVersions = {}, appDir = null, semver = loadSemver() } = {}) {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.dependencies)) {
    throw new GuardError('installed tuple requires an application manifest with dependencies');
  }
  if (!isPlainObject(lockPackages)) throw new GuardError('installed tuple requires lockfile packages');
  if (!Array.isArray(candidates)) throw new GuardError('installed tuple requires a candidate list');
  const byName = new Map(candidates.map((row) => [row?.name, row]));
  // npm workspaces nest the app copy first: <app>/node_modules/<name> wins
  // over the hoisted root copy, which may satisfy another workspace instead.
  const prefixes = appDir ? [`${appDir}/node_modules/`, 'node_modules/'] : ['node_modules/'];
  const lockedEntry = (name) => {
    for (const prefix of prefixes) {
      const entry = lockPackages[`${prefix}${name}`];
      if (isPlainObject(entry)) return entry;
    }
    return undefined;
  };
  const closure = {};
  for (const [name, spec] of Object.entries(manifest.dependencies).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (typeof spec !== 'string' || spec.length === 0) throw new GuardError(`invalid dependency spec: ${name}`);
    if (LINKED.test(spec)) {
      const candidate = byName.get(name);
      if (candidate && typeof candidate.version === 'string' && typeof candidate.sha256 === 'string') {
        if (!/^[a-f0-9]{64}$/.test(candidate.sha256)) throw new GuardError(`linked dependency ${name} has no valid candidate sha256`);
        const locked = lockPackages[`node_modules/${name}`];
        if (locked !== undefined && locked.version !== undefined && locked.version !== candidate.version) {
          throw new GuardError(`candidate version mismatch for ${name}: lock ${locked.version} != candidate ${candidate.version}`);
        }
        closure[name] = { version: candidate.version, candidate: candidate.sha256, qualified: true };
        continue;
      }
      // Resolvable but unqualified: comparable across revisions, never proof
      // of an omission on its own. Only qualified candidate bytes omit work.
      const workspaceVersion = workspaceVersions[name];
      if (typeof workspaceVersion !== 'string' || semver.valid(workspaceVersion) === null) {
        throw new GuardError(`linked dependency ${name} (${spec}) is not proof: no qualified candidate recorded`);
      }
      closure[name] = { version: workspaceVersion, qualified: false };
      continue;
    }
    const locked = lockedEntry(name);
    if (!isPlainObject(locked)) throw new GuardError(`missing lock entry: ${name}`);
    if (typeof locked.version !== 'string' || semver.valid(locked.version) === null) {
      throw new GuardError(`lock entry ${name} is not an exact locked version: ${locked.version}`);
    }
    if (typeof locked.integrity !== 'string' || locked.integrity.length === 0) {
      throw new GuardError(`missing integrity: ${name}`);
    }
    if (semver.validRange(spec, { loose: false }) === null || !semver.satisfies(locked.version, spec)) {
      throw new GuardError(`locked version ${locked.version} of ${name} is outside the declared range ${spec}`);
    }
    closure[name] = { version: locked.version, integrity: locked.integrity };
  }
  const docker = {};
  for (const [file, content] of Object.entries(dockerfiles).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (typeof content !== 'string') throw new GuardError(`Docker input ${file} is not readable text`);
    docker[file] = sha256(content);
  }
  const canonical = JSON.stringify({ closure, docker });
  return { closure, docker, digest: sha256(canonical) };
}

export function compareTuples(before, after) {
  const differences = [];
  if (!isPlainObject(before) || !isPlainObject(after)) return { equal: false, differences: ['tuple is missing'] };
  for (const name of [...new Set([...Object.keys(before.closure ?? {}), ...Object.keys(after.closure ?? {})])].sort()) {
    const a = before.closure?.[name];
    const b = after.closure?.[name];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      const show = (row) => {
        if (!row) return 'absent';
        if (row.candidate) return `${row.version} (candidate ${row.candidate.slice(0, 12)})`;
        if (row.qualified === false) return `${row.version} (unqualified workspace source)`;
        return row.version;
      };
      differences.push(`dependency ${name}: ${show(a)} -> ${show(b)}`);
    }
  }
  for (const file of [...new Set([...Object.keys(before.docker ?? {}), ...Object.keys(after.docker ?? {})])].sort()) {
    if ((before.docker ?? {})[file] !== (after.docker ?? {})[file]) differences.push(`docker input ${file} changed`);
  }
  return { equal: differences.length === 0, differences };
}

export function tupleForApp({ root = process.cwd(), appDir = 'api', candidates = [], dockerfiles = null, semver = loadSemver() } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, appDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const inputs = dockerfiles ?? Object.fromEntries(
    [`${appDir}/Dockerfile`].filter((file) => fs.existsSync(path.join(root, file)))
      .map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const workspaceVersions = {};
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof spec === 'string' && LINKED.test(spec)) {
      const slug = name.startsWith('@sentropic/') ? name.slice('@sentropic/'.length) : null;
      const file = slug ? path.join(root, 'packages', slug, 'package.json') : null;
      if (file && fs.existsSync(file)) workspaceVersions[name] = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    }
  }
  return resolveInstalledTuple({ manifest, lockPackages: lock.packages ?? {}, candidates,
    dockerfiles: inputs, workspaceVersions, appDir, semver });
}

if (process.argv[1] && import.meta.url.endsWith('/installed-tuple.mjs') && process.argv.includes('--tuple')) {
  const read = (flag) => {
    const at = process.argv.indexOf(flag);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  try {
    const appDir = read('--app') ?? 'api';
    const candidates = JSON.parse(read('--candidates') ?? '[]');
    const resolved = tupleForApp({ root: read('--root') ?? process.cwd(), appDir, candidates });
  process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`::error::installed-tuple: ${error?.message ?? error}\n`);
    process.exitCode = error instanceof GuardError ? 1 : 2;
  }
}
