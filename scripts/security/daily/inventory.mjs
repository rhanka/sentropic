// S1 inventory: required surfaces, derived-pin consumers, fail-closed report checks.
// Pure helpers plus filesystem inventory over the checked-out repository root.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContract } from './schema.mjs';

export const REQUIRED_LOCKS = ['package-lock.json', 'ui/package-lock.json', 'docs/governance/kit/package-lock.json'];
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
  return REQUIRED_LOCKS.map((rel) => ({ path: rel, present: existsSync(join(root, rel)) }));
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

export function findDerivedPinConsumers(root = '.', maxFiles = 200) {
  const hits = [];
  const visit = (dir, depth = 0) => {
    if (hits.length >= maxFiles || depth > 6) return;
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= maxFiles) return;
      if (entry === 'node_modules' || entry === '.git') continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) visit(full, depth + 1);
      else if (entry.endsWith('.mjs') || entry.endsWith('.json') || entry.endsWith('.sha256')) {
        let text = '';
        try {
          text = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (text.includes('declaredLockSha256')) hits.push(full);
      }
    }
  };
  visit(root);
  return hits.sort();
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
