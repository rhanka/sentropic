// K2 selftests (method qk-secret-custody-r2 §7.3): generation on a scratch env
// file, slot preconditions, dry-run, and the no-print assertion (the selftest
// reads the value privately and asserts it never appears in captured output).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_RE, REF_RE, keyedFingerprint, testVectorOf, keyRefOf, parseEnv, getVar, assertFingerprintDistinct, Refusal } from './core.mjs';
import { CUSTODY, GIT_STUB, GH_STUB, envFileWith, readFileSync, readJsonLines, rmSync, run, scratch, statSync, writeFileSync, writeStub } from './selftest-kit.mjs';

const synthetic = label => createHash('sha256').update(`synthetic-${label}`).digest('hex');

export function custodyTests(check) {
  check('generate (dry-run) writes nothing and prints only the five allowed items', () => {
    const dir2 = scratch('dryrun');
    try {
      const bin = join(dir2, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'git', GIT_STUB);
      const envFile = envFileWith(dir2, '.env.test-x', ['UNRELATED=keep-me', '# comment stays', 'OTHER=1']);
      const before = readFileSync(envFile, 'utf8');
      const r = run(CUSTODY, ['generate', 'test', '--envfile', envFile, '--repo-root', dir2, '--dry-run'], {
        PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '.env.test-x',
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(envFile, 'utf8'), before, 'dry-run must not touch the env file');
      const out = JSON.parse(r.stdout.trim());
      assert.equal(out.tier, 'test');
      assert.equal(out.slot, 'active');
      assert.match(out.keyRef, /^email-code-hmac:v1:test:[a-f0-9]{16}$/);
      assert.match(out.fingerprint, /^[a-f0-9]{64}$/);
      assert.match(out.testVector, /^[a-f0-9]{64}$/);
      assert.equal(out.keyRef.split(':').at(-1), out.fingerprint.slice(0, 16));
      assert.equal(r.stderr, '');
    } finally { rmSync(dir2, { recursive: true, force: true }); }
  });

  check('generate writes 64-hex into the ACTIVE slot, preserves mode and unrelated lines, never prints the value', () => {
    const dir = scratch('gen');
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'git', GIT_STUB);
      const envFile = envFileWith(dir, '.env.test-x', ['UNRELATED=keep-me', '# comment stays', 'OTHER=1']);
      const r = run(CUSTODY, ['generate', 'test', '--envfile', envFile, '--repo-root', dir], {
        PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '.env.test-x',
      });
      assert.equal(r.status, 0, r.stderr);
      const value = getVar(parseEnv(readFileSync(envFile, 'utf8')), 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE');
      assert.match(value, KEY_RE);
      const ref = getVar(parseEnv(readFileSync(envFile, 'utf8')), 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE_REF');
      assert.equal(ref, keyRefOf('test', value));
      assert.equal((statSync(envFile).mode & 0o777), 0o600, 'mode 0600 preserved');
      const content = readFileSync(envFile, 'utf8');
      assert.ok(content.includes('UNRELATED=keep-me') && content.includes('# comment stays') && content.includes('OTHER=1'));
      // no-print assertion: the value is compared privately, never logged
      assert.ok(!r.stdout.includes(value) && !r.stderr.includes(value), 'value leaked into output');
      const out = JSON.parse(r.stdout.trim());
      assert.equal(out.fingerprint, keyedFingerprint(value));
      assert.equal(out.testVector, testVectorOf(value));
      // second generate refuses (create-only)
      const again = run(CUSTODY, ['generate', 'test', '--envfile', envFile, '--repo-root', dir], {
        PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '.env.test-x',
      });
      assert.equal(again.status, 1);
      assert.match(again.stderr, /^email_code_hmac_env_refused/);
      assert.ok(!again.stdout.includes(value) && !again.stderr.includes(value));
      assert.equal(readFileSync(envFile, 'utf8'), content, 'refused write must leave the file untouched');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  check('generate refuses a tracked or wrong-mode env file', () => {
    const dir = scratch('refuse');
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'git', GIT_STUB);
      const tracked = envFileWith(dir, 'tracked.env', ['A=1']);
      let r = run(CUSTODY, ['generate', 'test', '--envfile', tracked, '--repo-root', dir], {
        PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '',
      });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^email_code_hmac_env_refused/);
      const wrongMode = envFileWith(dir, '.env.wrong', ['A=1'], 0o644);
      r = run(CUSTODY, ['generate', 'test', '--envfile', wrongMode, '--repo-root', dir], {
        PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '.env.wrong',
      });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /mode is not 0600/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  check('cross-tier fingerprint-difference refusal', () => {
    const key = synthetic('cross-tier');
    const model = parseEnv(`PROD_EMAIL_CODE_HMAC_KEY_ACTIVE=${key}\nPROD_EMAIL_CODE_HMAC_KEY_ACTIVE_REF=${keyRefOf('prod', key)}\n`);
    assert.throws(() => assertFingerprintDistinct(model, key), Refusal);
    assert.doesNotThrow(() => assertFingerprintDistinct(model, synthetic('other')));
  });

  check('three-phase rotation flow with proof-gated retire', () => {
    const dir = scratch('rot');
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'git', GIT_STUB);
      const envFile = envFileWith(dir, '.env.test-x', ['UNRELATED=1']);
      const base = { PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '.env.test-x' };
      assert.equal(run(CUSTODY, ['generate', 'test', '--envfile', envFile, '--repo-root', dir], base).status, 0);
      let model = parseEnv(readFileSync(envFile, 'utf8'));
      const activeRef1 = getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE_REF');
      // rotate-begin: PREVIOUS occupied, ACTIVE unchanged
      let r = run(CUSTODY, ['rotate-begin', 'test', '--envfile', envFile, '--repo-root', dir], base);
      assert.equal(r.status, 0, r.stderr);
      model = parseEnv(readFileSync(envFile, 'utf8'));
      const prevRef1 = getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_PREVIOUS_REF');
      assert.ok(prevRef1 && REF_RE.test(prevRef1));
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE_REF'), activeRef1);
      const activeValue1 = getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE');
      const prevValue1 = getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_PREVIOUS');
      assert.ok(!r.stdout.includes(activeValue1) && !r.stdout.includes(prevValue1) && !r.stderr.includes(prevValue1));
      // rotate-begin again refuses (PREVIOUS occupied)
      r = run(CUSTODY, ['rotate-begin', 'test', '--envfile', envFile, '--repo-root', dir], base);
      assert.equal(r.status, 1);
      // promote swaps the slots atomically
      r = run(CUSTODY, ['rotate-promote', 'test', '--envfile', envFile, '--repo-root', dir], base);
      assert.equal(r.status, 0, r.stderr);
      model = parseEnv(readFileSync(envFile, 'utf8'));
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE'), prevValue1);
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE_REF'), prevRef1);
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_PREVIOUS'), activeValue1);
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_PREVIOUS_REF'), activeRef1);
      // retire refuses without proof, and with a non-zero count
      r = run(CUSTODY, ['rotate-retire', 'test', '--envfile', envFile, '--repo-root', dir], base);
      assert.equal(r.status, 1);
      const badProof = join(dir, 'proof-bad.json');
      writeFileSync(badProof, JSON.stringify({ keyRef: activeRef1, pendingCount: 3, checkedAt: '2026-11-02T00:00:00Z' }));
      r = run(CUSTODY, ['rotate-retire', 'test', '--envfile', envFile, '--repo-root', dir, '--proof', badProof], base);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /proof does not attest zero/);
      // retire with the §4.4 zero-count proof
      const proof = join(dir, 'proof.json');
      writeFileSync(proof, JSON.stringify({ keyRef: activeRef1, pendingCount: 0, checkedAt: '2026-11-02T01:00:00Z' }));
      r = run(CUSTODY, ['rotate-retire', 'test', '--envfile', envFile, '--repo-root', dir, '--proof', proof], base);
      assert.equal(r.status, 0, r.stderr);
      model = parseEnv(readFileSync(envFile, 'utf8'));
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_PREVIOUS'), undefined);
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_PREVIOUS_REF'), undefined);
      assert.equal(getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE_REF'), prevRef1);
      assert.ok(readFileSync(envFile, 'utf8').includes('UNRELATED=1'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  check('fingerprint prints refs and fingerprints only; verify-vector matches per ref', () => {
    const dir = scratch('fp');
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'git', GIT_STUB);
      const envFile = envFileWith(dir, '.env.test-x', []);
      const base = { PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '.env.test-x' };
      assert.equal(run(CUSTODY, ['generate', 'test', '--envfile', envFile, '--repo-root', dir], base).status, 0);
      const model = parseEnv(readFileSync(envFile, 'utf8'));
      const value = getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE');
      const ref = getVar(model, 'TEST_EMAIL_CODE_HMAC_KEY_ACTIVE_REF');
      let r = run(CUSTODY, ['fingerprint', 'test', '--envfile', envFile, '--repo-root', dir], base);
      assert.equal(r.status, 0);
      const out = JSON.parse(r.stdout.trim());
      assert.equal(out.active.keyRef, ref);
      assert.equal(out.active.fingerprint, keyedFingerprint(value));
      assert.ok(!r.stdout.includes(value) && !r.stderr.includes(value), 'fingerprint output leaked the value');
      r = run(CUSTODY, ['verify-vector', 'test', '--envfile', envFile, '--repo-root', dir, '--expect', `${ref}=${testVectorOf(value)}`], base);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout.trim()), { keyRef: ref, match: true });
      r = run(CUSTODY, ['verify-vector', 'test', '--envfile', envFile, '--repo-root', dir, '--expect', `${ref}=${'0'.repeat(64)}`], base);
      assert.equal(r.status, 1);
      assert.deepEqual(JSON.parse(r.stdout.trim()), { keyRef: ref, match: false });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  check('deposit pipes the value to gh secret set on stdin, names only in output', () => {
    const dir = scratch('dep');
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'git', GIT_STUB);
      writeStub(bin, 'gh', GH_STUB);
      const envFile = envFileWith(dir, '.env', []);
      const base = { PATH: `${bin}:${process.env.PATH}`, GIT_STUB_IGNORED: '.env', GH_STUB_LOG: join(dir, 'gh.log') };
      assert.equal(run(CUSTODY, ['generate', 'preprod', '--envfile', envFile, '--repo-root', dir], base).status, 0);
      const r = run(CUSTODY, ['deposit', 'preprod', '--envfile', envFile, '--repo-root', dir, '--repo', 'rhanka/sentropic'], base);
      assert.equal(r.status, 0, r.stderr);
      const model = parseEnv(readFileSync(envFile, 'utf8'));
      const value = getVar(model, 'PREPROD_EMAIL_CODE_HMAC_KEY_ACTIVE');
      const ref = getVar(model, 'PREPROD_EMAIL_CODE_HMAC_KEY_ACTIVE_REF');
      const calls = readJsonLines(join(dir, 'gh.log'));
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0].argv, ['secret', 'set', 'EMAIL_CODE_HMAC_KEY_ACTIVE', '--env', 'sentropic-idp-run', '--repo', 'rhanka/sentropic']);
      assert.equal(calls[0].stdin, value, 'value must travel on stdin only');
      assert.ok(!calls[0].argv.includes(value), 'value must never be an argv element');
      assert.deepEqual(calls[1].argv, ['variable', 'set', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF', '--env', 'sentropic-idp-run', '--repo', 'rhanka/sentropic']);
      assert.equal(calls[1].stdin, ref);
      assert.ok(!r.stdout.includes(value) && !r.stderr.includes(value), 'deposit output leaked the value');
      assert.ok(r.stdout.includes('EMAIL_CODE_HMAC_KEY_ACTIVE') && r.stdout.includes('sentropic-idp-run'));
      // test tier has no GitHub environment
      const r2 = run(CUSTODY, ['deposit', 'test', '--envfile', envFile, '--repo-root', dir], base);
      assert.equal(r2.status, 1);
      assert.match(r2.stderr, /no GitHub environment/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
