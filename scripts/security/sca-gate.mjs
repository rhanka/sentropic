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

export function lockDirs(tracked) {
  return tracked.filter(f => /(^|\/)package-lock\.json$/.test(f) && !SKIP.test(f))
    .map(f => path.dirname(f)).filter(d => /^(\.|api|ui|e2e|apps\/|packages\/|tools\/)/.test(d)).sort();
}

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

export function registerMatch(entries, today, { ghsa, pkg, version }) {
  const hits = entries.filter(e => (e.source || '').toLowerCase().includes(ghsa.toLowerCase())
    && (!e.package || e.package === pkg) && (!e.affected_version || e.affected_version === version));
  const live = hits.find(e => e.review_due && e.review_due >= today);
  return { accepted: Boolean(live), expired: !live && hits.length > 0 };
}

const parse = v => v.split(/[-+]/)[0].split('.').map(n => parseInt(n, 10) || 0);
export function cmp(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
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
        title: via.title, ...registerMatch(entries, today, { ghsa, pkg: via.name || name, version }) });
    }
  }
  return findings;
}

async function advisoryFindings({ dir, pkgJson, lock, entries, today, token, repo }) {
  const findings = []; const errors = [];
  const direct = Object.keys(pkgJson.dependencies || {}).filter(p => CRITICAL_PACKAGES.includes(p));
  for (const pkg of direct) {
    const res = await fetch(`https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(pkg)}&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), 'User-Agent': `sca-gate/${repo || 'local'}` } }).catch(e => ({ ok: false, status: String(e) }));
    if (!res.ok) { errors.push(`${dir}: advisories ${pkg}: HTTP ${res.status}`); continue; }
    const advisories = await res.json();
    for (const adv of advisories) {
      if (adv.withdrawn_at) continue;
      for (const vul of adv.vulnerabilities || []) {
        if (vul.package?.name !== pkg || !['high', 'critical'].includes(adv.severity)) continue;
        for (const version of lockedVersions(lock, pkg)) {
          if (!inRange(version, vul.vulnerable_version_range)) continue;
          findings.push({ source: 'github-advisory', dir, package: pkg, version, ghsa: adv.ghsa_id, severity: adv.severity,
            title: adv.summary, range: vul.vulnerable_version_range, ...registerMatch(entries, today, { ghsa: adv.ghsa_id, pkg, version }) });
        }
      }
    }
  }
  return { findings, errors };
}

function walkLocks(root, rel = '') {
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
  const root = path.resolve(arg('root') || '.');
  const outDir = path.resolve(root, arg('out') || '.security');
  const today = process.env.SCA_GATE_TODAY || new Date().toISOString().slice(0, 10);
  const entries = parseRegister(readFileSync(path.join(root, '.security/vulnerability-register.yaml'), 'utf8'));
  const tracked = walkLocks(root);
  const dirs = lockDirs(tracked).filter(d => existsSync(path.join(root, d, 'package.json')));
  const findings = []; const errors = []; const warnings = [];
  for (const dir of dirs) {
    const lock = JSON.parse(readFileSync(path.join(root, dir, 'package-lock.json'), 'utf8'));
    const pkgJson = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
    const audit = auditDir(root, dir);
    if (audit.error) errors.push(`${dir}: ${audit.error}`); else findings.push(...auditFindings(dir, audit.json, lock, entries, today));
    const adv = await advisoryFindings({ dir, pkgJson, lock, entries, today, token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY });
    findings.push(...adv.findings);
    (mode === 'scheduled' ? errors : warnings).push(...adv.errors);
  }
  const seen = new Set();
  const unique = findings.filter(f => { const k = [f.dir, f.package, f.version, f.ghsa].join('|'); return !seen.has(k) && seen.add(k); });
  const failing = unique.filter(f => !f.accepted);
  const report = { mode, today, lockfiles: dirs, findings: unique, failing, errors, warnings };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'sca-gate.json'), JSON.stringify(report, null, 2));
  const md = ['# SCA gate findings', '', ...failing.map(f => `- **${f.severity}** \`${f.package}@${f.version}\` (${f.dir}) ${f.ghsa}: ${f.title}${f.expired ? ' [register entry EXPIRED]' : ''}`),
    ...errors.map(e => `- ERROR ${e}`)].join('\n');
  writeFileSync(path.join(outDir, 'sca-gate-issue.md'), md + '\n');
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const f of failing) console.log(`::error::${f.severity} ${f.package}@${f.version} (${f.dir}) ${f.ghsa} ${f.title}${f.expired ? ' [register expired]' : ''}`);
  for (const e of errors) console.log(`::error::${e}`);
  console.log(`sca-gate: ${dirs.length} lockfiles, ${unique.length} findings, ${failing.length} unregistered, ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(failing.length || errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
