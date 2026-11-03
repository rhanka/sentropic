// Core primitives for the email-code HMAC key custody (method qk-secret-custody-r2).
// A key value exists only in process memory and in the private file-descriptor
// write below: it is never printed, never passed as argv, never placed in a
// child-process environment.
import { createHmac, randomBytes } from 'node:crypto';
import { closeSync, constants, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECRET_NAME = 'email-code-hmac';
export const FIELD_MANAGER = 'email-code-hmac-secret';
export const FINGERPRINT_LABEL = 'sentropic/email-code-hmac/fingerprint/v1';
export const TEST_VECTOR_INPUT = JSON.stringify(['cm-email-code', '1', 'custody-test@example.invalid', '000000']);
export const KEY_RE = /^[a-f0-9]{64}$/;
export const REF_RE = /^email-code-hmac:v1:(prod|preprod|test):[a-f0-9]{16}$/;
export const KEY_REF_PREFIX = 'email-code-hmac:v1';

export const TIERS = {
  preprod: { prefix: 'PREPROD', namespace: 'sentropic-preprod', ghEnvironment: 'sentropic-idp-run' },
  prod: { prefix: 'PROD', namespace: 'sentropic', ghEnvironment: 'sentropic-idp-prod' },
  test: { prefix: 'TEST', namespace: null, ghEnvironment: null },
};

export class Refusal extends Error {
  constructor(code, reason) { super(reason ? `${code} ${reason}` : code); this.code = code; }
}

export const refuse = (code, reason) => { throw new Refusal(code, reason); };

export const defaultRepoRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function keyBytesOf(keyHex) { return Buffer.from(keyHex, 'hex'); }

// Keyed fingerprint over the fixed label (method §0.2): HMAC-SHA256(keyBytes, label).
// Never a bare hash of the key; safe to log and record.
export function keyedFingerprint(keyHex) {
  return createHmac('sha256', keyBytesOf(keyHex)).update(FINGERPRINT_LABEL, 'utf8').digest('hex');
}

export function fp16Of(keyHex) { return keyedFingerprint(keyHex).slice(0, 16); }

// HMAC test vector over the synthetic production-shape preimage (method §0.2).
export function testVectorOf(keyHex) {
  return createHmac('sha256', keyBytesOf(keyHex)).update(TEST_VECTOR_INPUT, 'utf8').digest('hex');
}

export function keyRefOf(tier, keyHex) { return `${KEY_REF_PREFIX}:${tier}:${fp16Of(keyHex)}`; }

export function refTier(ref) { const m = REF_RE.exec(ref || ''); return m ? m[1] : null; }

export function refFp16(ref) { return REF_RE.test(ref || '') ? ref.split(':').at(-1) : null; }

export function varNames(tier) {
  const p = TIERS[tier].prefix;
  return {
    active: `${p}_EMAIL_CODE_HMAC_KEY_ACTIVE`,
    previous: `${p}_EMAIL_CODE_HMAC_KEY_PREVIOUS`,
    activeRef: `${p}_EMAIL_CODE_HMAC_KEY_ACTIVE_REF`,
    previousRef: `${p}_EMAIL_CODE_HMAC_KEY_PREVIOUS_REF`,
  };
}

export function ghNames(slot) {
  return slot === 'active'
    ? { value: 'EMAIL_CODE_HMAC_KEY_ACTIVE', ref: 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF' }
    : { value: 'EMAIL_CODE_HMAC_KEY_PREVIOUS', ref: 'EMAIL_CODE_HMAC_KEY_PREVIOUS_REF' };
}

// --- .env model: unrelated lines are preserved byte-for-byte -----------------

const LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function parseEnv(content) {
  const lines = content.split('\n');
  const index = new Map();
  lines.forEach((line, i) => {
    const m = LINE_RE.exec(line);
    if (m && !index.has(m[1])) index.set(m[1], i);
  });
  return { lines, index };
}

export function getVar(model, name) {
  const i = model.index.get(name);
  if (i === undefined) return undefined;
  const m = LINE_RE.exec(model.lines[i]);
  return m ? m[2] : undefined;
}

export function setVar(model, name, value) {
  const line = `${name}=${value}`;
  const i = model.index.get(name);
  if (i === undefined) { model.lines.push(line); model.index.set(name, model.lines.length - 1); }
  else model.lines[i] = line;
}

export function delVar(model, name) {
  const i = model.index.get(name);
  if (i !== undefined) { model.lines[i] = null; model.index.delete(name); }
}

export function renderEnv(model) { return model.lines.filter(l => l !== null).join('\n'); }

export function readEnvFile(envFile) { return parseEnv(readFileSync(envFile, 'utf8')); }

// --- preconditions before any write (method §2.2 item 4) ---------------------

export function checkEnvFilePreconditions(envFile, repoRoot = defaultRepoRoot()) {
  let st;
  try { st = statSync(envFile); } catch { refuse('email_code_hmac_env_refused', 'env file missing'); }
  if (!st.isFile()) refuse('email_code_hmac_env_refused', 'env path is not a regular file');
  if ((st.mode & 0o777) !== 0o600) refuse('email_code_hmac_env_refused', 'env file mode is not 0600');
  const abs = resolve(envFile);
  const root = resolve(repoRoot);
  const rel = relative(root, abs);
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) {
    // Inside the repo: the file must be mechanically git-ignored.
    const r = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', rel], { encoding: 'utf8' });
    if (r.error || r.status !== 0) refuse('email_code_hmac_env_refused', 'env file is tracked or not git-ignored');
  }
  return abs;
}

// --- private-descriptor atomic write (method §2.2 item 3) ---------------------

export function writeEnvFileAtomic(envFile, content) {
  const dir = dirname(envFile);
  const tmp = join(dir, `.${basename(envFile)}.tmp-${randomBytes(8).toString('hex')}`);
  const prevUmask = process.umask(0o077);
  let fd;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, envFile);
    const dfd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } finally {
    process.umask(prevUmask);
    if (fd !== undefined) { try { closeSync(fd); } catch { /* best effort */ } }
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

// --- key generation (method §2.2 item 1) --------------------------------------

export function generateKeyBytes() { return randomBytes(32); }

// Refuse when the new fingerprint equals any current key fingerprint in the
// env file (method §1.2 / §2.2 item 4: cross-tier fingerprint-difference refusal).
export function assertFingerprintDistinct(model, newKeyHex) {
  const fp = keyedFingerprint(newKeyHex);
  for (const [name, i] of model.index) {
    if (!/_EMAIL_CODE_HMAC_KEY_(ACTIVE|PREVIOUS)$/.test(name)) continue;
    const value = getVar(model, name);
    if (value && KEY_RE.test(value) && keyedFingerprint(value) === fp) {
      refuse('email_code_hmac_env_refused', 'fingerprint collides with an existing tier key');
    }
    void i;
  }
}

export function readPair(model, tier, slot) {
  const names = varNames(tier);
  const valueName = slot === 'active' ? names.active : names.previous;
  const refName = slot === 'active' ? names.activeRef : names.previousRef;
  const value = getVar(model, valueName);
  const ref = getVar(model, refName);
  return { value, ref, valueName, refName, present: value !== undefined || ref !== undefined, complete: value !== undefined && ref !== undefined };
}

export function assertValidPair(tier, slot, pair) {
  if (!pair.complete) refuse('email_code_hmac_env_refused', `${slot} pair is incomplete (value/ref both-or-neither)`);
  if (!KEY_RE.test(pair.value)) refuse('email_code_hmac_env_refused', `${slot} value is not 64 lowercase hex`);
  if (!REF_RE.test(pair.ref) || refTier(pair.ref) !== tier) refuse('email_code_hmac_env_refused', `${slot} ref is malformed or wrong tier`);
  if (refFp16(pair.ref) !== fp16Of(pair.value)) refuse('email_code_hmac_env_refused', `${slot} ref does not match the value fingerprint`);
}
