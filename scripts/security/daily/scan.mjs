// S2a: read-only raw scan orchestration. Qualification stays blocked on S2b/S2c.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { failClosedReport, inventoryRepository, normalizeRegister, summarizeBacklog } from './inventory.mjs';
import { loadContract } from './schema.mjs';

const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const npmArgs = ['audit', '--json', '--package-lock-only', '--ignore-scripts',
  '--include=dev', '--include=optional', '--include=peer', '--audit-level=high'];
const trivyArgs = ['--format', 'json', '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--exit-code', '0'];
const npmSeverity = (value) => ({ info: 'UNKNOWN', moderate: 'MEDIUM' }[value] || value.toUpperCase());

export function planScan(root, contract) {
  const inventory = inventoryRepository(root, contract);
  const tasks = inventory.locks.map((lock) => {
    const manifest = lock.path.replace(/package-lock\.json$/, 'package.json');
    const supported = manifest !== lock.path && existsSync(join(root, manifest));
    return { kind: 'lock', scanner: 'npm', target: lock.path, manifest, args: [...npmArgs],
      blocked: !lock.present ? 'missing lock' : !supported ? 'unsupported lock/manifest mapping' : null };
  });
  for (const image of inventory.images) tasks.push({ kind: 'image', scanner: 'trivy', target: image.key,
    args: ['image', ...trivyArgs], blocked: image.present ? null : 'missing image definition' });
  tasks.push({ kind: 'iac', scanner: 'trivy', target: '.', args: ['config', ...trivyArgs, '.'], blocked: null });
  return { inventory, tasks };
}

function npmFindings(report, task, root, repository) {
  const semver = createRequire(join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('semver');
  const lock = JSON.parse(readFileSync(join(root, task.target), 'utf8'));
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages) throw new Error('unsupported lock format');
  const entries = report.vulnerabilities;
  function advisories(entry, seen = new Set()) {
    if (seen.has(entry.name)) return [];
    return entry.via.flatMap((via) => {
      if (typeof via !== 'string') return [via];
      if (!entries[via]) throw new Error('missing indirect npm advisory');
      return advisories(entries[via], new Set([...seen, entry.name]));
    });
  }
  return Object.values(entries).flatMap((entry) => {
    if (!Array.isArray(entry.nodes) || !entry.nodes.length) throw new Error('missing affected dependency paths');
    const fix = entry.fixAvailable;
    if (fix && typeof fix === 'object' && (typeof fix.name !== 'string' || !fix.name ||
      !semver.valid(fix.version) || typeof fix.isSemVerMajor !== 'boolean')) throw new Error('invalid npm fix target');
    if (!advisories(entry).length) throw new Error('no reachable npm advisory');
    const resolved = entry.via.filter((via) => typeof via !== 'string' && via.name === entry.name);
    const dependencyContext = Object.values(entries).filter((carrier) => carrier.name !== entry.name &&
      advisories(carrier).some((via) => via.name === entry.name)).map((carrier) => ({
      component: carrier.name, nodes: [...carrier.nodes].sort(), severity: npmSeverity(carrier.severity),
      via: carrier.via.filter((via) => typeof via === 'string').sort(),
    })).sort((a, b) => a.component.localeCompare(b.component));
    return entry.nodes.flatMap((path) => {
      const version = lock.packages[path]?.version;
      if (typeof version !== 'string' || !version) throw new Error('missing installed version');
      return resolved.filter((via) => {
        if (!semver.valid(version) || !semver.validRange(via.range)) throw new Error('invalid advisory version/range');
        return semver.satisfies(version, via.range, { includePrerelease: true });
      }).map((via) => {
        const aliases = [...new Set((via.url || '').match(/CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) || [])];
        if (!aliases.length && !Number.isInteger(via.source)) throw new Error('missing advisory identity');
        return { repository, scanner: 'npm', id: aliases[0] || `npm:${via.source}`, aliases,
          component: entry.name, path: `${task.target}#${path}`, version,
          range: entry.range, advisoryRange: via.range, severity: npmSeverity(via.severity), dependencySeverity: npmSeverity(entry.severity),
          dependencyContext,
          fixedTarget: fix && typeof fix === 'object' ? `${fix.name}@${fix.version}` : null,
          fixIsSemVerMajor: fix && typeof fix === 'object' ? fix.isSemVerMajor : null };
      });
    });
  });
}

export async function scanRepository({ root = '.', sourceSha, repository, contract, rows = [], run,
  today = new Date().toISOString().slice(0, 10) }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('immutable source SHA required');
  if (!repository || typeof run !== 'function') throw new Error('repository and scanner runner required');
  const { inventory, tasks } = planScan(root, contract);
  const inputPaths = [...new Set([...inventory.locks.map((item) => item.path),
    ...inventory.manifests.map((item) => item.path), ...inventory.images.map((item) => item.dockerfile).filter(Boolean),
    ...inventory.sast.sourceFiles, ...inventory.derivedPinConsumers,
    '.security/vulnerability-register.yaml', '.security/security-fix.json'])].sort();
  const inputHashes = Object.fromEntries(inputPaths.map((path) => [path,
    existsSync(join(root, path)) ? hash(readFileSync(join(root, path))) : null]));
  const coverageBlocked = [...inventory.coverage.blockers, 'coverage-blocked: scanner/image/DB qualification S2b'];
  const surfaces = [];
  const findings = [];
  for (const task of tasks) {
    const surface = { ...task, blockingFloor: ['HIGH', 'CRITICAL'], state: 'blocked' };
    surfaces.push(surface);
    if (task.blocked) { coverageBlocked.push(`${task.target}: ${task.blocked}`); continue; }
    try {
      const result = await run(structuredClone(task));
      if (typeof result?.stdout === 'string') {
        if (Buffer.byteLength(result.stdout) > 16 * 1024 * 1024) throw new Error('report byte bound exceeded');
        surface.raw = result.stdout;
        surface.rawHash = hash(result.stdout);
      }
      surface.exitCode = result?.status;
      if (!Number.isInteger(result?.status) || ![0, ...(task.scanner === 'npm' ? [1] : [])].includes(result.status) || result.error || result.signal) {
        throw new Error('scanner command failed');
      }
      const parsed = failClosedReport(result.stdout);
      if (task.scanner === 'npm' ? parsed.auditReportVersion !== 2 : parsed.SchemaVersion !== 2) throw new Error('wrong scanner report format');
      if (!result.scannerIdentity || !result.databaseIdentity) throw new Error('missing scanner/database identity');
      surface.scannerIdentity = result.scannerIdentity;
      surface.databaseIdentity = result.databaseIdentity;
      // Trivy report adaptation and immutable target provenance are qualified by S2b.
      if (task.scanner !== 'npm') throw new Error('coverage-blocked: Trivy adapter S2b');
      const normalized = npmFindings(parsed, task, root, repository);
      if (result.status === 1 && !normalized.some((finding) => ['HIGH', 'CRITICAL'].includes(finding.severity))) throw new Error('audit exit/report mismatch');
      findings.push(...normalized.map((finding) => ({ ...finding, sourceSha, scannerIdentity: result.scannerIdentity,
        databaseIdentity: result.databaseIdentity, rawHash: surface.rawHash })));
      surface.state = normalized.length ? 'complete-with-findings' : 'complete-clean';
    } catch (error) {
      surface.state = 'error';
      surface.error = error.message;
      coverageBlocked.push(`${task.target}: ${error.message}`);
    }
  }
  for (const [path, before] of Object.entries(inputHashes)) {
    const after = existsSync(join(root, path)) ? hash(readFileSync(join(root, path))) : null;
    if (after !== before) coverageBlocked.push(`source bytes changed: ${path}`);
  }
  return { sourceSha, repository, scannedAt: new Date().toISOString(), inventory, inputHashes, surfaces,
    ...summarizeBacklog(findings, rows, { today, complete: coverageBlocked.length === 0, coverageBlocked }) };
}

export function npmRunner(root, inventory, execute = spawnSync) {
  return (task) => {
    if (task.scanner !== 'npm') throw new Error('coverage-blocked: immutable Trivy targets and DB require S2b');
    const scratch = mkdtempSync(join(tmpdir(), 'security-daily-audit-'));
    try {
      // Never copy npmrc, credentials, source code or installed hooks to the scanner workspace.
      const env = { PATH: process.env.PATH, HOME: scratch, TMPDIR: scratch,
        npm_config_cache: join(scratch, 'cache'), npm_config_userconfig: '/dev/null',
        npm_config_globalconfig: join(scratch, 'global.npmrc'), npm_config_registry: 'https://registry.npmjs.org/',
        npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false' };
      const metadataRoot = join(scratch, 'repository');
      const cwd = join(metadataRoot, dirname(task.target));
      mkdirSync(cwd, { recursive: true });
      const opts = { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, shell: false };
      copyFileSync(join(root, task.target), join(cwd, 'package-lock.json'));
      copyFileSync(join(root, task.manifest), join(cwd, 'package.json'));
      const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
      const lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'));
      for (const entry of Object.values(lock.packages || {}).filter((entry) => entry.link)) {
        if (typeof entry.resolved !== 'string') throw new Error('missing local link target');
        const path = relative(resolve(root), resolve(root, dirname(task.target), entry.resolved));
        if (path.startsWith('..') || isAbsolute(path)) throw new Error('local link escapes repository');
        mkdirSync(join(metadataRoot, path), { recursive: true });
        copyFileSync(join(root, path, 'package.json'), join(metadataRoot, path, 'package.json'));
      }
      if (manifest.workspaces) {
        for (const item of inventory.manifests.filter((item) => item.workspace && item.path !== 'package.json')) {
          mkdirSync(join(metadataRoot, dirname(item.path)), { recursive: true });
          copyFileSync(join(root, item.path), join(metadataRoot, item.path));
        }
      }
      const version = execute('npm', ['--version'], opts);
      if (version.status !== 0 || !/^\d+\.\d+\.\d+\s*$/.test(version.stdout || '')) throw new Error('npm scanner unavailable');
      const result = execute('npm', task.args, opts);
      return { ...result, scannerIdentity: `npm:${version.stdout.trim()};node:${process.version}`,
        databaseIdentity: `npm-registry:unversioned;response:${hash(result.stdout || '')}` };
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  };
}

export async function main() {
  const root = resolve('.');
  const contract = loadContract(join(root, '.security/security-fix.json'));
  const requireTool = createRequire(join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'));
  const register = readFileSync(join(root, '.security/vulnerability-register.yaml'));
  const rows = normalizeRegister(requireTool('yaml').parse(register.toString()), 'rhanka/sentropic');
  const inventory = inventoryRepository(root, contract);
  const report = await scanRepository({ root, sourceSha: process.env.SECURITY_DAILY_SOURCE_SHA,
    repository: 'rhanka/sentropic', contract, rows, run: npmRunner(root, inventory) });
  report.registerHash = hash(register);
  report.policyHash = hash(readFileSync(join(root, '.security/security-fix.json')));
  // Local raw receipt only; S3 owns public validation/redaction, retention and publication.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === 'complete-clean' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`incomplete-scan: ${error.message}\n`);
    process.exitCode = 1;
  });
}
