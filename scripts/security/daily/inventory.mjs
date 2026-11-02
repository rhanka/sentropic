// S1 inventory: required surfaces, derived-pin consumers, fail-closed report checks.
// Pure helpers plus filesystem inventory over the checked-out repository root.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadSastContract } from './sast.mjs';
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
  const trivy = parsed.SchemaVersion === 2 && typeof parsed.ArtifactName === 'string' && parsed.ArtifactName.length > 0 && Array.isArray(parsed.Results) &&
    parsed.Results.every((result) => result && typeof result.Target === 'string' && result.Target.length && !result.error &&
      ['Vulnerabilities', 'Misconfigurations'].every((kind) => result[kind] === undefined || (Array.isArray(result[kind]) &&
        result[kind].every((finding) => finding && typeof finding[kind === 'Vulnerabilities' ? 'VulnerabilityID' : 'ID'] === 'string' &&
          ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(finding.Severity) &&
          (kind !== 'Vulnerabilities' || (typeof finding.PkgName === 'string' && typeof finding.InstalledVersion === 'string'))))));
  const npmSeverities = ['info', 'low', 'moderate', 'high', 'critical'];
  const npmEntries = Object.entries(parsed.vulnerabilities || {});
  const nonempty = (value) => typeof value === 'string' && value.length > 0;
  const npm = parsed.auditReportVersion === 2 && parsed.vulnerabilities && !Array.isArray(parsed.vulnerabilities) &&
    typeof parsed.vulnerabilities === 'object' && parsed.metadata?.vulnerabilities &&
    [...npmSeverities, 'total'].every((key) => Number.isInteger(parsed.metadata.vulnerabilities[key]) && parsed.metadata.vulnerabilities[key] >= 0) &&
    npmEntries.every(([name, entry]) => nonempty(name) && entry && entry.name === name &&
      npmSeverities.includes(entry.severity) && typeof entry.range === 'string' &&
      Array.isArray(entry.via) && entry.via.length > 0 && entry.via.every((via) =>
        typeof via === 'string' ? nonempty(via) : via && nonempty(via.name) &&
          npmSeverities.includes(via.severity) && typeof via.range === 'string')) &&
    npmSeverities.every((severity) => npmEntries.filter(([, entry]) => entry.severity === severity).length === parsed.metadata.vulnerabilities[severity]) &&
    parsed.metadata.vulnerabilities.total === npmEntries.length;
  if (!trivy && !npm) throw new Error('incomplete or unsupported report');
  return parsed;
}

// Registered acceptance annotates debt; it never removes a raw finding from this inventory.
export function normalizeRegister(document, repository) {
  const entries = document?.vulnerability_register?.vulnerabilities;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !repository) throw new Error('invalid register document');
  return Object.entries(entries).map(([registerKey, row]) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`invalid register row: ${registerKey}`);
    // Legacy rows missing an exact scanner/version/component remain verification-pending.
    return { ...row, registerKey, repository,
      id: row.id || registerKey.match(/CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0]?.toUpperCase() || registerKey,
      path: row.file || row.embedded_path || null, severity: row.risk || null,
      version: row.affected_version || null, component: row.component || null,
      containerCandidate: Boolean(row.image_digest || row.embedded_path || /^(?:usr|lib|bin|sbin|etc|workspace)\//.test(row.file || '')),
      scanner: row.scanner || null, platform: row.platform || null, imageDigest: row.image_digest || null };
  });
}

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
  coverageBlocked, staleContainerCandidates: unresolved.filter((row) => validDate(row.review_due) && today > row.review_due &&
    (row.containerCandidate || row.imageDigest || /image|toolbox|production|api-tool/.test(row.component || ''))).length };
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
  // ACT-L04: the frozen rule contract is qualified here; live execution stays fenced on L02.
  let sastContract = null;
  let contractError = null;
  try { sastContract = loadSastContract(root || '.'); } catch (error) { contractError = error.message; }
  return { roots, sourceFiles, blockedUntil: contract?.inventory?.sastBlockedUntil || 'S2c',
    qualified: Boolean(sastContract), contractError,
    executionBlocked: 'coverage-blocked: sast',
    executionNote: 'sast execution admission pending L02 scanner/toolbox' };
}

const SKIP = new Set(['.git', '.track', '.tmp', '.remote', '.claude', '.codex', '.agents', '.cursor', 'tmp',
  'node_modules', 'dist', 'build', 'coverage', '.svelte-kit', 'history', 'lock-snapshots', 'fixtures']);

export function repositoryFiles(root, limit = 100000) {
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
  const expected = expectedInventories(root, contract);
  const missingLocks = locks.filter((lock) => !lock.present).map((lock) => lock.path);
  const undeclaredConsumers = consumers.filter((path) => !contract?.inventory?.derivedPinConsumers?.includes(path));
  const blockers = [sast.executionBlocked, ...(sast.contractError ? [`coverage-blocked: sast contract: ${sast.contractError}`] : []),
    ...missingLocks.map((path) => `missing lock: ${path}`),
    ...images.filter((image) => !image.present).map((image) => `missing image definition: ${image.key}`),
    ...undeclaredConsumers.map((path) => `undeclared lock-hash consumer: ${path}`),
    ...expected.blockers];
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
    expected,
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

// L4-D/L4-E (ACT-L04): independently expected component inventories, derived from the
// repository itself (locks, tool catalog, toolbox Dockerfile pins, consumers) and never
// from scanner output, plus the completeness proof that scanner outputs must cover them.

export function expectedLockComponents(root = '.') {
  const components = [];
  const blockers = [];
  for (const lock of inventoryLocks(root)) {
    if (!lock.present) { blockers.push(`missing lock: ${lock.path}`); continue; }
    let parsed;
    try { parsed = JSON.parse(readFileSync(join(root, lock.path), 'utf8')); } catch { blockers.push(`unsupported lock layout: ${lock.path}`); continue; }
    if (![2, 3].includes(parsed.lockfileVersion) || !parsed.packages || typeof parsed.packages !== 'object') {
      blockers.push(`unsupported lock layout: ${lock.path}`);
      continue;
    }
    for (const [path, entry] of Object.entries(parsed.packages)) {
      if (!path) continue;
      components.push({ identity: `lock:${lock.path}#${path}`, name: path.split('node_modules/').pop(),
        version: entry?.version || null, dev: Boolean(entry?.dev), optional: Boolean(entry?.optional), peer: Boolean(entry?.peer) });
    }
  }
  return { components, blockers };
}

export function expectedToolCatalog(root = '.') {
  const path = 'scripts/ci/tool-locks.json';
  if (!existsSync(join(root, path))) return { tools: [], blockers: [`missing tool catalog: ${path}`] };
  let catalog;
  try { catalog = JSON.parse(readFileSync(join(root, path), 'utf8')); } catch { return { tools: [], blockers: [`unsupported tool catalog: ${path}`] }; }
  const specs = catalog?.specs || catalog;
  // Catalog keys are space-separated name@version groups; each entry is one locked tool.
  const keys = (Array.isArray(specs) ? specs.map((spec) => spec?.name || spec) : Object.keys(specs || {}))
    .flatMap((key) => String(key).split(/\s+/)).filter(Boolean).sort();
  return { tools: keys.map((key) => ({ identity: `tool:${key}`, key })), blockers: [] };
}

export function expectedEmbeddedBinaries(root = '.', contract) {
  const binaries = [];
  const blockers = [];
  const toolbox = contract?.inventory?.toolbox?.path;
  if (!toolbox || !existsSync(join(root, toolbox))) {
    blockers.push(`missing toolbox Dockerfile: ${toolbox || '(unset)'}`);
  } else {
    const text = readFileSync(join(root, toolbox), 'utf8');
    for (const match of text.matchAll(/go install (\S+)@v(\d+\.\d+\.\d+)/g)) {
      binaries.push({ identity: `binary:${toolbox}#${match[1]}@${match[2]}`, name: match[1], version: match[2] });
    }
    const manifestPath = join(root, '.security/ast-grep/rules-manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const pin = JSON.parse(readFileSync(manifestPath, 'utf8'))?.toolbox?.pin;
        if (pin?.version) binaries.push({ identity: `binary:${toolbox}#ast-grep@${pin.version}`, name: 'ast-grep', version: pin.version, sha256: pin.sha256 });
      } catch { blockers.push('unsupported ast-grep rules manifest'); }
    }
  }
  return { binaries, blockers };
}

export function expectedInventories(root = '.', contract = loadContract(join(root, '.security/security-fix.json'))) {
  const locks = expectedLockComponents(root);
  const catalog = expectedToolCatalog(root);
  const binaries = expectedEmbeddedBinaries(root, contract);
  const consumers = findDerivedPinConsumers(root);
  const blockers = [...locks.blockers, ...catalog.blockers, ...binaries.blockers,
    ...consumers.filter((path) => !contract?.inventory?.derivedPinConsumers?.includes(path)).map((path) => `undeclared lock-hash consumer: ${path}`)];
  const identities = [...locks.components.map((component) => component.identity),
    ...catalog.tools.map((tool) => tool.identity),
    ...binaries.binaries.map((binary) => binary.identity),
    ...inventoryLocks(root).map((lock) => `lockfile:${lock.path}`),
    ...consumers.map((path) => `consumer:${path}`)].sort();
  return { identities, lockComponents: locks.components, toolCatalog: catalog.tools,
    embeddedBinaries: binaries.binaries, standaloneLocks: inventoryLocks(root).map((lock) => lock.path),
    installedConsumers: consumers, blockers };
}

// Completeness proof: every independently expected identity must be covered by at least one
// scanner output. Two outputs agreeing while both omitting the same item still fail.
export function validateCompleteness(scannerOutputs, expected) {
  if (!Array.isArray(scannerOutputs) || scannerOutputs.length === 0) throw new Error('coverage-blocked: no scanner output');
  if (!expected || !Array.isArray(expected.identities)) throw new Error('coverage-blocked: expected inventory required');
  const covered = new Set(scannerOutputs.flat());
  const missing = expected.identities.filter((identity) => !covered.has(identity));
  if (missing.length) {
    throw new Error(`incomplete inventory, omitted components: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ` (+${missing.length - 20} more)` : ''}`);
  }
  return { covered: covered.size, expected: expected.identities.length };
}

// Applicability N/A is only declarable with a positive inventory proof (an enumeration that
// ran, even to zero items), never with a missing scanner output.
export function declareApplicability(surface, enumeration) {
  if (typeof surface !== 'string' || !surface) throw new Error('coverage-blocked: applicability surface required');
  if (!enumeration || enumeration.enumerated !== true || !Number.isInteger(enumeration.count) || enumeration.count < 0) {
    throw new Error(`coverage-blocked: applicability N/A without positive inventory proof: ${surface}`);
  }
  return { surface, na: true, proof: { enumerated: true, count: enumeration.count } };
}
