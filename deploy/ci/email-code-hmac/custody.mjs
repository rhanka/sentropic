// Tenant custody CLI for the email-code HMAC key ring (method qk-secret-custody-r2 §2).
// Subcommands: generate | rotate-begin | rotate-promote | rotate-retire |
// fingerprint | verify-vector | deposit. The key value never leaves process
// memory except through the private-descriptor .env write and the gh stdin pipe.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIERS, KEY_RE, REF_RE, Refusal, refuse, keyedFingerprint, testVectorOf, keyRefOf, fp16Of, refTier, refFp16,
  varNames, ghNames, parseEnv, getVar, setVar, delVar, renderEnv, readEnvFile,
  checkEnvFilePreconditions, writeEnvFileAtomic, generateKeyBytes, assertFingerprintDistinct, readPair, assertValidPair,
} from './core.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--deposit') args.deposit = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (i + 1 >= argv.length) refuse('email_code_hmac_env_refused', `missing value for ${a}`);
      if (key === 'expect') (args.expect ??= []).push(argv[++i]);
      else args[key] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

function loadModel(args) {
  const envFile = checkEnvFilePreconditions(args.envfile, args.repoRoot);
  return { envFile, model: readEnvFile(envFile) };
}

function persist(args, model) {
  if (args.dryRun) return;
  writeEnvFileAtomic(args.envfile, renderEnv(model));
}

function emitReceipt(tier, slot, keyHex) {
  // Exactly the five allowed output items (method §2.2 item 5): tier, slot,
  // keyRef, fingerprint, test vector — plus the deposit/registry instruction.
  console.log(JSON.stringify({
    tier, slot,
    keyRef: keyRefOf(tier, keyHex),
    fingerprint: keyedFingerprint(keyHex),
    testVector: testVectorOf(keyHex),
    next: 'deposit the GitHub environment pair (gh secret set / gh variable set) and record ref, fingerprint and test vector in docs/runbooks/email-code-hmac-cred-cycle.md',
  }));
}

function generateInto(args, tier, slot) {
  const { model } = loadModel(args);
  const target = readPair(model, tier, slot);
  const other = readPair(model, tier, slot === 'active' ? 'previous' : 'active');
  if (slot === 'active' && target.present) refuse('email_code_hmac_env_refused', 'ACTIVE slot already occupied (generate is create-only)');
  if (slot === 'previous') {
    if (!other.present || !other.complete) refuse('email_code_hmac_env_refused', 'ACTIVE pair missing (previous-without-active is refused)');
    if (target.present) refuse('email_code_hmac_env_refused', 'PREVIOUS slot already occupied (retire first)');
    assertValidPair(tier, 'active', other);
  }
  const keyBytes = generateKeyBytes();
  try {
    const keyHex = keyBytes.toString('hex');
    assertFingerprintDistinct(model, keyHex);
    const names = varNames(tier);
    if (!args.dryRun) {
      setVar(model, slot === 'active' ? names.active : names.previous, keyHex);
      setVar(model, slot === 'active' ? names.activeRef : names.previousRef, keyRefOf(tier, keyHex));
      persist(args, model);
    }
    emitReceipt(tier, slot, keyHex);
    if (args.deposit && !args.dryRun) depositTier(args, tier);
    return keyHex;
  } finally {
    keyBytes.fill(0);
  }
}

function cmdPromote(args, tier) {
  const { model } = loadModel(args);
  const active = readPair(model, tier, 'active');
  const previous = readPair(model, tier, 'previous');
  if (!active.complete || !previous.complete) refuse('email_code_hmac_env_refused', 'promote needs both ACTIVE and PREVIOUS pairs complete');
  assertValidPair(tier, 'active', active);
  assertValidPair(tier, 'previous', previous);
  if (active.ref === previous.ref) refuse('email_code_hmac_env_refused', 'ACTIVE and PREVIOUS refs are identical');
  const names = varNames(tier);
  if (!args.dryRun) {
    setVar(model, names.active, previous.value);
    setVar(model, names.activeRef, previous.ref);
    setVar(model, names.previous, active.value);
    setVar(model, names.previousRef, active.ref);
    persist(args, model);
  }
  console.log(JSON.stringify({ tier, slot: 'promoted', activeRef: previous.ref, previousRef: active.ref, dryRun: Boolean(args.dryRun) }));
  if (args.deposit && !args.dryRun) depositTier(args, tier);
}

function cmdRetire(args, tier) {
  if (!args.proof) refuse('email_code_hmac_env_refused', 'retire requires --proof <attestation file>');
  const { model } = loadModel(args);
  const active = readPair(model, tier, 'active');
  const previous = readPair(model, tier, 'previous');
  if (!active.complete) refuse('email_code_hmac_env_refused', 'ACTIVE pair missing');
  if (!previous.complete) refuse('email_code_hmac_env_refused', 'PREVIOUS pair absent (nothing to retire)');
  assertValidPair(tier, 'active', active);
  assertValidPair(tier, 'previous', previous);
  let proof;
  try { proof = JSON.parse(readFileSync(args.proof, 'utf8')); }
  catch { refuse('email_code_hmac_env_refused', 'proof file unreadable or invalid JSON'); }
  if (proof.keyRef !== previous.ref || proof.pendingCount !== 0 || typeof proof.checkedAt !== 'string') {
    refuse('email_code_hmac_env_refused', 'proof does not attest zero pending rows for the PREVIOUS ref (method §4.4)');
  }
  const names = varNames(tier);
  if (!args.dryRun) {
    delVar(model, names.previous);
    delVar(model, names.previousRef);
    persist(args, model);
  }
  console.log(JSON.stringify({ tier, slot: 'retired', keyRef: previous.ref, proofCheckedAt: proof.checkedAt, dryRun: Boolean(args.dryRun) }));
  if (args.deposit && !args.dryRun) depositTier(args, tier, ['previous'], 'delete');
}

function cmdFingerprint(args, tier) {
  const { model } = loadModel(args);
  const out = { tier, active: null, previous: null };
  for (const slot of ['active', 'previous']) {
    const pair = readPair(model, tier, slot);
    if (!pair.present) continue;
    assertValidPair(tier, slot, pair);
    out[slot] = { keyRef: pair.ref, fingerprint: keyedFingerprint(pair.value) };
  }
  if (!out.active) refuse('email_code_hmac_env_refused', 'no ACTIVE pair present');
  console.log(JSON.stringify(out));
}

function cmdVerifyVector(args, tier) {
  const { model } = loadModel(args);
  const expects = args.expect ?? [];
  if (!expects.length) refuse('email_code_hmac_env_refused', 'verify-vector requires --expect <keyRef>=<testVector>');
  const pairs = {};
  for (const slot of ['active', 'previous']) {
    const pair = readPair(model, tier, slot);
    if (pair.present) { assertValidPair(tier, slot, pair); pairs[pair.ref] = pair; }
  }
  let ok = true;
  for (const e of expects) {
    const eq = e.indexOf('=');
    if (eq <= 0) refuse('email_code_hmac_env_refused', 'expect must be <keyRef>=<testVector>');
    const ref = e.slice(0, eq), expected = e.slice(eq + 1);
    const pair = pairs[ref];
    const match = Boolean(pair) && REF_RE.test(ref) && refTier(ref) === tier && testVectorOf(pair.value) === expected;
    if (!match) ok = false;
    console.log(JSON.stringify({ keyRef: ref, match }));
  }
  if (!ok) process.exitCode = 1;
}

function gh(args_, input) {
  const result = spawnSync('gh', args_, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) refuse('email_code_hmac_deposit_failed', args_.join(' '));
}

function depositTier(args, tier, slots = ['active', 'previous'], mode = 'set') {
  const t = TIERS[tier];
  if (!t.ghEnvironment) refuse('email_code_hmac_env_refused', 'test tier has no GitHub environment (no deposit)');
  const repo = args.repo || process.env.GH_REPO || 'rhanka/sentropic';
  const { model } = loadModel(args);
  for (const slot of slots) {
    const pair = readPair(model, tier, slot);
    const names = ghNames(slot);
    if (mode === 'delete') {
      if (!pair.present) continue;
      gh(['secret', 'delete', names.value, '--env', t.ghEnvironment, '--repo', repo], '');
      gh(['variable', 'delete', names.ref, '--env', t.ghEnvironment, '--repo', repo], '');
      console.log(JSON.stringify({ tier, slot, ghEnvironment: t.ghEnvironment, valueSecret: names.value, refVariable: names.ref, action: 'deleted', keyRef: pair.ref }));
      continue;
    }
    if (!pair.present) continue;
    assertValidPair(tier, slot, pair);
    // Value travels only on stdin; the ref is metadata and also goes via stdin.
    gh(['secret', 'set', names.value, '--env', t.ghEnvironment, '--repo', repo], pair.value);
    gh(['variable', 'set', names.ref, '--env', t.ghEnvironment, '--repo', repo], pair.ref);
    console.log(JSON.stringify({ tier, slot, ghEnvironment: t.ghEnvironment, valueSecret: names.value, refVariable: names.ref, action: 'set', keyRef: pair.ref }));
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [cmd, tier] = args._;
  if (!cmd || !tier || !TIERS[tier]) {
    console.error('usage: custody.mjs <generate|rotate-begin|rotate-promote|rotate-retire|fingerprint|verify-vector|deposit> <preprod|prod|test> [--envfile P] [--repo R] [--dry-run] [--deposit] [--proof P] [--expect ref=vector]');
    process.exitCode = 1;
    return;
  }
  args.envfile = resolve(args.envfile || (tier === 'test' ? `.env.${process.env.ENV || 'test'}` : '.env'));
  switch (cmd) {
    case 'generate': generateInto(args, tier, 'active'); return;
    case 'rotate-begin': generateInto(args, tier, 'previous'); return;
    case 'rotate-promote': cmdPromote(args, tier); return;
    case 'rotate-retire': cmdRetire(args, tier); return;
    case 'fingerprint': cmdFingerprint(args, tier); return;
    case 'verify-vector': cmdVerifyVector(args, tier); return;
    case 'deposit': depositTier(args, tier); return;
    default:
      console.error(`unknown subcommand: ${cmd}`);
      process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    if (error instanceof Refusal) console.error(error.message);
    else console.error('email_code_hmac_env_refused internal');
    process.exitCode = 1;
  }
}

// Re-exports for the selftest and the workflow materialize logic.
export { keyedFingerprint, testVectorOf, keyRefOf, fp16Of, refTier, refFp16, KEY_RE, REF_RE, varNames, ghNames, parseEnv, getVar, setVar, delVar, renderEnv, readEnvFile, writeEnvFileAtomic, generateKeyBytes, assertFingerprintDistinct, readPair, assertValidPair, TIERS };
