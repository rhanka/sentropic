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
    const unitKey = stableUnitKey({
      repository: finding.repository,
      repairClass: finding.repairClass,
      targets: [finding.component],
      fixedTarget: finding.fixedTarget,
    });
    if (!byTarget.has(unitKey)) byTarget.set(unitKey, { unitKey, findings: [], locks: new Set() });
    const unit = byTarget.get(unitKey);
    unit.findings.push(finding);
    for (const lock of finding.locks || [finding.path]) unit.locks.add(lock);
  }
  return [...byTarget.values()].map((unit) => ({ unitKey: unit.unitKey, findings: unit.findings, locks: [...unit.locks].sort() }));
}

export function batchLots(units = [], bounds = { maxUnits: 3, maxFiles: 10, maxLines: 150 }) {
  const sorted = [...units].sort((a, b) => (a.unitKey < b.unitKey ? -1 : 1));
  const lots = [];
  let current = { lotKey: '', units: [], files: 0, lines: 0 };
  const flush = () => { if (current.units.length) lots.push({ ...current, lotKey: current.units.map((u) => u.unitKey).sort().join('~') }); };
  for (const unit of sorted) {
    const files = unit.files ?? 1;
    const lines = unit.lines ?? 10;
    const overflows = current.units.length >= bounds.maxUnits || current.files + files > bounds.maxFiles || current.lines + lines > bounds.maxLines;
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

export function checkReconciliationStreak(scans = []) {
  if (scans.length < 2) return { ok: false, reason: 'need N=2 consecutive complete scans' };
  const last = scans.slice(-2);
  for (const scan of last) {
    if (!scan.complete || scan.findingsMatched > 0 || scan.gaps > 0) return { ok: false, reason: 'scan incomplete or finding present' };
    if (!scan.identicalFlags || !scan.surfaceCovered) return { ok: false, reason: 'flags or coverage changed' };
  }
  if (last[0].dbIdentity !== last[1].dbIdentity && last[0].dbChanged !== true) return { ok: false, reason: 'db identity drift' };
  return { ok: true };
}

export function validateContract(config = {}) {
  const errors = [];
  const need = (path, ok) => { if (!ok) errors.push(path); };
  need('severity.actionable', Array.isArray(config.severity?.actionable));
  need('inventory.images[3]', Array.isArray(config.inventory?.images) && config.inventory.images.length === 3);
  need('inventory.locks[root/UI/kit]', ['package-lock.json', 'ui/package-lock.json', 'docs/governance/kit/package-lock.json'].every((lock) => config.inventory?.locks?.includes(lock)));
  need('inventory.toolbox', config.inventory?.toolbox?.path === 'api/Dockerfile');
  need('register.baseline67', config.register?.baselineOutstanding === 67);
  need('automaticScope.allow', Array.isArray(config.automaticScope?.allow) && config.automaticScope.allow.length >= 3);
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
