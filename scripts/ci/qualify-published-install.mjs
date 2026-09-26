#!/usr/bin/env node
// Clean out-of-monorepo consumer install + entry-point import probe (spec section 10).
// Runs only via `make qualify-published-install` in a fresh $(LLM_MESH_NODE_IMAGE) container with
// no repository mount: only this probe, the shared guard module, input archives and /reports.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GuardError, REGISTRY, checkManifest, createRegistry, loadSemver, readPackedManifest, sha256File, waitBudget, waitForVersion,
} from './publishable-manifests.mjs';

const EXACT_PKG = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@([^@\s]+)$/;
const RUNTIME_CONDITIONS = ['node', 'import', 'require', 'default'];
const RUNTIME_EXT = /\.(?:m?js|cjs|json|node)$/;

export function parseExactSpec(spec, semver = loadSemver()) {
  const match = typeof spec === 'string' ? spec.match(EXACT_PKG) : null;
  if (!match || semver.valid(match[2]) === null || semver.clean(match[2]) !== match[2]) {
    throw new GuardError(`expected <name>@<exact-version>, got ${JSON.stringify(spec)} (no tags, ranges or protocols)`);
  }
  return { name: match[1], version: match[2] };
}

// Entry points from the installed manifest: [{ subpath, specifier, conditions, status }].
export function entryPoints(manifest) {
  const { name } = manifest;
  const spec = (subpath) => (subpath === '.' ? name : `${name}/${subpath.slice(2)}`);
  let exportsField = manifest.exports;
  if (exportsField === undefined) return [{ subpath: '.', specifier: name, conditions: ['main'], status: 'runtime', require: !/\.mjs$/.test(manifest.main ?? '') && manifest.type !== 'module' }];
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) exportsField = { '.': exportsField };
  else if (!Object.keys(exportsField).every((k) => k.startsWith('.'))) exportsField = { '.': exportsField };
  const entries = [];
  for (const [subpath, target] of Object.entries(exportsField)) {
    const conditions = new Set();
    const targets = [];
    const walk = (t, cond) => {
      if (typeof t === 'string') targets.push({ cond, target: t });
      else if (Array.isArray(t)) t.forEach((x) => walk(x, cond));
      else if (t && typeof t === 'object') for (const [k, v] of Object.entries(t)) { conditions.add(k); walk(v, k); }
    };
    walk(target, 'default');
    if (typeof target === 'string') conditions.add('default');
    const runtime = targets.filter((t) => RUNTIME_CONDITIONS.includes(t.cond));
    const entry = { subpath, specifier: spec(subpath), conditions: [...conditions], require: conditions.has('require') };
    if (subpath.includes('*')) entry.status = 'unsupported: wildcard export';
    else if (target === null) entry.status = 'blocked-export';
    else if (runtime.length === 0 && [...conditions].every((c) => c === 'types')) entry.status = 'types-only';
    else if (runtime.length === 0) entry.status = `unsupported: no Node runtime condition (${[...conditions].join(', ')})`;
    else if (!runtime.every((t) => RUNTIME_EXT.test(t.target))) entry.status = `unsupported: non-JavaScript target ${runtime.map((t) => t.target).join(', ')}`;
    else entry.status = 'runtime';
    entries.push(entry);
  }
  return entries;
}

function cleanEnv(consumer, registry) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(npm_|NPM_|NODE_PATH$|NODE_OPTIONS$|MANIFEST_)/.test(k)) continue;
    env[k] = v;
  }
  const empty = path.join(consumer.tools, 'empty-user-npmrc');
  const emptyGlobal = path.join(consumer.tools, 'empty-global-npmrc');
  fs.writeFileSync(empty, '');
  fs.writeFileSync(emptyGlobal, '');
  return {
    ...env,
    HOME: consumer.tools,
    npm_config_cache: path.join(consumer.tools, 'npm-cache'),
    npm_config_userconfig: empty,
    npm_config_globalconfig: emptyGlobal,
    npm_config_registry: registry,
    npm_config_update_notifier: 'false',
    // Revalidate registry metadata instead of trusting a cached packument (post-publication lag).
    npm_config_prefer_online: 'true',
  };
}

// npm install output of a version the registry (or its CDN) does not serve yet; retried within the wait budget.
export const registryNotVisible = (output) =>
  /\b(?:ETARGET|E404)\b|\bnotarget\b|No matching version found|is not in this registry|404 Not Found/i.test(output);

function run(cmd, args, { cwd, env, log, timeout = 600_000 }) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const text = `$ ${cmd} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}\n[exit ${result.status}${result.signal ? ` signal ${result.signal}` : ''}]\n`;
  if (log) fs.appendFileSync(log, text);
  return { status: result.error ? 1 : result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, error: result.error?.message };
}

// Detects a confirmed-missing @sentropic sibling version in npm install output.
export function missingSibling(output) {
  const m = output.match(/No matching version found for (@sentropic\/[a-z0-9._-]+)@(\S+?)\.?\s/) ??
    output.match(/'(@sentropic\/[a-z0-9._-]+)@([^'\s]+)' is not in this registry/) ??
    output.match(/404 Not Found - GET \S+\/(@sentropic(?:%2f|\/)[a-z0-9._-]+)\b/i);
  if (!m) return null;
  return { name: decodeURIComponent(m[1]).replace('%2f', '/'), range: m[2] ?? '*' };
}

async function confirmMissing(registry, { name, range }, semver) {
  const doc = await registry.packument(name, { fresh: true });
  if (doc === null) return true;
  return !Object.keys(doc.versions).some((v) => range === '*' || semver.satisfies(v, range, { includePrerelease: true }));
}

// Same-PR sibling receipts: a dedicated read-only directory holding receipts.json and only its archives.
export function loadSiblings(dir, { headSha, semver = loadSemver() }) {
  const receiptsPath = path.join(dir, 'receipts.json');
  let receipts;
  try {
    receipts = JSON.parse(fs.readFileSync(receiptsPath, 'utf8'));
  } catch (error) {
    throw new GuardError(`unreadable sibling receipts ${receiptsPath}: ${error.message}`);
  }
  if (!Array.isArray(receipts)) throw new GuardError('sibling receipts must be a JSON array');
  const listed = new Set();
  const siblings = receipts.map((r) => {
    if (r?.guard !== 'pass' || r?.manifest_mode !== 'block' || r?.evidence !== 'release-candidate') {
      throw new GuardError(`sibling receipt for ${r?.name} is not a passing BLOCK release-candidate guard receipt`);
    }
    if (typeof r.file !== 'string' || r.file.includes('..') || path.isAbsolute(r.file)) throw new GuardError(`invalid sibling archive path ${r.file}`);
    const file = path.join(dir, r.file);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new GuardError(`sibling archive is missing or not a regular file: ${r.file}`);
    if (sha256File(file) !== r.sha256) throw new GuardError(`sibling archive hash mismatch for ${r.name}@${r.version}`);
    if (headSha && r.head_sha !== headSha) throw new GuardError(`sibling ${r.name} was packed from ${r.head_sha}, not head ${headSha}`);
    const manifest = readPackedManifest(fs.readFileSync(file));
    if (manifest.name !== r.name || manifest.version !== r.version) throw new GuardError(`sibling identity mismatch: receipt ${r.name}@${r.version}, packed ${manifest.name}@${manifest.version}`);
    const check = checkManifest(manifest, semver);
    if (check.structural.length || check.violations.length) throw new GuardError(`sibling ${r.name}@${r.version} fails the packed-manifest guard`);
    listed.add(path.resolve(file));
    return { name: r.name, version: r.version, file, sha256: r.sha256, manifest };
  });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const extra of walk(dir).filter((f) => f.endsWith('.tgz') && !listed.has(path.resolve(f)))) {
    throw new GuardError(`unlisted archive in sibling directory: ${path.relative(dir, extra)}`);
  }
  return siblings;
}

// Every declared edge (runtime, required/optional peer) towards a supplied sibling must accept its version.
export function checkSiblingRanges(manifests, siblings, semver = loadSemver()) {
  const edges = [];
  for (const m of manifests) {
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const sib of siblings) {
        const range = m[section]?.[sib.name];
        if (range === undefined) continue;
        const ok = semver.satisfies(sib.version, range, { includePrerelease: true });
        edges.push({ from: `${m.name}@${m.version}`, section, to: sib.name, range, version: sib.version, ok });
        if (!ok) throw new GuardError(`${m.name}@${m.version} ${section}["${sib.name}"] = ${range} does not accept same-PR sibling ${sib.version}`);
      }
    }
  }
  return edges;
}

function symlinkEscapes(root) {
  const escapes = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) {
        const real = fs.realpathSync(p);
        if (!real.startsWith(`${root}${path.sep}`)) escapes.push(`${path.relative(root, p)} -> ${real}`);
      } else if (e.isDirectory()) walk(p);
    }
  };
  if (fs.existsSync(path.join(root, 'node_modules'))) walk(path.join(root, 'node_modules'));
  return escapes;
}

function importEntry(consumer, entry, env, log) {
  const results = [];
  const runner = path.join(consumer.dir, '.qualify-import.mjs');
  fs.writeFileSync(runner, "const spec = process.argv[2];\nif (process.argv[3] === 'require') { const { createRequire } = await import('node:module'); createRequire(import.meta.url)(spec); } else { await import(spec); }\nconsole.log('imported', spec);\n");
  for (const mode of entry.require ? ['import', 'require'] : ['import']) {
    const r = run(process.execPath, [runner, entry.specifier, mode], { cwd: consumer.dir, env, log, timeout: 60_000 });
    results.push({ specifier: entry.specifier, mode, ok: r.status === 0, detail: r.status === 0 ? 'imported' : (r.error ?? r.output.trim().split('\n').slice(-5).join(' | ')) });
  }
  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tarball publishing records no gitHead: the SLSA v1 provenance statement (npm attestations endpoint)
// must name the workflow commit as its only source commit and the published tarball as its subject.
export const SLSA_V1 = 'https://slsa.dev/provenance/v1';
export function checkProvenance(doc, { name, version, integrity, commit }) {
  const problems = [];
  const bundle = (doc?.attestations ?? []).find((a) => a?.predicateType === SLSA_V1);
  if (!bundle) return { problems: [`no SLSA v1 provenance attestation for ${name}@${version}`], sourceCommits: [] };
  let statement;
  try {
    statement = JSON.parse(Buffer.from(bundle.bundle?.dsseEnvelope?.payload ?? '', 'base64').toString('utf8'));
  } catch (error) {
    return { problems: [`unreadable SLSA provenance payload for ${name}@${version}: ${error.message}`], sourceCommits: [] };
  }
  const sourceCommits = (statement?.predicate?.buildDefinition?.resolvedDependencies ?? []).map((d) => d?.digest?.gitCommit).filter(Boolean);
  if (sourceCommits.length === 0) problems.push(`SLSA provenance of ${name}@${version} names no source gitCommit`);
  else if (!sourceCommits.every((c) => c === commit)) problems.push(`SLSA provenance source commit ${sourceCommits.join(',')} differs from the workflow commit ${commit}`);
  const match = typeof integrity === 'string' && integrity.match(/^sha512-([A-Za-z0-9+/=]+)$/);
  const digest = match ? Buffer.from(match[1], 'base64').toString('hex') : null;
  const subjectName = `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
  if (!(statement?.subject ?? []).some((s) => s?.name === subjectName && digest && s?.digest?.sha512 === digest)) {
    problems.push(`SLSA provenance subject does not match ${subjectName} with the published sha512`);
  }
  return { problems, sourceCommits };
}
const lockEntries = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).packages ?? {};
  } catch {
    return {};
  }
};
const tree = (consumer, env, log) => {
  const r = run('npm', ['ls', '--all', '--json'], { cwd: consumer.dir, env, log });
  try { return JSON.parse(r.output.slice(r.output.indexOf('{'))); } catch { return { unparsable: r.output.slice(0, 2000) }; }
};

export async function qualify(opts) {
  const semver = loadSemver();
  const registryUrl = opts.registry ?? REGISTRY;
  const registry = opts.registryClient ?? createRegistry({ registry: registryUrl });
  const mode = opts.mode ?? (opts.tarball ? 'candidate' : 'published');
  if (!['candidate', 'published', 'post-publication'].includes(mode)) throw new GuardError(`unknown mode ${mode}`);
  if (Boolean(opts.pkg) === Boolean(opts.tarball)) throw new GuardError('exactly one of PKG=<name>@<exact-version> or TARBALL=<path> is required');
  if (opts.siblingsDir && (opts.pkg || mode !== 'candidate')) throw new GuardError('sibling injection is restricted to TARBALL candidate qualification');
  if (opts.provenanceCommit) {
    if (!/^[0-9a-f]{40}$/.test(opts.provenanceCommit)) throw new GuardError(`provenance commit must be a 40-hex git SHA, got ${JSON.stringify(opts.provenanceCommit)}`);
    if (!opts.pkg || mode !== 'post-publication') throw new GuardError('provenance check is restricted to PKG post-publication qualification');
  }
  // Post-publication waits share the registry visibility budget (default 18 x 10 s); other modes never wait.
  const budget = waitBudget({ attempts: opts.attempts, delaySeconds: opts.delaySeconds });
  const attempts = mode === 'post-publication' ? budget.attempts : 1;
  const delayMs = budget.delaySeconds * 1000;
  const reportDir = opts.reportDir;
  fs.mkdirSync(reportDir, { recursive: true });
  const log = path.join(reportDir, 'qualify.log');
  fs.writeFileSync(log, '');
  const report = {
    requested: opts.pkg ?? opts.tarball, mode, registry: registryUrl, date: new Date().toISOString(),
    commit: opts.headSha ?? null, job: opts.job ?? null, image: opts.image ?? null, node: process.version,
    status: 'fail', entrypoints: [], peersAdded: [], siblings: [], overrides: {}, problems: [],
  };
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'qualify-tools-'));
  const consumer = { dir: path.join(os.tmpdir(), `consumer-${randomBytes(6).toString('hex')}`), tools };
  const finish = (status) => {
    report.status = status;
    fs.writeFileSync(path.join(reportDir, 'qualify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const lines = [`qualify-published-install: ${status.toUpperCase()} ${report.resolved ? `${report.resolved.name}@${report.resolved.version}` : report.requested} (${mode})`,
      ...report.entrypoints.map((e) => `  ${e.ok ? 'PASS' : 'FAIL'} ${e.phase} ${e.mode} ${e.specifier}${e.ok ? '' : ` :: ${e.detail}`}`),
      ...report.problems.map((p) => `  PROBLEM ${p}`)];
    fs.writeFileSync(path.join(reportDir, 'qualify-summary.txt'), `${lines.join('\n')}\n`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return status === 'pass' || (status === 'pending-sibling-publish' && mode === 'candidate') ? 0 : 1;
  };
  try {
    fs.mkdirSync(consumer.dir);
    fs.writeFileSync(path.join(consumer.dir, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    const env = cleanEnv(consumer, registryUrl);
    report.npm = run('npm', ['--version'], { cwd: consumer.dir, env }).output.trim();
    report.consumer = consumer.dir;
    // ---- resolve and inspect the primary input
    let installSpec;
    let primary;
    if (opts.pkg) {
      const { name, version } = parseExactSpec(opts.pkg, semver);
      const found = await waitForVersion(registry, name, version, {
        attempts, delaySeconds: budget.delaySeconds, onWait: (i, n) => fs.appendFileSync(log, `waiting for ${name}@${version} (${i}/${n})\n`),
      });
      if (found.status !== 'present') {
        report.problems.push(`${name}@${version} is not published on ${registryUrl}`);
        return finish('fail');
      }
      const published = await registry.fetchPublishedManifest(name, version);
      primary = published.manifest;
      report.resolved = { name, version, integrity: published.integrity, sha256: published.sha256 };
      installSpec = `${name}@${version}`;
      if (opts.provenanceCommit) {
        // Attestations may lag the packument: wait within the same budget, then compare once.
        let doc = null;
        let lastError = 'not published yet';
        for (let i = 1; i <= attempts && !doc; i += 1) {
          try {
            doc = await registry.attestations(name, version);
          } catch (error) {
            lastError = error.message;
          }
          if (!doc && i < attempts) {
            fs.appendFileSync(log, `waiting for provenance of ${name}@${version} (${i}/${attempts})\n`);
            await sleep(delayMs);
          }
        }
        if (!doc) report.problems.push(`provenance attestations for ${name}@${version} unavailable after ${attempts} x ${budget.delaySeconds}s (${lastError})`);
        else {
          const provenance = checkProvenance(doc, { name, version, integrity: published.integrity, commit: opts.provenanceCommit });
          report.provenance = { commit: opts.provenanceCommit, sourceCommits: provenance.sourceCommits, ok: provenance.problems.length === 0 };
          report.problems.push(...provenance.problems);
        }
      }
    } else {
      const stat = fs.lstatSync(opts.tarball, { throwIfNoEntry: false });
      if (!stat?.isFile() || !opts.tarball.endsWith('.tgz')) throw new GuardError(`TARBALL must be an existing regular .tgz file: ${opts.tarball}`);
      primary = readPackedManifest(fs.readFileSync(opts.tarball));
      report.resolved = { name: primary.name, version: primary.version, sha256: sha256File(opts.tarball), archive: opts.tarball };
      installSpec = opts.tarball;
    }
    const guard = checkManifest(primary, semver);
    for (const s of [...guard.structural, ...guard.violations.map((v) => `${v.section}["${v.name}"] = ${JSON.stringify(v.value)} (${v.reason})`)]) {
      report.problems.push(`packed manifest guard: ${s}`);
    }
    if (report.problems.length) return finish('fail');
    // ---- same-PR siblings (candidate only)
    let siblings = [];
    if (opts.siblingsDir) {
      siblings = loadSiblings(opts.siblingsDir, { headSha: opts.headSha, semver });
      report.siblingEdges = checkSiblingRanges([primary, ...siblings.map((s) => s.manifest)], siblings, semver);
      const optionalPeerOnly = (sib) => primary.peerDependenciesMeta?.[sib.name]?.optional === true && !primary.dependencies?.[sib.name];
      const pkgJson = JSON.parse(fs.readFileSync(path.join(consumer.dir, 'package.json'), 'utf8'));
      pkgJson.overrides = {};
      for (const sib of siblings.filter((s) => !optionalPeerOnly(s))) pkgJson.overrides[sib.name] = `file:${sib.file}`;
      fs.writeFileSync(path.join(consumer.dir, 'package.json'), `${JSON.stringify(pkgJson, null, 2)}\n`);
      report.overrides = pkgJson.overrides;
      report.siblings = siblings.map(({ name, version, sha256, file }) => ({ name, version, sha256, file }));
    }
    // ---- core install (no optional peers), bounded propagation retries after publication
    const installArgs = ['install', installSpec, '--save-exact', '--omit=dev', '--no-audit', '--no-fund'];
    let install;
    for (let i = 1; i <= attempts; i += 1) {
      install = run('npm', installArgs, { cwd: consumer.dir, env, log });
      if (install.status === 0) break;
      const missing = missingSibling(install.output);
      if (missing && (await confirmMissing(registry, missing, semver))) report.pendingSibling = { ...missing, intended: 'awaiting publication', attempt: i };
      else if (!registryNotVisible(install.output)) break;
      else fs.appendFileSync(log, `registry not yet serving the install graph (${i}/${attempts})\n`);
      if (i < attempts) await sleep(delayMs);
    }
    report.install = { command: `npm ${installArgs.join(' ')}`, exit: install.status };
    if (install.status !== 0) {
      if (report.pendingSibling) {
        report.problems.push(`pending-sibling-publish: ${report.pendingSibling.name}@${report.pendingSibling.range} is not yet on the registry`);
        return finish('pending-sibling-publish');
      }
      report.problems.push(`npm install failed (exit ${install.status}); see qualify.log`);
      return finish('fail');
    }
    delete report.pendingSibling;
    report.treeBefore = tree(consumer, env, log);
    const installedPath = path.join(consumer.dir, 'node_modules', ...report.resolved.name.split('/'), 'package.json');
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
    if (installed.name !== report.resolved.name || installed.version !== report.resolved.version) {
      report.problems.push(`installed identity ${installed.name}@${installed.version} differs from ${report.resolved.name}@${report.resolved.version}`);
    }
    const lock = lockEntries(consumer.dir);
    if (opts.pkg && lock[`node_modules/${report.resolved.name}`]?.integrity !== report.resolved.integrity) {
      report.problems.push('installed integrity differs from the registry dist.integrity');
    }
    for (const sib of siblings) {
      for (const [key, entry] of Object.entries(lock)) {
        if (key.endsWith(`node_modules/${sib.name}`) && entry.version !== sib.version) report.problems.push(`${key} resolved ${entry.version}, not supplied sibling ${sib.version}`);
      }
    }
    for (const escape of symlinkEscapes(consumer.dir)) report.problems.push(`symlink escapes the consumer: ${escape}`);
    if (report.problems.length) return finish('fail');
    const entries = entryPoints(installed);
    for (const e of entries.filter((x) => x.status.startsWith('unsupported'))) report.problems.push(`${e.specifier}: ${e.status}`);
    // ---- core smoke: root entry without optional peers
    const root = entries.find((e) => e.subpath === '.' && e.status === 'runtime');
    if (!root) report.problems.push('no runtime root entry point to import');
    else for (const r of importEntry(consumer, root, env, log)) report.entrypoints.push({ phase: 'core', ...r });
    // ---- explicit optional-peer phase, then every runtime entry point
    for (const peer of opts.peers ?? []) {
      const { name, version } = parseExactSpec(peer, semver);
      const range = primary.peerDependencies?.[name];
      if (range === undefined) throw new GuardError(`PEERS entry ${name} is not a declared peerDependency of ${primary.name}`);
      if (!semver.satisfies(version, range, { includePrerelease: true })) throw new GuardError(`PEERS entry ${name}@${version} does not satisfy ${range}`);
      const sib = siblings.find((s) => s.name === name && s.version === version);
      // Registry peers published by the same train may lag: retry only "not yet visible" errors.
      let r;
      let tries = 0;
      while (tries < attempts) {
        tries += 1;
        r = run('npm', ['install', sib ? sib.file : `${name}@${version}`, '--save-exact', '--omit=dev', '--no-audit', '--no-fund'], { cwd: consumer.dir, env, log });
        if (r.status === 0 || sib || !registryNotVisible(r.output) || tries === attempts) break;
        fs.appendFileSync(log, `waiting for optional peer ${name}@${version} (${tries}/${attempts})\n`);
        await sleep(delayMs);
      }
      report.peersAdded.push({ name, version, source: sib ? 'sibling-receipt' : 'registry', exit: r.status, attempts: tries });
      if (r.status !== 0) report.problems.push(`optional peer install failed: ${name}@${version}`);
    }
    if (report.peersAdded.length) report.treeAfter = tree(consumer, env, log);
    for (const e of entries.filter((x) => x.status === 'runtime')) {
      for (const r of importEntry(consumer, e, env, log)) {
        report.entrypoints.push({ phase: 'all', ...r });
        if (!r.ok && !opts.peers?.length && primary.peerDependenciesMeta) {
          report.problems.push(`${r.specifier} failed without optional peers: supply PEERS=<name>@<version> for its declared optional peers`);
        }
      }
    }
    report.entrypointTypesOnly = entries.filter((e) => e.status === 'types-only').map((e) => e.specifier);
    if (report.entrypoints.some((e) => !e.ok)) report.problems.push('one or more entry-point imports failed');
    return finish(report.problems.length ? 'fail' : 'pass');
  } catch (error) {
    report.problems.push(error instanceof GuardError ? error.message : error.stack);
    return finish('fail');
  } finally {
    fs.rmSync(consumer.dir, { recursive: true, force: true });
    fs.rmSync(tools, { recursive: true, force: true });
  }
}

const argValue = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const peers = argValue(argv, '--peers');
  qualify({
    pkg: argValue(argv, '--pkg'), tarball: argValue(argv, '--tarball'), siblingsDir: argValue(argv, '--siblings-dir'),
    peers: peers ? peers.split(',').filter(Boolean) : [], mode: argValue(argv, '--mode'), registry: argValue(argv, '--registry'),
    reportDir: argValue(argv, '--report-dir') ?? '/reports', headSha: argValue(argv, '--head-sha') || null,
    image: process.env.QUALIFY_IMAGE ?? null, job: process.env.GITHUB_JOB ?? null,
    attempts: argValue(argv, '--attempts'), delaySeconds: argValue(argv, '--delay'), provenanceCommit: argValue(argv, '--provenance-commit'),
  }).then((code) => process.exit(code), (error) => {
    process.stdout.write(`qualify-published-install: ERROR ${error.message}\n`);
    process.exit(1);
  });
}
