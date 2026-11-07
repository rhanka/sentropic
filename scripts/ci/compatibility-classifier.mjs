#!/usr/bin/env node
// Compatibility classification for consumer-contract selection (BR-83).
// Pure assessment over caller-supplied evidence: maps a change to the most
// conservative change kind it contains. Unknown or missing evidence selects
// full blocking integration downstream; this module never invents coverage.
// Runs behind root Make targets in $(LLM_MESH_NODE_IMAGE); never on the host.
import {
  classifyDependencyValue,
  dependencyFloor,
  diffDependencyMaps,
  GuardError,
  loadSemver,
} from './publishable-manifests.mjs';

export const CHANGE_KINDS = ['internal-fix', 'additive', 'breaking', 'explicit-adoption',
  'root-lock-toolchain', 'runtime-security', 'ui-only', 'shared-asset', 'deployment-only', 'documentation-only', 'unknown'];

// Higher rank is more conservative and wins when a change spans areas.
const RANK = { 'internal-fix': 0, 'ui-only': 1, additive: 2, 'shared-asset': 3,
  'explicit-adoption': 4, breaking: 5, 'root-lock-toolchain': 6, 'runtime-security': 7, unknown: 8 };

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const DOC = /^(?:README|CHANGELOG)(?:\.(?:md|txt|rst))?$/i;

export function classifyFileArea(file) {
  if (typeof file !== 'string' || file.length === 0) return 'unknown';
  if (file.endsWith('.md') || file === 'LICENSE') return 'unrelated';
  if (file === 'package.json' || file === 'package-lock.json') return 'root-lock';
  if (file.startsWith('deploy/k8s/') || file.startsWith('deploy/ci/')) return 'deployment';
  if (file === 'Makefile' || file === 'api/Dockerfile' || file === 'ui/Dockerfile'
    || file === '.dockerignore' || file.startsWith('.github/workflows/')
    || file.startsWith('scripts/') || file.startsWith('tools/')
    || file.startsWith('docker-compose')) return 'toolchain';
  if (file.startsWith('api/') || file.startsWith('deploy/') || file.startsWith('.security/')
    || file.startsWith('e2e/') || file.startsWith('apps/auth-idp/') || file.startsWith('apps/llm-gateway/')
    || file.startsWith('apps/artifact-content/')) return 'runtime-security';
  if (file.startsWith('ui/')) return 'ui';
  const pkg = file.match(/^packages\/([^/]+)\/(.+)$/);
  if (!pkg) return 'unknown';
  const [, slug, rest] = pkg;
  if (slug === 'auth-ui' && (rest.startsWith('src/') || rest === 'package.json')) return 'shared-asset';
  if (rest.startsWith('src/')) return 'package-src';
  if (rest.startsWith('tests/')) return 'package-test';
  if (rest === 'package.json') return 'package-manifest';
  if (DOC.test(rest)) return 'package-doc';
  return 'unknown';
}

const isRegistryValue = (value, semver) => {
  if (typeof value !== 'string') return false;
  if (value.startsWith('file:') || value.startsWith('link:') || value.startsWith('workspace:')) return false;
  return classifyDependencyValue(value, semver).ok;
};

function bumpKind(published, candidate, semver) {
  for (const version of [published?.version, candidate?.version]) {
    if (typeof version !== 'string' || semver.valid(version) === null) return { kind: 'unknown', reason: 'unparsable manifest version' };
  }
  if (published.version === candidate.version) return { kind: null, reason: 'same version' };
  const diff = semver.diff(published.version, candidate.version);
  if (diff === null) return { kind: 'unknown', reason: 'unparsable manifest version' };
  if (diff.startsWith('major')) return { kind: 'breaking', reason: `major version bump ${published.version} -> ${candidate.version}` };
  if (diff.startsWith('minor')) return { kind: 'additive', reason: `minor version bump ${published.version} -> ${candidate.version}` };
  return { kind: null, reason: `patch-level version bump ${published.version} -> ${candidate.version}` };
}

function depDrift(published, candidate, semver) {
  for (const change of diffDependencyMaps(published, candidate)) {
    for (const value of [change.from, change.to]) {
      if (value !== undefined && !isRegistryValue(value, semver)) {
        return { kind: 'unknown', reason: `dependency ${change.name} is not registry evidence: ${value}` };
      }
    }
    if (change.from === undefined) return { kind: 'additive', reason: `added dependency: ${change.name}` };
    if (change.to === undefined) return { kind: 'breaking', reason: `removed dependency: ${change.name}` };
    const before = dependencyFloor(change.from, semver);
    const after = dependencyFloor(change.to, semver);
    if (semver.gt(after, before)) return { kind: 'breaking', reason: `tightened floor for ${change.name}: ${change.from} -> ${change.to}` };
    if (change.from !== change.to) return { kind: 'additive', reason: `widened range for ${change.name}: ${change.from} -> ${change.to}` };
  }
  return { kind: null, reason: 'identical dependency maps' };
}

const manifestPaths = (slug, scope) => scope === 'application'
  ? [`${slug}/package.json`, `apps/${slug}/package.json`]
  : [`packages/${slug}/package.json`];

export function classifyPackageChange({ slug, scope = 'library', files = [], published = null, candidate = null, semver = loadSemver() } = {}) {
  if (!isPlainObject(published) || !isPlainObject(candidate)) {
    return { kind: 'unknown', reasons: [`${slug}: missing manifest evidence`] };
  }
  const manifests = manifestPaths(slug, scope);
  const owned = files.filter((file) => manifests.includes(file) || file.startsWith(`packages/${slug}/src/`));
  if (scope === 'application') {
    const appRoots = [`${slug}/src/`, `apps/${slug}/src/`];
    if (files.some((file) => appRoots.some((root) => file.startsWith(root)))) {
      return { kind: 'runtime-security', reasons: [`${slug}: application source change`] };
    }
    const adoptions = diffDependencyMaps(published, candidate).filter((change) => change.from !== change.to);
    if (adoptions.length > 0) {
      return { kind: 'explicit-adoption',
        reasons: adoptions.map((change) => `${slug} adopts ${change.name}: ${change.from ?? 'absent'} -> ${change.to ?? 'absent'}`) };
    }
    return { kind: 'internal-fix', reasons: [`${slug}: no adopted dependency change`] };
  }
  const srcChanged = owned.some((file) => file !== `packages/${slug}/package.json`);
  const manifestChanged = owned.includes(`packages/${slug}/package.json`);
  if (!srcChanged && !manifestChanged) return { kind: 'internal-fix', reasons: [`${slug}: no functional change`] };
  const bump = bumpKind(published, candidate, semver);
  if (bump.kind === 'unknown') return { kind: 'unknown', reasons: [`${slug}: ${bump.reason}`] };
  if (srcChanged && published.version === candidate.version) {
    return { kind: 'unknown', reasons: [`${slug}: changed source without version bump`] };
  }
  const drift = depDrift(published, candidate, semver);
  if (drift.kind === 'unknown') return { kind: 'unknown', reasons: [`${slug}: ${drift.reason}`] };
  const kind = [drift.kind, bump.kind].find((value) => value !== null) ?? 'internal-fix';
  const reasons = [`${slug}: ${bump.reason}`, `${slug}: ${drift.reason}`];
  if (slug === 'auth-ui' && kind !== 'breaking') return { kind: 'shared-asset', reasons };
  return { kind, reasons };
}

export function classifyCompatibility({ files = [], packages = [], semver = loadSemver() } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return { kind: 'unknown', reasons: ['missing file evidence: changed file list is required'] };
  }
  const areas = files.map(classifyFileArea);
  const strange = files.filter((file, index) => areas[index] === 'unknown');
  if (strange.length > 0) {
    return { kind: 'unknown', reasons: strange.map((file) => `unrecognized change area: ${file}`) };
  }
  const uiConfined = areas.includes('ui')
    && areas.every((area) => ['ui', 'unrelated', 'package-doc'].includes(area));
  const kinds = [];
  const deploymentOnly = areas.includes('deployment')
    && areas.every((area) => ['deployment', 'unrelated', 'package-doc'].includes(area));
  if (areas.includes('runtime-security') || (areas.includes('deployment') && !deploymentOnly)) {
    kinds.push({ kind: 'runtime-security', reasons: ['runtime, security, e2e, host, or mixed deployment change'] });
  }
  if (areas.includes('root-lock') || areas.includes('toolchain')) {
    kinds.push({ kind: 'root-lock-toolchain', reasons: ['root lock, toolchain, image input, or workflow change'] });
  }
  for (const entry of packages) kinds.push(classifyPackageChange({ ...entry, files, semver }));
  if (deploymentOnly && kinds.every((entry) => entry.kind === 'internal-fix')) {
    return { kind: 'deployment-only', reasons: ['changes confined to Kubernetes manifests and deployment validation'] };
  }
  if (areas.every((area) => area === 'unrelated' || area === 'package-doc')
    && kinds.every((entry) => entry.kind === 'internal-fix')) {
    return { kind: 'documentation-only', reasons: ['changes confined to identified documentation'] };
  }
  if (kinds.length === 0) {
    if (uiConfined) return { kind: 'ui-only', reasons: ['functional changes confined to ui/'] };
    return { kind: 'internal-fix', reasons: ['no functional change: tests, docs, or unrelated paths only'] };
  }
  kinds.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  const winner = kinds[0];
  if (winner.kind === 'internal-fix' && uiConfined) {
    return { kind: 'ui-only', reasons: ['functional changes confined to ui/'] };
  }
  return { kind: winner.kind, reasons: kinds.flatMap((row) => row.reasons) };
}

if (process.argv[1] && import.meta.url.endsWith('/compatibility-classifier.mjs') && process.argv.includes('--check')) {
  const read = (flag) => {
    const at = process.argv.indexOf(flag);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  try {
    const files = JSON.parse(read('--files') ?? '[]');
    const packages = JSON.parse(read('--packages') ?? '[]');
    const verdict = classifyCompatibility({ files, packages });
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
    if (verdict.kind === 'unknown') process.exitCode = 1;
  } catch (error) {
    if (error instanceof GuardError) process.stderr.write(`::error::compatibility-classifier: ${error.message}\n`);
    else process.stderr.write(`::error::compatibility-classifier: ${error?.message ?? error}\n`);
    process.exitCode = 2;
  }
}
