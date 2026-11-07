#!/usr/bin/env node
// SCA gate: (1) `npm audit` over every tracked runtime lockfile, (2) GitHub advisory
// check for a short allowlist of server-critical direct dependencies (covers advisories
// not yet served by the npm audit endpoint). HIGH/CRITICAL findings fail unless a matching,
// unexpired entry exists in .security/vulnerability-register.yaml.
// Runs only behind `make test-security-sca-gate` (admitted node image, no host npm).
// Usage: node scripts/security/sca-gate.mjs --mode=pr|scheduled [--root=/workspace] [--out=.security]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CRITICAL_PACKAGES = ['hono', '@hono/node-server', '@hono/zod-validator', 'hono-rate-limiter',
  'jose', '@simplewebauthn/server', 'pg', 'express', 'nodemailer', '@modelcontextprotocol/sdk',
  '@xmldom/xmldom', 'arctic'];
const BLOCKING = new Set(['high', 'critical']);
const SKIP = /(^|\/)(node_modules|tests?|fixtures|lock-snapshots|toolchain|docs)\//;

// Every package-lock.json is audited except frozen/fixture/doc locks (SKIP). No directory
// allowlist: a lock added under a new top-level directory is covered by default.
export function lockDirs(tracked) {
  return lockPartition(tracked).covered;
}

export function lockPartition(tracked) {
  const locks = tracked.filter(f => /(^|\/)package-lock\.json$/.test(f));
  return {
    covered: locks.filter(f => !SKIP.test(f)).map(f => path.dirname(f)).sort(),
    excluded: locks.filter(f => SKIP.test(f)).sort(),
  };
}

export const componentOf = dir => (dir === '.' ? 'root' : dir);

// Third-party text reaches workflow commands and issue text: strip control newlines, defuse `::`.
export function clean(text) {
  return String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/::/g, ': :');
}

// Whole templates go through clean(): no raw field can reach an annotation or the issue body.
export const issueLine = f => clean(`- **${f.severity}** \`${f.package}@${f.version}\` (${f.dir}) ${f.ghsa}: ${f.title}${f.expired ? ' [register entry EXPIRED]' : ''}`);
export const errorAnnotation = f => `::error::${clean(`${f.severity} ${f.package}@${f.version} (${f.dir}) ${f.ghsa} ${f.title}${f.expired ? ' [register expired]' : ''}`)}`;
export const manifestWarning = dir => `::warning::${clean(`covered lock ${dir}/package-lock.json has no sibling package.json: not audited`)}`;

// Minimal parser for the flat register schema (4-space ids, 6-space scalar fields).
export function parseRegister(text) {
  const entries = [];
  let cur = null;
  let inVulns = false;
  for (const line of text.split('\n')) {
    if (/^ {2}vulnerabilities:/.test(line)) { inVulns = true; continue; }
    if (!inVulns) continue;
    const id = line.match(/^ {4}([^\s#:][^:]*):\s*$/);
    if (id) { cur = { id: id[1] }; entries.push(cur); continue; }
    const field = line.match(/^ {6}([a-z_]+):\s*(.*)$/);
    if (field && cur) cur[field[1]] = field[2].replace(/^["']|["']$/g, '');
  }
  return entries;
}

export function registerMatch(entries, today, { ghsa, pkg, version, dir }) {
  if (!ghsa) return { accepted: false, expired: false };
  const hits = entries.filter(e => (e.source || '').toLowerCase().includes(ghsa.toLowerCase())
    && e.component === componentOf(dir)
    && (!e.package || e.package === pkg) && (!e.affected_version || e.affected_version === version));
  const live = hits.find(e => e.review_due && e.review_due >= today);
  return { accepted: Boolean(live), expired: !live && hits.length > 0 };
}

const parse = v => v.split('+')[0].split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
const pre = v => { const i = v.split('+')[0].indexOf('-'); return i < 0 ? [] : v.split('+')[0].slice(i + 1).split('.'); };
// Semver order including prerelease: 4.13.17-rc.1 < 4.13.17.
export function cmp(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  const [p, q] = [pre(a), pre(b)];
  if (!p.length && !q.length) return 0;
  if (!p.length) return 1;
  if (!q.length) return -1;
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const [n, m] = [/^\d+$/.test(p[i]), /^\d+$/.test(q[i])];
    if (n && m) { if (+p[i] !== +q[i]) return +p[i] < +q[i] ? -1 : 1; continue; }
    if (n !== m) return n ? -1 : 1;
    if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}
// Handles ">= a, < b", "< b", "= a", "<= b", "> a".
export function inRange(version, range) {
  if (!range) return false;
  return range.split(',').map(s => s.trim()).filter(Boolean).every(part => {
    const m = part.match(/^(>=|<=|>|<|=)?\s*([0-9][^\s]*)$/);
    if (!m) return false;
    const c = cmp(version, m[2]);
    return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0, undefined: c === 0 }[m[1]];
  });
}

function lockedVersions(lock, pkg) {
  const out = new Set();
  for (const [k, v] of Object.entries(lock.packages || {})) {
    if ((k === `node_modules/${pkg}` || k.endsWith(`/node_modules/${pkg}`)) && v.version && !v.dev) out.add(v.version);
  }
  return [...out];
}

function auditDir(root, dir) {
  const cwd = path.join(root, dir);
  const r = spawnSync('npm', ['audit', '--package-lock-only', '--omit=dev', '--audit-level=high', '--json'],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, npm_config_update_notifier: 'false' } });
  let json;
  try { json = JSON.parse(r.stdout); } catch { return { dir, error: `npm audit produced no JSON (exit ${r.status}): ${(r.stderr || '').slice(0, 300)}` }; }
  if (json.error) return { dir, error: `${json.error.code}: ${json.error.summary}` };
  return { dir, json };
}

export function auditFindings(dir, json, lock, entries, today) {
  const findings = [];
  for (const [name, v] of Object.entries(json.vulnerabilities || {})) {
    for (const via of v.via || []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const ghsa = (via.url || '').split('/').pop();
      const versions = lockedVersions(lock, via.name || name);
      const version = versions.find(x => inRange(x, via.range)) || versions[0] || '';
      findings.push({ source: 'npm-audit', dir, package: via.name || name, version, ghsa, severity: via.severity,
        title: via.title, ...registerMatch(entries, today, { ghsa, pkg: via.name || name, version, dir }) });
    }
  }
  return findings;
}

const MAX_PAGES = 20;
const PAGE_SIZE = 100;

export async function advisoryFindings({ dir, pkgJson, lock, entries, today, token, repo, fetchFn = fetch }) {
  const findings = []; const errors = [];
  const direct = Object.keys(pkgJson.dependencies || {}).filter(p => CRITICAL_PACKAGES.includes(p));
  for (const pkg of direct) {
    const advisories = []; let failed = false;
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) { errors.push(`${dir}: advisories ${pkg}: more than ${MAX_PAGES} pages`); failed = true; break; }
      const res = await fetchFn(`https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(pkg)}&per_page=${PAGE_SIZE}&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}), 'User-Agent': `sca-gate/${repo || 'local'}` } }).catch(e => ({ ok: false, status: String(e) }));
      if (!res.ok) { errors.push(`${dir}: advisories ${pkg}: HTTP ${res.status}`); failed = true; break; }
      const batch = await res.json();
      advisories.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    if (failed) continue;
    for (const adv of advisories) {
      if (adv.withdrawn_at) continue;
      for (const vul of adv.vulnerabilities || []) {
        if (vul.package?.name !== pkg || !['high', 'critical'].includes(adv.severity)) continue;
        for (const version of lockedVersions(lock, pkg)) {
          if (!inRange(version, vul.vulnerable_version_range)) continue;
          findings.push({ source: 'github-advisory', dir, package: pkg, version, ghsa: adv.ghsa_id, severity: adv.severity,
            title: adv.summary, range: vul.vulnerable_version_range, ...registerMatch(entries, today, { ghsa: adv.ghsa_id, pkg, version, dir }) });
        }
      }
    }
  }
  return { findings, errors };
}

// Scheduled runs fail closed on advisory API errors; PR runs only warn.
export function routeAdvisoryErrors(mode, advisoryErrors) {
  return mode === 'scheduled' ? { errors: advisoryErrors, warnings: [] } : { errors: [], warnings: advisoryErrors };
}

export const MODES = ['pr', 'scheduled'];

export function walkLocks(root, rel = '') {
  const out = [];
  for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (['node_modules', '.git', '.tmp', 'tmp', '.security'].includes(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkLocks(root, r));
    else if (e.name === 'package-lock.json') out.push(r);
  }
  return out;
}

async function main() {
  const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
  const mode = arg('mode') || 'pr';
  if (!MODES.includes(mode)) { console.error(`sca-gate: unknown --mode=${mode} (expected ${MODES.join('|')})`); process.exit(2); }
  const root = path.resolve(arg('root') || '.');
  const outDir = path.resolve(root, arg('out') || '.security');
  const today = process.env.SCA_GATE_TODAY || new Date().toISOString().slice(0, 10);
  const entries = parseRegister(readFileSync(path.join(root, '.security/vulnerability-register.yaml'), 'utf8'));
  const tracked = walkLocks(root);
  const { covered, excluded } = lockPartition(tracked);
  const dirs = covered.filter(d => existsSync(path.join(root, d, 'package.json')));
  const noManifest = covered.filter(d => !dirs.includes(d));
  const findings = []; const errors = []; const warnings = [];
  for (const dir of dirs) {
    const lock = JSON.parse(readFileSync(path.join(root, dir, 'package-lock.json'), 'utf8'));
    const pkgJson = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
    const audit = auditDir(root, dir);
    if (audit.error) errors.push(`${dir}: ${audit.error}`); else findings.push(...auditFindings(dir, audit.json, lock, entries, today));
    const adv = await advisoryFindings({ dir, pkgJson, lock, entries, today, token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY });
    findings.push(...adv.findings);
    const routed = routeAdvisoryErrors(mode, adv.errors);
    errors.push(...routed.errors); warnings.push(...routed.warnings);
  }
  const seen = new Set();
  const unique = findings.filter(f => { const k = [f.dir, f.package, f.version, f.ghsa].join('|'); return !seen.has(k) && seen.add(k); });
  const failing = unique.filter(f => !f.accepted);
  const report = { mode, today, lockfiles: dirs, excludedLocks: excluded, locksWithoutManifest: noManifest, findings: unique, failing, errors, warnings };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'sca-gate.json'), JSON.stringify(report, null, 2));
  const md = ['# SCA gate findings', '', ...failing.map(issueLine),
    ...errors.map(e => `- ERROR ${clean(e)}`)].join('\n');
  writeFileSync(path.join(outDir, 'sca-gate-issue.md'), md + '\n');
  for (const w of warnings) console.log(`::warning::${clean(w)}`);
  for (const d of noManifest) console.log(manifestWarning(d));
  for (const f of failing) console.log(errorAnnotation(f));
  for (const e of errors) console.log(`::error::${clean(e)}`);
  console.log(`sca-gate: ${dirs.length} lockfiles (${excluded.length} excluded by policy, ${noManifest.length} without manifest), ${unique.length} findings, ${failing.length} unregistered, ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(failing.length || errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
