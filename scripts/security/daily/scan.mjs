// S2a: read-only raw scan orchestration. Qualification stays blocked on S2b/S2c.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { failClosedReport, inventoryRepository, summarizeBacklog } from './inventory.mjs';

const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const npmArgs = ['audit', '--json', '--package-lock-only', '--ignore-scripts',
  '--include=dev', '--include=optional', '--include=peer', '--audit-level=high'];
const trivyArgs = ['--format', 'json', '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--exit-code', '0'];

export function planScan(root, contract) {
  const inventory = inventoryRepository(root, contract);
  const tasks = inventory.locks.map((lock) => {
    const supported = /(?:^|\/)package-lock.json$/.test(lock.path) &&
      existsSync(join(root, dirname(lock.path), 'package.json'));
    return { kind: 'lock', scanner: 'npm', target: lock.path, args: [...npmArgs],
      blocked: !lock.present ? 'missing lock' : !supported ? 'unsupported lock/manifest mapping' : null };
  });
  for (const image of inventory.images) tasks.push({ kind: 'image', scanner: 'trivy', target: image.key,
    args: ['image', ...trivyArgs], blocked: image.present ? null : 'missing image definition' });
  tasks.push({ kind: 'iac', scanner: 'trivy', target: '.', args: ['config', ...trivyArgs, '.'], blocked: null });
  return { inventory, tasks };
}

function npmFindings(report, task, root, repository) {
  const lock = JSON.parse(readFileSync(join(root, task.target), 'utf8'));
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages) throw new Error('unsupported lock format');
  const entries = report.vulnerabilities;
  function advisories(entry, seen = new Set()) {
    if (seen.has(entry.name)) throw new Error('cyclic npm advisory chain');
    return entry.via.flatMap((via) => {
      if (typeof via !== 'string') return [via];
      if (!entries[via]) throw new Error('missing indirect npm advisory');
      return advisories(entries[via], new Set([...seen, entry.name]));
    });
  }
  return Object.values(entries).flatMap((entry) => {
    if (!Array.isArray(entry.nodes) || !entry.nodes.length) throw new Error('missing affected dependency paths');
    return entry.nodes.flatMap((path) => {
      const version = lock.packages[path]?.version;
      if (typeof version !== 'string' || !version) throw new Error('missing installed version');
      return advisories(entry).map((via) => {
        const aliases = [...new Set((via.url || '').match(/CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) || [])];
        if (!aliases.length && !Number.isInteger(via.source)) throw new Error('missing advisory identity');
        return { repository, scanner: 'npm', id: aliases[0] || `npm:${via.source}`, aliases,
          component: entry.name, path: `${task.target}#${path}`, version,
          range: entry.range, advisoryRange: via.range, severity: { info: 'UNKNOWN', moderate: 'MEDIUM' }[entry.severity] || entry.severity.toUpperCase(),
          fixedTarget: typeof entry.fixAvailable === 'object' ? entry.fixAvailable.version : null };
      });
    });
  });
}

export async function scanRepository({ root = '.', sourceSha, repository, contract, rows = [], run,
  today = new Date().toISOString().slice(0, 10) }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('immutable source SHA required');
  if (!repository || typeof run !== 'function') throw new Error('repository and scanner runner required');
  const { inventory, tasks } = planScan(root, contract);
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
  return { sourceSha, repository, scannedAt: new Date().toISOString(), inventory, surfaces,
    ...summarizeBacklog(findings, rows, { today, complete: coverageBlocked.length === 0, coverageBlocked }) };
}
