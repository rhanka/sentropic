// S1 inventory: required surfaces, derived-pin consumers, fail-closed report checks.
// Pure helpers plus filesystem inventory over the checked-out repository root.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { joinRegister, loadContract, validDate } from './schema.mjs';

export const REQUIRED_LOCKS = ['package-lock.json', 'api/package-lock.json', 'ui/package-lock.json',
  'docs/governance/kit/package-lock.json', 'apps/auth-idp/web/package-lock.json', 'e2e/package-lock.json',
  'tools/memory-mcp-l5/artifacts/toolchain/toolchain.package-lock.json'];
export const REQUIRED_IMAGES = ['api-production', 'api-toolbox', 'ui-production'];

export function failClosedReport(raw) {
  if (raw === undefined || raw === null) throw new Error('missing report');
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (!text.trim()) throw new Error('empty report');
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('malformed report');
  }
  if (Array.isArray(parsed.Results) && !('SchemaVersion' in parsed) && !('ArtifactName' in parsed)) {
    throw new Error('incomplete report');
  }
  return parsed;
}

export function inventoryLocks(root = '.') {
  const found = repositoryFiles(root).filter((path) => /(?:^|\/)(?:.*package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(path));
  return [...new Set([...REQUIRED_LOCKS, ...found])].sort().map((path) => ({ path, present: existsSync(join(root, path)), includeDev: true }));
}

export function inventoryImages(contract) {
  const images = contract?.inventory?.images || [];
  return REQUIRED_IMAGES.map((key) => {
    const found = images.find((image) => image.key === key);
    return { key, present: Boolean(found), dockerfile: found?.dockerfile || null };
  });
}

export function inventorySastRoots(contract) {
  const roots = contract?.inventory?.sastRoots || [];
  return { roots, blockedUntil: contract?.inventory?.sastBlockedUntil || 'S2c', qualified: false };
}

const SKIP = new Set(['.git', '.track', '.tmp', '.remote', '.claude', '.codex', '.agents', 'tmp',
  'node_modules', 'dist', 'build', 'coverage', '.svelte-kit', 'history', 'lock-snapshots', 'fixtures']);

function repositoryFiles(root, limit = 100000) {
  const files = [];
  const visit = (rel = '') => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`inventory cannot qualify symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      if (files.length > limit) throw new Error('inventory file bound exceeded');
    }
  };
  visit();
  return files.sort();
}

export function findDerivedPinConsumers(root = '.', maxFiles = 200) {
  const pattern = /declaredLockSha256|lock[A-Za-z]*Sha256|[Ll]ock.{0,30}[Ss][Hh][Aa]-?256|[Ss][Hh][Aa]-?256.{0,30}[Ll]ock/;
  const hits = repositoryFiles(root).filter((path) =>
    /\.(?:[cm]?[jt]s|json|sha256)$/.test(path) && !/package-lock\.json$|(?:^|\/)tests?\/|\.test\.|^scripts\/security\/daily\/|^\.security\/security-fix.json$/.test(path) &&
    pattern.test(readFileSync(join(root, path), 'utf8')));
  if (hits.length > maxFiles) throw new Error('derived consumer bound exceeded');
  return hits;
}

export function inventoryRepository(root = '.', contract = loadContract(join(root, '.security/security-fix.json'))) {
  const locks = inventoryLocks(root);
  const images = inventoryImages(contract);
  const sast = inventorySastRoots(contract);
  const consumers = findDerivedPinConsumers(root);
  const missingLocks = locks.filter((lock) => !lock.present).map((lock) => lock.path);
  return {
    locks,
    images,
    sast,
    derivedPinConsumers: consumers,
    coverage: {
      complete: missingLocks.length === 0 && images.every((image) => image.present),
      missingLocks,
      consumerCount: consumers.length,
      undeclaredConsumerIsBlocker: Boolean(contract?.derivedPins?.undeclaredConsumerIsBlocker),
    },
  };
}
