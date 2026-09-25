#!/usr/bin/env node
// Publishable manifest guard. Contract: spec/SPEC_EVOL_CI_PUBLISHABLE_MANIFEST_GUARD.md.
// Runs only behind root Make targets inside $(LLM_MESH_NODE_IMAGE); never on the host.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const REGISTRY = 'https://registry.npmjs.org';
export const DEP_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
export const PUBLISH_ONLY_HOOKS = ['prepublish', 'prepublishOnly', 'publish', 'postpublish'];
export const FORBIDDEN_SPEC =
  /^(?:(?:file|link|portal|workspace|github|gitlab|bitbucket|https?|ftp|npm):|git(?:\+[^:]+)?:|ssh:|\.{1,2}(?:[\\/]|$)|[\\/]|[a-z]:[\\/]|~(?:[\\/]|$))/i;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const TRANSIENT_HINT = 're-run, not debt: transient registry or tooling failure';

// Steady-state npm publisher jobs in ci.yml (slug -> `<slug_with_underscores>_publish` filter).
export const STEADY_STATE_PUBLISHERS = [
  'llm-mesh', 'llm-gateway', 'cluster-mesh', 'chat-ui', 'cited-source-viewer', 'cowork-bridge',
  'cowork-desktop', 'oauth-verify', 'mcp-auth', 'mcp-platform', 'auth-hono', 'auth-client', 'auth-ui',
  'contracts', 'events', 'chat-core', 'chat-server', 'comments', 'flow', 'harness',
];
// bootstrap-publish step order in ci.yml (must equal the Bootstrap publish steps, in order).
// Owner freeze: auth-hono is not a bootstrap target until the owner decides.
export const BOOTSTRAP_TARGETS = [
  'contracts', 'events', 'chat-core', 'chat-server', 'comments', 'chat-ui', 'cited-source-viewer',
  'oauth-verify', 'mcp-auth', 'mcp-platform', 'auth-client', 'auth-ui', 'flow',
  'cowork-bridge', 'cowork-desktop', 'harness', 'llm-gateway', 'cluster-mesh',
];
// Explicit full candidate pack lanes (`make pack-<slug>`).
export const PACK_TARGETS = [
  'cluster-mesh', 'llm-mesh', 'llm-gateway', 'chat-ui', 'cited-source-viewer', 'auth-hono', 'auth-client',
  'oauth-verify', 'mcp-auth', 'mcp-platform', 'auth-ui', 'cowork-bridge', 'cowork-desktop',
  'harness', 'contracts', 'events', 'chat-core', 'chat-server', 'comments', 'flow',
];
export const publishFilter = (slug) => `${slug.replace(/-/g, '_')}_publish`;

export class GuardError extends Error {
  constructor(message, { transient = false } = {}) {
    // A wrapped transient cause already carries the hint; never repeat it.
    super(transient && !message.includes(TRANSIENT_HINT) ? `${message} (${TRANSIENT_HINT})` : message);
    this.transient = transient;
  }
}

// Only network/registry failures are transient; broken manifests and pack errors are real errors.
export const TRANSIENT_ERROR = /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|ERR_SOCKET_TIMEOUT|UND_ERR_[A-Z_]+|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|fetch failed|socket hang up|HTTP (?:408|429|5\d\d)|E429|E5\d\d)\b/;
// Registry HTTP statuses worth retrying; any other non-404 failure (400/401/403...) is permanent.
const TRANSIENT_STATUS = (status) => status === 408 || status === 429 || status >= 500;
export const isTransientError = (error) =>
  (error instanceof GuardError && error.transient === true) || TRANSIENT_ERROR.test(String(error?.message ?? error));

let cachedSemver;
export function loadSemver() {
  if (cachedSemver) return cachedSemver;
  const toolDir = process.env.MANIFEST_GUARD_TOOL_DIR;
  if (!toolDir) throw new GuardError('MANIFEST_GUARD_TOOL_DIR is not set: pinned semver@7.7.2 is unavailable');
  const semver = createRequire(path.join(toolDir, 'package.json'))('semver');
  if (semver.SEMVER_SPEC_VERSION === undefined || typeof semver.validRange !== 'function') {
    throw new GuardError('pinned semver tool is invalid');
  }
  cachedSemver = semver;
  return semver;
}

// D1: a dependency value passes only as a non-empty (after trim), non-forbidden, plain semver range.
export function classifyDependencyValue(input, semver = loadSemver()) {
  if (typeof input !== 'string') return { ok: false, reason: 'non-string dependency value' };
  const value = input.trim();
  if (value.length === 0) return { ok: false, reason: 'empty range after trim' };
  const forbidden = value.match(FORBIDDEN_SPEC);
  if (forbidden) return { ok: false, reason: `forbidden protocol or path prefix "${forbidden[0]}"` };
  if (semver.validRange(value, { loose: false }) === null) {
    return { ok: false, reason: 'not a plain semver range (tags, aliases, git shorthand are rejected)' };
  }
  return { ok: true };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Returns { isPublic, violations[], structural[] } for one manifest object.
export function checkManifest(manifest, semver = loadSemver()) {
  const violations = [];
  const structural = [];
  if (!isPlainObject(manifest)) return { isPublic: false, violations, structural: ['manifest is not a JSON object'] };
  if ('private' in manifest && typeof manifest.private !== 'boolean') {
    structural.push(`"private" must be a boolean, got ${JSON.stringify(manifest.private)}`);
  }
  const isPublic = manifest.private !== true;
  for (const key of ['name', 'version']) {
    if (typeof manifest[key] !== 'string' || manifest[key].length === 0) structural.push(`missing "${key}"`);
  }
  for (const section of DEP_SECTIONS) {
    if (!(section in manifest)) continue;
    const map = manifest[section];
    if (!isPlainObject(map)) {
      structural.push(`malformed "${section}" map`);
      continue;
    }
    for (const [name, value] of Object.entries(map)) {
      const result = classifyDependencyValue(value, semver);
      if (!result.ok) violations.push({ section, name, value, reason: result.reason });
    }
  }
  const scripts = isPlainObject(manifest.scripts) ? manifest.scripts : {};
  for (const hook of PUBLISH_ONLY_HOOKS) {
    if (hook in scripts) {
      violations.push({ section: 'scripts', name: hook, value: scripts[hook], reason: 'publish-only lifecycle hook requires an explicit lifecycle design' });
    }
  }
  return { isPublic, violations, structural };
}

export const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Minimal ustar/pax reader: returns the single regular package/package.json member, rejecting
// traversal, links, duplicates and malformed headers. Nothing is extracted to disk.
export function readPackedManifest(tgz) {
  let tar;
  try {
    tar = zlib.gunzipSync(tgz, { maxOutputLength: 2 ** 31 - 1 });
  } catch (error) {
    throw new GuardError(`malformed archive: ${error.message}`);
  }
  const text = (buf) => buf.toString('utf8').replace(/\0.*$/s, '');
  const octal = (buf) => {
    const raw = text(buf).trim();
    if (!/^[0-7]*$/.test(raw)) throw new GuardError('malformed archive: invalid octal header field');
    return raw === '' ? 0 : parseInt(raw, 8);
  };
  let offset = 0;
  let pax = {};
  let longName = null;
  const matches = [];
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== octal(header.subarray(148, 156))) throw new GuardError('malformed archive: header checksum mismatch');
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (body.length !== size) throw new GuardError('malformed archive: truncated member');
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = Object.fromEntries(
        body.toString('utf8').split('\n').filter(Boolean).map((line) => {
          const kv = line.slice(line.indexOf(' ') + 1);
          const eq = kv.indexOf('=');
          return [kv.slice(0, eq), kv.slice(eq + 1)];
        }),
      );
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      longName = text(body);
      continue;
    }
    const prefix = text(header.subarray(345, 500));
    let name = pax.path ?? longName ?? (prefix ? `${prefix}/${text(header.subarray(0, 100))}` : text(header.subarray(0, 100)));
    pax = {};
    longName = null;
    name = name.replace(/^\.\//, '');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new GuardError(`unsafe archive member path: ${name}`);
    if (type === '1' || type === '2') throw new GuardError(`archive contains a link member: ${name}`);
    if (name === 'package/package.json') {
      if (type !== '0') throw new GuardError('package/package.json is not a regular file');
      if (size > MAX_MANIFEST_BYTES) throw new GuardError('package/package.json exceeds the size bound');
      matches.push(Buffer.from(body));
    }
  }
  if (matches.length !== 1) throw new GuardError(`archive must contain exactly one package/package.json, found ${matches.length}`);
  try {
    return JSON.parse(matches[0].toString('utf8'));
  } catch (error) {
    throw new GuardError(`packed package.json is not valid JSON: ${error.message}`);
  }
}

// ---------------------------------------------------------------- registry
const registryPath = (name) => (name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name));

// Only packuments that exist are cached, and a cached packument answers only versions it already
// lists (published versions are immutable). 404s and not-yet-listed versions are always refetched;
// `{ fresh: true }` bypasses the cache entirely (propagation waits, pre-publish recheck).
export function createRegistry({ registry = REGISTRY, fetchImpl = globalThis.fetch, attempts = 3, delayMs = 1000 } = {}) {
  const packuments = new Map();
  async function request(url, accept) {
    let lastError;
    let transient = true;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, { headers: { accept }, cache: 'no-store' });
        if (response.status === 404) return { status: 404 };
        if (response.ok) return { status: response.status, response };
        lastError = `HTTP ${response.status}`;
        transient = TRANSIENT_STATUS(response.status);
        if (!transient) break;
      } catch (error) {
        lastError = error.message;
        transient = true;
      }
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
    throw new GuardError(`registry request failed for ${url}: ${lastError}`, { transient });
  }
  async function packument(name, { fresh = false } = {}) {
    if (!fresh && packuments.has(name)) return packuments.get(name);
    const url = `${registry}/${registryPath(name)}`;
    const res = await request(url, 'application/vnd.npm.install-v1+json');
    let doc = null;
    if (res.status !== 404) {
      try {
        doc = await res.response.json();
      } catch (error) {
        throw new GuardError(`malformed registry response for ${name}: ${error.message}`, { transient: true });
      }
      if (!isPlainObject(doc) || !isPlainObject(doc.versions)) {
        throw new GuardError(`malformed registry response for ${name}: missing versions`, { transient: true });
      }
    }
    if (doc === null) packuments.delete(name);
    else packuments.set(name, doc);
    return doc;
  }
  // present | absent (confirmed 404 or version missing); lookup failures throw GuardError.
  async function lookup(name, version, { fresh = false } = {}) {
    const cached = packuments.get(name);
    const doc = !fresh && cached?.versions?.[version] ? cached : await packument(name, { fresh: true });
    const meta = doc?.versions?.[version];
    const evidence = { registry, name, version, packageFound: doc !== null };
    if (!meta) return { status: 'absent', evidence };
    return { status: 'present', meta, evidence: { ...evidence, integrity: meta.dist?.integrity ?? null } };
  }
  async function fetchPublishedManifest(name, version) {
    const found = await lookup(name, version);
    if (found.status !== 'present') throw new GuardError(`${name}@${version} is not published`);
    const { tarball, integrity } = found.meta.dist ?? {};
    const match = typeof integrity === 'string' && integrity.match(/^sha512-([A-Za-z0-9+/=]+)$/);
    if (!tarball || !match) throw new GuardError(`registry metadata for ${name}@${version} lacks a sha512 integrity`, { transient: true });
    const res = await request(tarball, 'application/octet-stream');
    if (res.status === 404) throw new GuardError(`published tarball missing for ${name}@${version}`, { transient: true });
    const bytes = Buffer.from(await res.response.arrayBuffer());
    if (createHash('sha512').update(bytes).digest('base64') !== match[1]) {
      throw new GuardError(`integrity mismatch for published ${name}@${version}`);
    }
    return { manifest: readPackedManifest(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), integrity };
  }
  return { lookup, packument, fetchPublishedManifest, registry };
}

// D7: compare runtime/peer/optional maps exactly (sorted keys, absent == empty).
export function diffDependencyMaps(published, candidate) {
  const changes = [];
  for (const section of DEP_SECTIONS) {
    const a = isPlainObject(published?.[section]) ? published[section] : {};
    const b = isPlainObject(candidate?.[section]) ? candidate[section] : {};
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(name in b)) changes.push({ section, name, from: a[name], to: undefined });
      else if (!(name in a)) changes.push({ section, name, from: undefined, to: b[name] });
      else if (a[name] !== b[name]) changes.push({ section, name, from: a[name], to: b[name] });
    }
  }
  return changes;
}

// ---------------------------------------------------------------- npm pack
export function runNpmPack(packageDir, destination, { ignoreScripts = false, npm = 'npm' } = {}) {
  fs.mkdirSync(destination, { recursive: true });
  if (fs.readdirSync(destination).some((f) => f.endsWith('.tgz'))) throw new GuardError(`pack destination is not empty: ${destination}`);
  const args = ['pack', '--json', '--pack-destination', destination];
  if (ignoreScripts) args.push('--ignore-scripts');
  const result = spawnSync(npm, args, { cwd: packageDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const logs = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error || result.status !== 0) {
    throw new GuardError(`npm pack failed in ${packageDir} (exit ${result.status}): ${(result.error?.message ?? logs).slice(-2000)}`);
  }
  // Lifecycle stdout may precede the JSON document: parse from the last line that opens it.
  const lines = result.stdout.split('\n');
  const start = lines.lastIndexOf('[');
  let parsed;
  try {
    parsed = JSON.parse(lines.slice(start).join('\n'));
  } catch {
    throw new GuardError('npm pack did not emit a parsable JSON report');
  }
  if (start < 0 || !Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0]?.filename !== 'string') {
    throw new GuardError('npm pack JSON must describe exactly one archive');
  }
  const filename = path.basename(parsed[0].filename.replace(/^@/, '').replace(/\//, '-'));
  const archives = fs.readdirSync(destination).filter((f) => f.endsWith('.tgz'));
  if (archives.length !== 1 || archives[0] !== filename) {
    throw new GuardError(`npm pack produced ${JSON.stringify(archives)}, expected exactly ${filename}`);
  }
  const archive = path.join(destination, filename);
  if (!fs.lstatSync(archive).isFile()) throw new GuardError('packed archive is not a regular file');
  return { archive, report: parsed[0], lifecycleLog: lines.slice(0, Math.max(start, 0)).join('\n') };
}

// ---------------------------------------------------------------- context & classification
const EVENTS = new Set(['pull_request', 'push', 'workflow_dispatch']);
const parseJsonList = (raw, field) => {
  if (typeof raw !== 'string' || raw.trim() === '') throw new GuardError(`CI context is missing "${field}"`);
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new GuardError(`CI context "${field}" is not valid JSON (truncated output?)`);
  }
  if (!Array.isArray(list) || list.some((v) => typeof v !== 'string')) throw new GuardError(`CI context "${field}" must be a JSON string list`);
  return list;
};

// Reads CI_MANIFEST_* env or MANIFEST_CONTEXT_FILE; returns null when no context is supplied.
export function readContext(env = process.env) {
  let outputs;
  let event;
  let bootstrap;
  let changesResult = env.CI_MANIFEST_CHANGES_RESULT;
  let shas = {};
  if (env.MANIFEST_CONTEXT_FILE) {
    let file;
    try {
      file = JSON.parse(fs.readFileSync(env.MANIFEST_CONTEXT_FILE, 'utf8'));
    } catch (error) {
      throw new GuardError(`unreadable MANIFEST_CONTEXT_FILE: ${error.message}`);
    }
    ({ outputs, event_name: event, bootstrap_target: bootstrap } = file);
    changesResult = file.changes_result ?? changesResult;
    shas = isPlainObject(file.shas) ? file.shas : {};
  } else if (env.CI_MANIFEST_CONTEXT !== undefined || env.CI_MANIFEST_EVENT !== undefined) {
    try {
      outputs = JSON.parse(env.CI_MANIFEST_CONTEXT ?? '');
    } catch {
      throw new GuardError('CI_MANIFEST_CONTEXT is not valid JSON');
    }
    event = env.CI_MANIFEST_EVENT;
    bootstrap = env.CI_MANIFEST_BOOTSTRAP_TARGET;
    shas = { head: env.GITHUB_SHA ?? null, before: env.CI_MANIFEST_BEFORE_SHA ?? null, base: env.CI_MANIFEST_BASE_SHA ?? null };
  } else {
    return null;
  }
  return normalizeContext({ outputs, event, bootstrap, changesResult, shas });
}

export function normalizeContext({ outputs, event, bootstrap, changesResult, shas = {} }) {
  if (changesResult !== undefined && changesResult !== 'success') {
    throw new GuardError(`changes job result is "${changesResult}", not success: classification context is unavailable`);
  }
  if (!isPlainObject(outputs)) throw new GuardError('CI context outputs must be a JSON object');
  if (!EVENTS.has(event)) throw new GuardError(`unsupported CI event "${event}"`);
  const packageFiles = parseJsonList(outputs.package_files, 'package_files');
  const matchedFilters = parseJsonList(outputs.matched_filters, 'matched_filters');
  let target = event === 'workflow_dispatch' ? (bootstrap || 'none') : 'none';
  if (target !== 'none' && target !== 'all' && !BOOTSTRAP_TARGETS.includes(target)) {
    throw new GuardError(`unknown bootstrap target "${target}"`);
  }
  return { event, bootstrapTarget: target, packageFiles, matchedFilters, shas, manifestGuardFilter: outputs.manifest_guard ?? null };
}

// C: public packages owning at least one changed packages/<slug>/** path (rename sides included).
export function changedPackages(packageFiles) {
  const slugs = new Set();
  for (const file of packageFiles) {
    const match = file.match(/^packages\/([^/]+)\/.+/);
    if (match) slugs.add(match[1]);
  }
  return slugs;
}

// Pure classification. `absent(slug)` resolves true when the PACKED version is absent from the
// registry (it throws on lookup/identity failure, which callers surface as ERROR).
export async function classifyPackages({ publicSlugs, context, absent, completeInventory = true }) {
  const result = new Map(publicSlugs.map((slug) => [slug, { severity: 'warn', reasons: [] }]));
  const block = (slug, reason) => {
    const entry = result.get(slug);
    if (!entry) return;
    entry.severity = 'block';
    entry.reasons.push(reason);
  };
  const changed = changedPackages(context.packageFiles);
  for (const slug of changed) block(slug, 'changed');
  const removed = [...changed].filter((slug) => !result.has(slug));
  for (const slug of STEADY_STATE_PUBLISHERS) {
    if (!result.has(slug) || !context.matchedFilters.includes(publishFilter(slug))) continue;
    if (await absent(slug)) block(slug, 'publication-selected-absent-version');
    else result.get(slug).reasons.push('publication-selected-existing-version');
  }
  if (context.bootstrapTarget === 'all') {
    for (const slug of BOOTSTRAP_TARGETS) {
      if (result.has(slug) && (await absent(slug))) block(slug, 'bootstrap-all-absent-version');
    }
  } else if (context.bootstrapTarget !== 'none') {
    if (completeInventory && !result.has(context.bootstrapTarget)) throw new GuardError(`bootstrap target ${context.bootstrapTarget} is not a public package`);
    block(context.bootstrapTarget, 'bootstrap-explicit');
  }
  return { classification: result, removed };
}

// ---------------------------------------------------------------- inspection & reporting
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export class Reporter {
  constructor({ reportDir = null, out = process.stdout } = {}) {
    this.reportDir = reportDir;
    this.out = out;
    this.errors = 0;
    this.warnings = 0;
    this.entries = [];
  }
  annotate(level, slug, message) {
    const file = slug ? `packages/${slug}/package.json` : '';
    const props = [file && `file=${escapeProperty(file)}`, `title=${escapeProperty('Publishable manifest')}`].filter(Boolean).join(',');
    this.out.write(`::${level} ${props}::${escapeData(message)}\n`);
    this.entries.push({ level, slug, message });
    if (level === 'error') this.errors += 1;
    if (level === 'warning') this.warnings += 1;
  }
  error(slug, message) { this.annotate('error', slug, message); }
  warn(slug, message) { this.annotate('warning', slug, message); }
  notice(slug, message) { this.annotate('notice', slug, message); }
  finding(severity, slug, message) { (severity === 'block' ? this.error : this.warn).call(this, slug, message); }
  write(name, data) {
    if (!this.reportDir) return null;
    fs.mkdirSync(this.reportDir, { recursive: true });
    const file = path.join(this.reportDir, name);
    fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
    return file;
  }
}

export const describeFinding = (where, v) =>
  `${where}: ${v.section}["${v.name}"] = ${JSON.stringify(v.value)} (${v.reason})`;

// Inspects one real archive against optional source manifests; returns findings without deciding severity.
export function inspectArchive({ archive, sources = [], expected = null, semver = loadSemver() }) {
  const packed = readPackedManifest(fs.readFileSync(archive));
  const sha256 = sha256File(archive);
  const findings = [];
  const structural = [];
  const where = `packed ${path.basename(archive)} (sha256 ${sha256}) package/package.json`;
  const packedCheck = checkManifest(packed, semver);
  structural.push(...packedCheck.structural.map((s) => `${where}: ${s}`));
  findings.push(...packedCheck.violations.map((v) => describeFinding(where, v)));
  if (packed.private === true) structural.push(`${where}: packed manifest switched to private`);
  for (const { label, manifest } of sources) {
    const check = checkManifest(manifest, semver);
    structural.push(...check.structural.map((s) => `source ${label}: ${s}`));
    findings.push(...check.violations.map((v) => describeFinding(`source ${label}`, v)));
    if (manifest.private === true) structural.push(`source ${label} is private but was packed`);
    if (manifest.name !== packed.name) structural.push(`identity mismatch: source ${label} name ${manifest.name} vs packed ${packed.name}`);
    if (manifest.version !== packed.version) structural.push(`identity mismatch: source ${label} version ${manifest.version} vs packed ${packed.version}`);
  }
  if (expected && (expected.name !== packed.name || expected.version !== packed.version)) {
    structural.push(`identity mismatch: expected ${expected.name}@${expected.version}, packed ${packed.name}@${packed.version}`);
  }
  return { name: packed.name, version: packed.version, sha256, packed, findings, structural };
}

const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new GuardError(`unreadable ${what} ${file}: ${error.message}`);
  }
};

// Lifecycle-free archive snapshot (inventory-snapshot evidence): identity + packed manifest only.
export function snapshotPackage(packageDir, { tmpRoot = os.tmpdir() } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'manifest-snapshot-'));
  try {
    const { archive } = runNpmPack(packageDir, dir, { ignoreScripts: true });
    const packed = readPackedManifest(fs.readFileSync(archive));
    return { name: packed.name, version: packed.version, packed, sha256: sha256File(archive), evidence: 'inventory-snapshot' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Applies an existing manifest transform (chat-ui / cited-source-viewer) around fn, restoring on any exit.
export function withManifestTransform(packageDir, fn) {
  const transform = path.join(packageDir, 'scripts', 'make-publish-pkgjson.mjs');
  if (!fs.existsSync(transform)) return fn(null);
  const manifestPath = path.join(packageDir, 'package.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  try {
    const run = spawnSync(process.execPath, [transform, '--write'], { cwd: packageDir, encoding: 'utf8' });
    if (run.status !== 0) throw new GuardError(`manifest transform failed: ${run.stderr || run.stdout}`);
    return fn(JSON.parse(original));
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
}

// ---------------------------------------------------------------- commands
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
function parseArgs(argv) {
  const opts = { _: [], passthrough: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      opts.passthrough = argv.slice(i + 1);
      break;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else {
        opts[key] = next;
        i += 1;
      }
    } else opts._.push(arg);
  }
  return opts;
}

function requireSlug(slug, cwd) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new GuardError(`invalid --slug ${JSON.stringify(slug)}`);
  if (path.basename(cwd) !== slug) throw new GuardError(`working directory ${cwd} is not packages/${slug}`);
}

function sourceManifests(cwd, env) {
  const sources = [{ label: 'package.json', manifest: readJson(path.join(cwd, 'package.json'), 'manifest') }];
  if (env.MANIFEST_ORIGINAL_SOURCE) {
    sources.push({ label: 'package.json (pre-transform original)', manifest: readJson(env.MANIFEST_ORIGINAL_SOURCE, 'original manifest') });
  } else if (fs.existsSync(path.join(cwd, 'scripts', 'make-publish-pkgjson.mjs'))) {
    throw new GuardError('this package packs through its manifest transform: use its make pack-/publish- target');
  }
  return sources;
}

async function bumpGate({ registry, candidate, reporter, slug }) {
  const found = await registry.lookup(candidate.name, candidate.version);
  if (found.status !== 'present') return { registry: 'absent' };
  const published = await registry.fetchPublishedManifest(candidate.name, candidate.version);
  const changes = diffDependencyMaps(published.manifest, candidate.packed);
  for (const c of changes) {
    reporter.error(slug, `bump required: ${candidate.name}@${candidate.version} is already published (sha256 ${published.sha256}) and ${c.section}["${c.name}"] changed ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)} in candidate sha256 ${candidate.sha256}`);
  }
  return { registry: 'present', publishedSha256: published.sha256, bumpRequired: changes.length > 0 };
}

async function resolvePackSeverity({ slug, cwd, env, registry }) {
  if (env.MANIFEST_SEVERITY === 'block') return { severity: 'block', reasons: ['forced-block'] };
  if (env.MANIFEST_SEVERITY) throw new GuardError('MANIFEST_SEVERITY only accepts "block"; WARN is derived from CI context');
  const context = readContext(env);
  if (!context) return { severity: 'block', reasons: ['standalone-default'] };
  let snapshot = null;
  const absent = async () => {
    snapshot = snapshotPackage(cwd);
    return (await registry.lookup(snapshot.name, snapshot.version)).status === 'absent';
  };
  const { classification } = await classifyPackages({ publicSlugs: [slug], context, absent, completeInventory: false });
  return { ...classification.get(slug), context, snapshot };
}

export async function commandPack(opts, { env = process.env, cwd = process.cwd(), registry = createRegistry(), out } = {}) {
  requireSlug(opts.slug, cwd);
  const reporter = new Reporter({ reportDir: opts['report-dir'] ?? null, out });
  const semver = loadSemver();
  const sources = sourceManifests(cwd, env);
  const { severity, reasons, snapshot } = await resolvePackSeverity({ slug: opts.slug, cwd, env, registry });
  const explicit = typeof opts.destination === 'string';
  const dest = explicit ? opts.destination : fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-pack-'));
  try {
    const { archive } = runNpmPack(cwd, dest);
    const result = inspectArchive({ archive, sources, semver });
    for (const s of result.structural) reporter.error(opts.slug, s);
    if (snapshot && (snapshot.name !== result.name || snapshot.version !== result.version)) {
      reporter.error(opts.slug, `identity mismatch: snapshot ${snapshot.name}@${snapshot.version} vs candidate ${result.name}@${result.version}`);
    }
    for (const f of result.findings) reporter.finding(severity, opts.slug, f);
    let bump = null;
    if (severity === 'block' && result.structural.length === 0) bump = await bumpGate({ registry, candidate: result, reporter, slug: opts.slug });
    const hostArchive = explicit && env.PACK_DESTINATION_HOST ? path.join(env.PACK_DESTINATION_HOST, path.basename(archive)) : explicit ? archive : null;
    const receipt = {
      slug: opts.slug, name: result.name, version: result.version, sha256: result.sha256, archive: hostArchive,
      manifest_mode: severity, reasons, evidence: 'release-candidate', head_sha: env.MANIFEST_HEAD_SHA || env.GITHUB_SHA || null,
      guard: reporter.errors === 0 ? 'pass' : 'fail', bump, errors: reporter.errors, warnings: reporter.warnings,
    };
    reporter.write(`${opts.slug}.receipt.json`, receipt);
    if (hostArchive && /[\r\n]/.test(hostArchive)) throw new GuardError('archive path contains a newline');
    reporter.write(`${opts.slug}.github-output`, `tarball=${hostArchive ?? ''}\nmanifest_mode=${severity}\n`);
    (out ?? process.stdout).write(`${receipt.guard.toUpperCase()} ${result.name}@${result.version} mode=${severity} (${reasons.join(', ')}) sha256=${result.sha256}\n`);
    return reporter.errors === 0 ? 0 : 1;
  } finally {
    if (!explicit) fs.rmSync(dest, { recursive: true, force: true });
  }
}

export async function commandCheck(opts, { env = process.env, out } = {}) {
  const reporter = new Reporter({ reportDir: opts['report-dir'] ?? null, out });
  if (typeof opts.tarball !== 'string') throw new GuardError('--tarball is required');
  const sources = typeof opts.source === 'string' ? [{ label: opts.source, manifest: readJson(opts.source, 'manifest') }] : [];
  const result = inspectArchive({ archive: opts.tarball, sources });
  for (const s of result.structural) reporter.error(null, s);
  for (const f of result.findings) reporter.error(null, f);
  reporter.write('check.json', { name: result.name, version: result.version, sha256: result.sha256, errors: reporter.entries });
  (out ?? process.stdout).write(`${reporter.errors ? 'FAIL' : 'PASS'} ${result.name}@${result.version} sha256=${result.sha256}\n`);
  return reporter.errors === 0 ? 0 : 1;
}

// Enumerates immediate packages/*/package.json: U = public packages (structural errors are fatal).
export function enumeratePackages(root, reporter) {
  const dir = path.join(root, 'packages');
  const packages = new Map();
  for (const slug of fs.readdirSync(dir).sort()) {
    const manifestPath = path.join(dir, slug, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      reporter.error(slug, `invalid package.json: ${error.message}`);
      continue;
    }
    if (isPlainObject(manifest) && 'private' in manifest && typeof manifest.private !== 'boolean') {
      reporter.error(slug, `"private" must be a boolean, got ${JSON.stringify(manifest.private)}`);
      continue;
    }
    if (isPlainObject(manifest) && manifest.private !== true) packages.set(slug, { dir: path.join(dir, slug), manifest });
  }
  return packages;
}

export async function commandInventory(opts, { env = process.env, root = process.cwd(), registry = createRegistry(), out, snapshot = snapshotPackage } = {}) {
  const reporter = new Reporter({ reportDir: opts['report-dir'] ?? null, out });
  const context = readContext(env);
  if (!context) throw new GuardError('inventory requires a validated CI context (MANIFEST_CONTEXT_FILE or CI_MANIFEST_CONTEXT); refusing to guess');
  const semver = loadSemver();
  const packages = enumeratePackages(root, reporter);
  const snapshots = new Map();
  const takeSnapshot = (slug) => {
    if (!snapshots.has(slug)) {
      try {
        snapshots.set(slug, { ok: true, ...withManifestTransform(packages.get(slug).dir, () => snapshot(packages.get(slug).dir)) });
      } catch (error) {
        snapshots.set(slug, { ok: false, error: error.message, transient: isTransientError(error) });
      }
    }
    return snapshots.get(slug);
  };
  const registryStatus = new Map();
  const absent = async (slug) => {
    const snap = takeSnapshot(slug);
    if (!snap.ok) throw new GuardError(`cannot resolve packed identity of ${slug} for publication classification: ${snap.error}`, { transient: snap.transient });
    const found = await registry.lookup(snap.name, snap.version);
    registryStatus.set(slug, { status: found.status, ...found.evidence });
    return found.status === 'absent';
  };
  let classification;
  let removed = [];
  try {
    ({ classification, removed } = await classifyPackages({ publicSlugs: [...packages.keys()], context, absent }));
  } catch (error) {
    reporter.error(null, `classification ERROR: ${error.message}`);
    reporter.write('classification.json', { context, error: error.message });
    return 1;
  }
  for (const slug of removed) reporter.notice(slug, `package directory removed or private: packages/${slug} (not packed)`);
  const report = { context, packages: {}, removed };
  const blockList = [];
  for (const [slug, { manifest }] of packages) {
    const { severity, reasons } = classification.get(slug);
    const entry = { severity, reasons, registry: registryStatus.get(slug) ?? null, source: 'checked' };
    const check = checkManifest(manifest, semver);
    for (const s of check.structural) reporter.error(slug, `source package.json: ${s}`);
    for (const v of check.violations) reporter.finding(severity, slug, describeFinding('source package.json', v));
    if (severity === 'block') {
      blockList.push(slug);
      if (!PACK_TARGETS.includes(slug)) reporter.error(slug, `missing pack lane: ${slug} is selected (BLOCK) but has no make pack-${slug} target`);
      entry.candidate = 'full pack via make pack-' + slug;
    } else {
      const snap = takeSnapshot(slug);
      if (!snap.ok) {
        reporter.warn(slug, `audit-incomplete: inventory snapshot failed: ${snap.error}`);
        entry.snapshot = { status: 'audit-incomplete', error: snap.error };
      } else {
        const packedCheck = checkManifest(snap.packed, semver);
        const where = `inventory-snapshot package/package.json (sha256 ${snap.sha256})`;
        for (const s of packedCheck.structural) reporter.warn(slug, `${where}: ${s}`);
        for (const v of packedCheck.violations) reporter.warn(slug, describeFinding(where, v));
        entry.snapshot = { status: 'inventory-snapshot', name: snap.name, version: snap.version, sha256: snap.sha256 };
      }
    }
    report.packages[slug] = entry;
  }
  report.summary = { errors: reporter.errors, warnings: reporter.warnings, block: blockList };
  reporter.write('classification.json', report);
  reporter.write('block-packages.txt', blockList.map((s) => `${s}\n`).join(''));
  (out ?? process.stdout).write(`inventory: ${packages.size} public packages, BLOCK=[${blockList.join(' ')}], errors=${reporter.errors}, warnings=${reporter.warnings}\n`);
  return reporter.errors === 0 ? 0 : 1;
}

// Guarded publication: packed identity -> registry lookup -> existing version skips (WARN) BEFORE
// candidate packing -> strict candidate check -> recheck -> npm publish <verified.tgz>.
export async function commandPublish(opts, { env = process.env, cwd = process.cwd(), registry = createRegistry(), out, npm = 'npm' } = {}) {
  requireSlug(opts.slug, cwd);
  const receiptDir = opts['receipt-dir'] ?? path.resolve(cwd, '..', '..', 'tmp', 'ci-manifest-guard', 'publish');
  const reporter = new Reporter({ reportDir: receiptDir, out });
  const sources = sourceManifests(cwd, env);
  const snap = snapshotPackage(cwd);
  const writeReceipt = (status, extra = {}) => {
    reporter.write(`${opts.slug}.json`, { slug: opts.slug, name: snap.name, version: snap.version, status, ...extra });
    reporter.write(`${opts.slug}.publish-output`, `pkg=${snap.name}@${snap.version}\nstatus=${status}\n`);
  };
  const skip = (why) => {
    reporter.warn(opts.slug, `${snap.name}@${snap.version} already exists (${why}); skipping publish without candidate pack`);
    writeReceipt('skipped');
    return 0;
  };
  if ((await registry.lookup(snap.name, snap.version)).status === 'present') return skip('registry lookup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-publish-'));
  try {
    const { archive } = runNpmPack(cwd, dir);
    const result = inspectArchive({ archive, sources, expected: { name: snap.name, version: snap.version } });
    for (const s of result.structural) reporter.error(opts.slug, s);
    for (const f of result.findings) reporter.error(opts.slug, f);
    if (reporter.errors) {
      writeReceipt('rejected', { sha256: result.sha256 });
      return 1;
    }
    if ((await registry.lookup(snap.name, snap.version, { fresh: true })).status === 'present') return skip('recheck before publish');
    (out ?? process.stdout).write(`publishing verified archive ${path.basename(archive)} sha256=${result.sha256}\n`);
    const run = spawnSync(npm, ['publish', archive, ...opts.passthrough], { cwd, stdio: 'inherit' });
    writeReceipt(run.status === 0 ? 'published' : 'failed', { sha256: result.sha256, npm_exit: run.status });
    return run.status === 0 ? 0 : 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Same-PR sibling candidates (spec section 10): BLOCK packages in the dependency closure of `slug`.
export async function commandSiblingPlan(opts, { env = process.env, root = process.cwd(), registry = createRegistry(), out, snapshot = snapshotPackage } = {}) {
  if (typeof opts.slug !== 'string' || !SLUG.test(opts.slug)) throw new GuardError(`invalid --slug ${JSON.stringify(opts.slug)}`);
  if (typeof opts.out !== 'string') throw new GuardError('--out is required');
  const reporter = new Reporter({ out });
  const packages = enumeratePackages(root, reporter);
  if (!packages.has(opts.slug)) throw new GuardError(`${opts.slug} is not a public workspace package`);
  const bySlugName = new Map([...packages].map(([slug, p]) => [p.manifest.name, slug]));
  const closure = new Set();
  const queue = [opts.slug];
  while (queue.length) {
    const { manifest } = packages.get(queue.shift());
    for (const section of DEP_SECTIONS) {
      for (const name of Object.keys(isPlainObject(manifest[section]) ? manifest[section] : {})) {
        const slug = bySlugName.get(name);
        if (slug && slug !== opts.slug && !closure.has(slug)) {
          closure.add(slug);
          queue.push(slug);
        }
      }
    }
  }
  const context = readContext(env);
  let plan = [];
  if (!context) reporter.notice(opts.slug, 'no CI context: no same-PR sibling archives are injected');
  else {
    const absent = async (slug) => {
      const snap = withManifestTransform(packages.get(slug).dir, () => snapshot(packages.get(slug).dir));
      return (await registry.lookup(snap.name, snap.version)).status === 'absent';
    };
    const { classification } = await classifyPackages({ publicSlugs: [...closure], context, absent, completeInventory: false });
    plan = [...closure].filter((slug) => classification.get(slug).severity === 'block').sort();
    for (const slug of plan.filter((s) => !PACK_TARGETS.includes(s))) reporter.error(slug, `missing pack lane for same-PR sibling ${slug}`);
  }
  fs.writeFileSync(opts.out, plan.map((s) => `${s}\n`).join(''));
  (out ?? process.stdout).write(`sibling plan for ${opts.slug}: closure=[${[...closure].sort().join(' ')}] block=[${plan.join(' ')}]\n`);
  return reporter.errors ? 1 : 0;
}

// Collects guarded sibling receipts into <dir>/receipts.json with archive paths relative to <dir>.
export async function commandSiblingCollect(opts, { out } = {}) {
  const dir = opts.dir;
  if (typeof dir !== 'string') throw new GuardError('--dir is required');
  const plan = fs.readFileSync(path.join(dir, 'plan.txt'), 'utf8').split('\n').filter(Boolean);
  const receipts = plan.map((slug) => {
    const receipt = readJson(path.join(dir, 'receipts', `${slug}.receipt.json`), 'sibling receipt');
    if (receipt.guard !== 'pass' || receipt.manifest_mode !== 'block' || typeof receipt.archive !== 'string') {
      throw new GuardError(`sibling ${slug} has no passing BLOCK candidate archive`);
    }
    const file = path.join(slug, path.basename(receipt.archive));
    if (sha256File(path.join(dir, file)) !== receipt.sha256) throw new GuardError(`sibling ${slug} archive hash differs from its receipt`);
    const { name, version, sha256, head_sha, guard, manifest_mode, evidence } = receipt;
    return { name, version, file, sha256, head_sha, guard, manifest_mode, evidence };
  });
  fs.writeFileSync(path.join(dir, 'receipts.json'), `${JSON.stringify(receipts, null, 2)}\n`);
  (out ?? process.stdout).write(`collected ${receipts.length} sibling receipt(s): ${receipts.map((r) => `${r.name}@${r.version}`).join(' ')}\n`);
  return 0;
}

export async function main(argv, deps = {}) {
  const [command, ...rest] = argv;
  const opts = parseArgs(rest);
  const commands = {
    pack: commandPack, check: commandCheck, inventory: commandInventory, publish: commandPublish,
    'sibling-plan': commandSiblingPlan, 'sibling-collect': commandSiblingCollect,
  };
  if (!commands[command]) throw new GuardError(`unknown command ${JSON.stringify(command)} (pack|check|inventory|publish|sibling-plan|sibling-collect)`);
  return commands[command](opts, deps);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      const message = error instanceof GuardError ? error.message : error.stack;
      process.stdout.write(`::error title=Publishable manifest::${escapeData(`ERROR: ${message}`)}\n`);
      process.exit(1);
    },
  );
}
