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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.error) throw new Error('invalid or errored report');
  const trivy = parsed.SchemaVersion === 2 && typeof parsed.ArtifactName === 'string' && parsed.ArtifactName.length > 0 && Array.isArray(parsed.Results);
  const npm = parsed.auditReportVersion === 2 && parsed.vulnerabilities && !Array.isArray(parsed.vulnerabilities) &&
    typeof parsed.vulnerabilities === 'object' && parsed.metadata?.vulnerabilities &&
    ['info', 'low', 'moderate', 'high', 'critical', 'total'].every((key) => Number.isInteger(parsed.metadata.vulnerabilities[key]) && parsed.metadata.vulnerabilities[key] >= 0);
  if (!trivy && !npm) throw new Error('incomplete or unsupported report');
  return parsed;
}

// Registered acceptance annotates debt; it never removes a raw finding from this inventory.
export function summarizeBacklog(findings, rows, { today = new Date().toISOString().slice(0, 10), complete = false, coverageBlocked = [] } = {}) {
  if (!validDate(today) || !Array.isArray(findings) || !Array.isArray(rows)) throw new Error('invalid backlog input');
  const unresolved = rows.filter((row) => row.status !== 'resolved');
  const joined = findings.map((finding) => {
    if (!['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(finding.severity)) throw new Error('invalid normalized finding severity');
    return joinRegister(finding, unresolved, today);
  });
  const verificationPending = unresolved.filter((row) => !findings.some((finding) =>
    joinRegister(finding, [row], today).register === 'registered-exception'));
  const invalidRegister = unresolved.filter((row) => !row.id || !validDate(row.review_due)).length;
  const expiryHistogram = {};
  for (const row of unresolved) expiryHistogram[row.review_due || 'invalid'] = (expiryHistogram[row.review_due || 'invalid'] || 0) + 1;
  const expired = unresolved.filter((row) => validDate(row.review_due) && today > row.review_due).length;
  return { status: !complete || coverageBlocked.length || invalidRegister ? 'incomplete-scan' :
    (joined.length || unresolved.length ? 'complete-with-findings' : 'complete-clean'),
  findings: joined, unresolvedRegister: unresolved.length, expired,
  unexpired: unresolved.length - expired - invalidRegister, invalidRegister, expiryHistogram, verificationPending,
  coverageBlocked, staleContainerCandidates: unresolved.filter((row) => validDate(row.review_due) && today > row.review_due && row.component?.includes('tool')).length };
}

export function inventoryLocks(root = '.') {
  const found = repositoryFiles(root).filter((path) => /(?:^|\/)(?:.*package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(path));
  return [...new Set([...REQUIRED_LOCKS, ...found])].sort().map((path) => ({ path, present: existsSync(join(root, path)), includeDev: true }));
}

export function inventoryImages(contract, root) {
  const images = contract?.inventory?.images || [];
  return REQUIRED_IMAGES.map((key) => {
    const found = images.find((image) => image.key === key);
    const present = Boolean(found) && (!root || (existsSync(join(root, found.dockerfile)) &&
      new RegExp(`^FROM .+ AS ${found.stage}$`, 'im').test(readFileSync(join(root, found.dockerfile), 'utf8'))));
    return { key, present, dockerfile: found?.dockerfile || null };
  });
}

export function inventorySastRoots(contract, root) {
  const trees = contract?.inventory?.sourceTrees || ['api', 'ui', 'packages', 'apps', 'scripts', 'tools', 'docs/governance/kit'];
  const sourceFiles = root ? repositoryFiles(root).filter((path) => /\.[cm]?[jt]sx?$/.test(path) &&
    trees.some((tree) => path.startsWith(`${tree}/`))) : [];
  const discovered = sourceFiles.map((path) => path.includes('/src/') ? path.split('/src/')[0] + '/src' : path.slice(0, path.lastIndexOf('/')));
  const roots = [...new Set([...(contract?.inventory?.sastRoots || []), ...discovered])].sort();
  return { roots, sourceFiles, blockedUntil: contract?.inventory?.sastBlockedUntil || 'S2c', qualified: false };
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
  const images = inventoryImages(contract, root);
  const sast = inventorySastRoots(contract, root);
  const consumers = findDerivedPinConsumers(root);
  const missingLocks = locks.filter((lock) => !lock.present).map((lock) => lock.path);
  const undeclaredConsumers = consumers.filter((path) => !contract?.inventory?.derivedPinConsumers?.includes(path));
  const blockers = ['coverage-blocked: sast', ...missingLocks.map((path) => `missing lock: ${path}`),
    ...images.filter((image) => !image.present).map((image) => `missing image definition: ${image.key}`),
    ...undeclaredConsumers.map((path) => `undeclared lock-hash consumer: ${path}`)];
  const files = repositoryFiles(root);
  const rootPackage = files.includes('package.json') ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : {};
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : rootPackage.workspaces?.packages || [];
  const manifests = files.filter((path) => /(?:^|\/)package.json$/.test(path)).map((path) => {
    const dir = path === 'package.json' ? '' : path.slice(0, -'/package.json'.length);
    const workspace = !dir || workspaces.some((pattern) => pattern === dir ||
      (pattern.endsWith('/*') && dir.startsWith(pattern.slice(0, -1)) && !dir.slice(pattern.length - 1).includes('/')));
    const ownLock = dir ? `${dir}/package-lock.json` : 'package-lock.json';
    const lock = files.includes(ownLock) ? ownLock : workspace && files.includes('package-lock.json') ? 'package-lock.json' : null;
    if (!lock) blockers.push(`manifest without qualified lock: ${path}`);
    return { path, workspace, lock, includeDev: true };
  });
  return {
    locks,
    manifests,
    images,
    sast,
    derivedPinConsumers: consumers,
    coverage: {
      complete: blockers.length === 0,
      blockers,
      undeclaredConsumers,
      missingLocks,
      consumerCount: consumers.length,
      undeclaredConsumerIsBlocker: Boolean(contract?.derivedPins?.undeclaredConsumerIsBlocker),
    },
  };
}
