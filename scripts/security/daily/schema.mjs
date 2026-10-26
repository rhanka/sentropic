// S1 contract schema: validates security-fix.json and core queue primitives.
// Pure, dependency-free (node builtins only). See .security/security-fix.json.
import { readFileSync } from 'node:fs';

export const ACTIONABLE = new Set(['HIGH', 'CRITICAL']);
export const INFORMATIONAL = new Set(['MEDIUM', 'LOW']);

export function isActionable(severity) {
  return ACTIONABLE.has(String(severity).toUpperCase());
}

export function canonicalAliases(input = {}) {
  const out = new Set();
  for (const key of ['ghsa', 'cve', 'aliases']) {
    const value = input[key];
    if (!value) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      const text = String(item).trim().toUpperCase();
      if (text) out.add(text);
    }
  }
  return [...out].sort();
}

export function stableFindingKey({ repository, aliases, component, path }) {
  if (!repository || !component || !path) throw new Error('finding key requires repository, component and path');
  const aliasPart = canonicalAliases(aliases).join('+') || 'NOALIAS';
  return [repository, aliasPart, component, path].join('|');
}

export function stableUnitKey({ repository, repairClass, targets, fixedTarget }) {
  if (!repository || !repairClass || !fixedTarget) throw new Error('unit key requires repository, repairClass and fixedTarget');
  const targetPart = [...new Set(targets || [])].sort().join(',');
  return [repository, repairClass, targetPart, fixedTarget].join('|');
}

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

// Rows are normalized scanner identities, not the compliance verdict or register key alone.
export function joinRegister(finding, rows = [], today = new Date().toISOString().slice(0, 10)) {
  if (!validDate(today)) throw new Error('invalid inventory date');
  const match = rows.find((row) => row.status === 'accepted_temporary' && validDate(row.review_due) &&
    finding.id && row.id === finding.id &&
    ['component', 'path', 'version', 'scanner'].every((key) =>
      typeof finding[key] === 'string' && finding[key].length > 0 && row[key] === finding[key]) &&
    ['platform', 'imageDigest', 'repository'].every((key) =>
      (!finding[key] && !row[key]) || (key === 'repository' && !row[key]) || row[key] === finding[key]));
  if (!match) return { ...finding, queue: 'queued', register: 'none' };
  const expired = today > match.review_due;
  return { ...finding, queue: 'queued', register: 'registered-exception', review_due: match.review_due, expired };
}

export function groupFindings(findings = []) {
  const byTarget = new Map();
  for (const finding of findings) {
    const { repository, repairClass, component, fixedTarget, platform, imageLineage, defectIdentity } = finding;
    if (![repository, repairClass, component, finding.path].every((value) => typeof value === 'string' && value)) {
      throw new Error('finding requires repository, repair class, component and path');
    }
    const key = JSON.stringify([repository, repairClass, component, fixedTarget, platform, imageLineage, defectIdentity]);
    if (!byTarget.has(key)) byTarget.set(key, { repository, repairClass, component, fixedTarget,
      platform, imageLineage, defectIdentity, findings: [], locks: new Set() });
    const unit = byTarget.get(key);
    unit.findings.push(finding);
    for (const lock of finding.locks || [finding.path]) unit.locks.add(lock);
  }
  return [...byTarget.values()].map((unit) => ({ ...unit,
    state: unit.fixedTarget ? 'queued' : 'no-upstream-fix',
    unitKey: stableUnitKey({ ...unit, fixedTarget: unit.fixedTarget || 'no-upstream-fix',
      targets: [unit.component, ...unit.locks, unit.platform || '', unit.imageLineage || '', unit.defectIdentity || ''].filter(Boolean) }),
    locks: [...unit.locks].sort(),
  }));
}

export function batchLots(units = [], bounds = { maxUnits: 3, maxFiles: 10, maxLines: 150 }) {
  for (const [key, maximum] of Object.entries({ maxUnits: 3, maxFiles: 10, maxLines: 150 })) {
    if (!Number.isInteger(bounds[key]) || bounds[key] < 1 || bounds[key] > maximum) throw new Error('invalid lot bounds');
  }
  const priority = (unit) => {
    const ranks = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
    const findings = unit.findings || [];
    return [Math.min(4, ...findings.map((f) => ranks[String(f.severity).toUpperCase()] ?? 4)),
      findings.map((f) => f.review_due || '9999-12-31').sort()[0] || '9999-12-31',
      findings.map((f) => f.firstSeen || '9999-12-31').sort()[0] || '9999-12-31', unit.unitKey].join('|');
  };
  const sorted = [...units].sort((a, b) => priority(a).localeCompare(priority(b)));
  const seen = new Set();
  const lots = [];
  let current = { lotKey: '', units: [], files: 0, lines: 0 };
  const flush = () => { if (current.units.length) lots.push({ ...current, lotKey: current.units.map((u) => u.unitKey).sort().join('~') }); };
  for (const unit of sorted) {
    const { files, lines, repository, repairClass, unitKey } = unit;
    if (!repository || !repairClass || !unitKey || seen.has(unitKey)) throw new Error('missing or duplicate unit identity');
    seen.add(unitKey);
    if (unit.state === 'no-upstream-fix') throw new Error('no upstream fix; keep unit queued');
    if (!Number.isInteger(files) || files < 1 || !Number.isInteger(lines) || lines < 1) throw new Error('missing unit estimate');
    if (files > bounds.maxFiles || lines > bounds.maxLines) throw new Error('unit exceeds lot bounds');
    const first = current.units[0];
    const incompatible = first && (first.repository !== repository || first.repairClass !== repairClass);
    const overflows = incompatible || current.units.length >= bounds.maxUnits || current.files + files > bounds.maxFiles || current.lines + lines > bounds.maxLines;
    if (overflows) { flush(); current = { lotKey: '', units: [], files: 0, lines: 0 }; }
    current.units.push(unit);
    current.files += files;
    current.lines += lines;
  }
  flush();
  return lots;
}

export function classifyBumpGate({ alreadyPublished, dependencySectionChanged }) {
  if (alreadyPublished && dependencySectionChanged) return 'manual';
  return 'automatic-eligible';
}

export function checkReconciliationStreak(scans = [], target) {
  const refuse = (reason) => ({ ok: false, reason });
  if (scans.length < 2) return { ok: false, reason: 'need N=2 consecutive complete scans' };
  if (!target || !['surface', 'platform', 'path', 'imageLineage'].every((key) =>
    typeof target[key] === 'string' && target[key])) return refuse('missing exact registered coverage target');
  const last = scans.slice(-2);
  for (const scan of last) {
    if (scan?.kind !== 'daily-full' || scan.complete !== true || scan.findingsMatched !== 0 || scan.gaps !== 0) {
      return refuse('scan incomplete or finding present');
    }
    if (!validDate(scan.day) || typeof scan.scanId !== 'string' || !scan.scanId ||
        !/^[a-f0-9]{40}$/.test(scan.sourceSha || '') || !/^sha256:[a-f0-9]{64}$/.test(scan.dbIdentity || '') ||
        !scan.scannerIdentity || !scan.policyIdentity || !Array.isArray(scan.flags) || !scan.flags.length) {
      return refuse('missing immutable scan, scanner, database or policy identity');
    }
    const scanned = Date.parse(scan.scannedAt), updated = Date.parse(scan.dbUpdatedAt);
    if (!Number.isFinite(scanned) || !Number.isFinite(updated) ||
        new Date(scanned).toISOString().slice(0, 10) !== scan.day || updated > scanned || scanned - updated > 86400000) {
      return refuse('invalid or stale database timestamps');
    }
    if (!Array.isArray(scan.coverage) || !scan.coverage.some((entry) =>
      Object.keys(target).every((key) => entry[key] === target[key]) && /^sha256:[a-f0-9]{64}$/.test(entry.imageDigest || ''))) {
      return refuse('registered surface, lineage, platform or path not covered');
    }
  }
  if (Date.parse(last[1].day) - Date.parse(last[0].day) !== 86400000 || last[0].scanId === last[1].scanId) {
    return refuse('need distinct consecutive daily full scans');
  }
  for (const field of ['scannerIdentity', 'policyIdentity', 'flags']) {
    if (JSON.stringify(last[0][field]) !== JSON.stringify(last[1][field])) return refuse(`${field} changed; reset streak`);
  }
  return { ok: true };
}

export function validateContract(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: false, errors: ['contract object'] };
  const errors = [];
  const need = (path, ok) => { if (!ok) errors.push(path); };
  need('severity.actionable', JSON.stringify(config.severity?.actionable) === '["HIGH","CRITICAL"]');
  need('severity.inventory', JSON.stringify(config.severity?.inventory) === '["UNKNOWN","LOW","MEDIUM","HIGH","CRITICAL"]');
  need('severity.raw', config.severity?.rawMeansBeforeSuppression === true && config.severity?.identicalFlagsRequired === true);
  need('inventory.images[3]', Array.isArray(config.inventory?.images) && config.inventory.images.length === 3);
  need('inventory.locks[root/UI/kit]', ['package-lock.json', 'ui/package-lock.json', 'docs/governance/kit/package-lock.json'].every((lock) => config.inventory?.locks?.includes(lock)));
  need('inventory.toolbox', config.inventory?.toolbox?.path === 'api/Dockerfile');
  need('register.baseline67', config.register?.baselineOutstanding === 67);
  need('automaticScope.allow', Array.isArray(config.automaticScope?.allow) && config.automaticScope.allow.length >= 3);
  need('automaticScope.ownCode', config.automaticScope?.ownCode?.enabled === false &&
    ['sourcePaths', 'testPaths', 'patchVersionFields'].every((key) => Array.isArray(config.automaticScope?.ownCode?.[key]) && config.automaticScope.ownCode[key].length === 0));
  need('automaticScope.reconciliation', config.automaticScope?.reconciliation?.removalOnly === true && config.automaticScope?.reconciliation?.separateLot === true);
  need('automaticScope.register', config.automaticScope?.registerByteIdenticalOnRepairs === true);
  need('grouping.bounds', JSON.stringify(config.grouping?.lotBounds) === '{"maxUnits":3,"maxFiles":10,"maxLines":150}');
  need('derivedPins.l5-root-lock', Boolean(config.derivedPins?.['l5-root-lock']));
  need('credentials.reader', typeof config.credentials?.reader === 'string' && config.credentials.reader.includes('Variables'));
  need('bumpGateManual', typeof config.bumpGateManual?.rule === 'string');
  need('reconciliation.scansRequired=2', config.reconciliation?.scansRequired === 2);
  need('limits.2pr', config.limits?.newPRsPerDayFleet === 2);
  need('runtime.public', typeof config.runtime === 'string' && config.runtime.includes('no private'));
  need('credentials.publicRepo', config.credentials?.killSwitchRepo === 'rhanka/sentropic');
  return { ok: errors.length === 0, errors };
}

export function loadContract(path = '.security/security-fix.json') {
  return JSON.parse(readFileSync(path, 'utf8'));
}
