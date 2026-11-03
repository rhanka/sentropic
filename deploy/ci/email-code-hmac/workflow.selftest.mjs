// K3 selftests (method qk-secret-custody-r2 §7.3): the workflow materialize
// logic — ring validation, manifest shape, keyed-fingerprint logging — plus
// end-to-end runs of workflow.mjs against a stub kubectl, and raw structural
// checks of the workflow YAML and the Makefile wiring.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_RE, keyedFingerprint, keyRefOf } from './core.mjs';
import { applyResultOk, buildManifest, NAMESPACES, ROLLOUT_DEPLOYMENT, summaryLine, validateRing } from './materialize.mjs';
import { CUSTODY, KUBECTL_STUB, ROOT, TOOL_DIR, WORKFLOW, readFileSync, readJsonLines, rmSync, run, scratch, statSync, writeStub } from './selftest-kit.mjs';

const synthetic = label => createHash('sha256').update(`synthetic-${label}`).digest('hex');

export function workflowTests(check) {
  const active = synthetic('active'), previous = synthetic('previous');
  const activeRef = keyRefOf('preprod', active), previousRef = keyRefOf('preprod', previous);

  check('validateRing accepts a well-formed ring and refuses every invalid shape pre-apply', () => {
    const ring = validateRing({ tier: 'preprod', active, activeRef, previous, previousRef });
    assert.equal(ring.activeRef, activeRef);
    assert.equal(ring.previousRef, previousRef);
    assert.equal(ring.activeFingerprint, keyedFingerprint(active));
    assert.equal(ring.previousFingerprint, keyedFingerprint(previous));
    // bootstrap shape: no previous at all (unset or empty string both mean absent)
    const boot = validateRing({ tier: 'preprod', active, activeRef, previous: undefined, previousRef: undefined });
    assert.equal(boot.previousRef, null);
    const bootEmpty = validateRing({ tier: 'preprod', active, activeRef, previous: '', previousRef: '' });
    assert.equal(bootEmpty.previousRef, null);
    const bad = [
      [{ tier: 'preprod', active: '', activeRef }, 'email_code_hmac_credential_invalid'],
      [{ tier: 'preprod', active: active.toUpperCase(), activeRef }, 'email_code_hmac_credential_invalid'],
      [{ tier: 'preprod', active: active.slice(1), activeRef }, 'email_code_hmac_credential_invalid'],
      [{ tier: 'preprod', active: 'g'.repeat(64), activeRef }, 'email_code_hmac_credential_invalid'],
      [{ tier: 'preprod', active, activeRef: undefined }, 'email_code_hmac_ref_mismatch'],
      [{ tier: 'preprod', active, activeRef: keyRefOf('prod', active) }, 'email_code_hmac_ref_mismatch'],
      [{ tier: 'preprod', active, activeRef: `email-code-hmac:v1:preprod:${'0'.repeat(16)}` }, 'email_code_hmac_ref_mismatch'],
      [{ tier: 'preprod', active, activeRef, previous, previousRef: undefined }, 'email_code_hmac_credential_invalid'],
      [{ tier: 'preprod', active, activeRef, previous, previousRef: keyRefOf('preprod', active) }, 'email_code_hmac_ref_mismatch'],
      [{ tier: 'preprod', active: undefined, activeRef, previous, previousRef }, 'email_code_hmac_credential_invalid'],
    ];
    for (const [input, code] of bad) assert.throws(() => validateRing(input), err => err.message === code, JSON.stringify(input));
  });

  check('buildManifest carries exactly the §1.2 keys, base64 values, no empty-string keys', () => {
    const full = buildManifest({ namespace: 'sentropic-preprod', active, activeRef, previous, previousRef });
    assert.deepEqual(Object.keys(full.data).sort(), [
      'EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF',
      'EMAIL_CODE_HMAC_KEY_PREVIOUS', 'EMAIL_CODE_HMAC_KEY_PREVIOUS_REF',
    ]);
    assert.equal(Buffer.from(full.data.EMAIL_CODE_HMAC_KEY_ACTIVE, 'base64').toString('utf8'), active);
    assert.equal(Buffer.from(full.data.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF, 'base64').toString('utf8'), previousRef);
    assert.equal(full.kind, 'Secret');
    assert.equal(full.type, 'Opaque');
    assert.deepEqual(full.metadata, { name: 'email-code-hmac', namespace: 'sentropic-preprod' });
    const boot = buildManifest({ namespace: 'sentropic-preprod', active, activeRef, previous: undefined, previousRef: undefined });
    assert.deepEqual(Object.keys(boot.data).sort(), ['EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF']);
    for (const v of Object.values(full.data)) assert.ok(v.length > 0, 'no empty-string data keys');
  });

  check('summary line logs the keyed fingerprint, never a bare hash of the value', () => {
    const ring = validateRing({ tier: 'preprod', active, activeRef, previous, previousRef });
    const line = JSON.parse(summaryLine({ namespace: 'sentropic-preprod', ring }));
    assert.equal(line.name, 'email-code-hmac');
    assert.equal(line.namespace, 'sentropic-preprod');
    assert.equal(line.status, 'serverside-applied');
    assert.equal(line.activeFingerprint, keyedFingerprint(active));
    const bare = createHash('sha256').update(active, 'utf8').digest('hex');
    assert.notEqual(line.activeFingerprint, bare);
    assert.notEqual(line.activeFingerprint, bare.slice(0, 16));
    assert.ok(!JSON.stringify(line).includes(active), 'summary must not contain the value');
    assert.ok(applyResultOk('secret/email-code-hmac serverside-applied\n'));
    assert.ok(!applyResultOk('secret/email-code-hmac created\n'));
    assert.ok(!applyResultOk('secret/email-code-hmac configured\n'));
  });

  check('workflow.mjs end-to-end against a stub kubectl: configure, preflight, materialize, rollout, cleanup', () => {
    const dir = scratch('wf');
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'kubectl', KUBECTL_STUB);
      const runnerTemp = join(dir, 'runner-temp');
      mkdirSync(runnerTemp);
      const base = {
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
        KUBECTL_STUB_LOG: join(dir, 'kubectl.log'),
        KUBECTL_STUB_MANIFEST: join(dir, 'manifest.json'),
        KUBECTL_STUB_MODE: 'ok',
        KUBE_CONFIG_DATA_EMAIL_CODE_HMAC: Buffer.from('apiVersion: v1\nkind: Config\nclusters: []\n', 'utf8').toString('base64'),
      };
      // configure: kubeconfig materialized 0600, payload never printed
      let r = run(WORKFLOW, ['configure'], base);
      assert.equal(r.status, 0, r.stderr);
      const kubeconfig = join(runnerTemp, 'email-code-hmac', 'kubeconfig');
      assert.equal(statSync(kubeconfig).mode & 0o777, 0o600);
      assert.ok(!r.stdout.includes('apiVersion') && !r.stderr.includes('apiVersion'));
      // preflight ok: name-only get + can-i matrix, never list/create
      r = run(WORKFLOW, ['preflight', 'preprod'], base);
      assert.equal(r.status, 0, r.stderr);
      const calls = readJsonLines(join(dir, 'kubectl.log'));
      assert.ok(calls.some(c => c.join(' ').includes('get secret email-code-hmac -o name')));
      assert.ok(calls.filter(c => c.includes('auth')).length >= 6);
      for (const c of calls) {
        assert.ok(!c.includes('list'), 'workflow must never list Secrets');
        assert.ok(!c.includes('create'), 'workflow must never create');
      }
      // materialize with both pairs
      r = run(WORKFLOW, ['materialize', 'preprod'], {
        ...base,
        EMAIL_CODE_HMAC_KEY_ACTIVE: active,
        EMAIL_CODE_HMAC_KEY_ACTIVE_REF: activeRef,
        EMAIL_CODE_HMAC_KEY_PREVIOUS: previous,
        EMAIL_CODE_HMAC_KEY_PREVIOUS_REF: previousRef,
      });
      assert.equal(r.status, 0, r.stderr);
      const line = JSON.parse(r.stdout.trim());
      assert.equal(line.name, 'email-code-hmac');
      assert.equal(line.namespace, 'sentropic-preprod');
      assert.equal(line.activeRef, activeRef);
      assert.equal(line.previousRef, previousRef);
      assert.equal(line.activeFingerprint, keyedFingerprint(active));
      assert.ok(!r.stdout.includes(active) && !r.stdout.includes(previous) && !r.stderr.includes(active), 'value leaked into workflow output');
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      assert.deepEqual(Object.keys(manifest.data).sort(), [
        'EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF',
        'EMAIL_CODE_HMAC_KEY_PREVIOUS', 'EMAIL_CODE_HMAC_KEY_PREVIOUS_REF',
      ]);
      const applyCall = readJsonLines(join(dir, 'kubectl.log')).find(c => c.includes('apply'));
      assert.ok(applyCall.includes('--server-side'));
      assert.ok(applyCall.includes('--field-manager=email-code-hmac-secret'));
      assert.ok(!applyCall.includes(active) && !applyCall.includes(previous), 'value must not be an argv element');
      // materialize bootstrap shape: ACTIVE only -> two data keys
      r = run(WORKFLOW, ['materialize', 'preprod'], { ...base, EMAIL_CODE_HMAC_KEY_ACTIVE: active, EMAIL_CODE_HMAC_KEY_ACTIVE_REF: activeRef });
      assert.equal(r.status, 0, r.stderr);
      const bootManifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      assert.deepEqual(Object.keys(bootManifest.data).sort(), ['EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF']);
      // rollout + cleanup
      r = run(WORKFLOW, ['rollout', 'preprod'], base);
      assert.equal(r.status, 0, r.stderr);
      const rolloutCalls = readJsonLines(join(dir, 'kubectl.log')).filter(c => c.join(' ').includes('rollout'));
      assert.ok(rolloutCalls.some(c => c.join(' ').includes(`rollout restart deployment/${ROLLOUT_DEPLOYMENT}`)));
      assert.ok(rolloutCalls.some(c => c.join(' ').includes('rollout status')));
      r = run(WORKFLOW, ['cleanup'], base);
      assert.equal(r.status, 0);
      assert.throws(() => statSync(join(runnerTemp, 'email-code-hmac')), { code: 'ENOENT' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  check('workflow.mjs refuses pre-apply on bad input and never attempts create', () => {
    const dir = scratch('wfbad');
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeStub(bin, 'kubectl', KUBECTL_STUB);
      const runnerTemp = join(dir, 'runner-temp');
      mkdirSync(runnerTemp);
      const base = {
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
        KUBECTL_STUB_LOG: join(dir, 'kubectl.log'),
        KUBECTL_STUB_MANIFEST: join(dir, 'manifest.json'),
        KUBE_CONFIG_DATA_EMAIL_CODE_HMAC: Buffer.from('apiVersion: v1\n', 'utf8').toString('base64'),
      };
      assert.equal(run(WORKFLOW, ['configure'], base).status, 0);
      // shell missing -> fixed code, no create attempted
      let r = run(WORKFLOW, ['preflight', 'preprod'], { ...base, KUBECTL_STUB_MODE: 'no-shell' });
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), 'email_code_hmac_shell_missing');
      // writer forbidden
      r = run(WORKFLOW, ['preflight', 'prod'], { ...base, KUBECTL_STUB_MODE: 'forbidden' });
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), 'email_code_hmac_writer_forbidden');
      // ref/fp16 mismatch refused before any apply
      r = run(WORKFLOW, ['materialize', 'preprod'], {
        ...base, KUBECTL_STUB_MODE: 'ok',
        EMAIL_CODE_HMAC_KEY_ACTIVE: active,
        EMAIL_CODE_HMAC_KEY_ACTIVE_REF: `email-code-hmac:v1:preprod:${'0'.repeat(16)}`,
      });
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), 'email_code_hmac_ref_mismatch');
      assert.ok(!r.stdout.includes(active));
      // previous without active refused
      r = run(WORKFLOW, ['materialize', 'preprod'], {
        ...base,
        EMAIL_CODE_HMAC_KEY_PREVIOUS: previous, EMAIL_CODE_HMAC_KEY_PREVIOUS_REF: previousRef,
      });
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), 'email_code_hmac_credential_invalid');
      // apply returning "created" (not serverside-applied) fails closed
      r = run(WORKFLOW, ['materialize', 'preprod'], {
        ...base, KUBECTL_STUB_MODE: 'created',
        EMAIL_CODE_HMAC_KEY_ACTIVE: active, EMAIL_CODE_HMAC_KEY_ACTIVE_REF: activeRef,
      });
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), 'email_code_hmac_apply_failed');
      assert.ok(!r.stdout.includes(active) && !r.stderr.includes(active));
      const calls = readJsonLines(join(dir, 'kubectl.log'));
      assert.ok(calls.every(c => !c.includes('create') && !c.includes('list')), 'no create/list ever issued');
      const applies = calls.filter(c => c.includes('apply'));
      assert.equal(applies.length, 1, 'only the well-formed materialize attempt reached apply');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  check('workflow YAML is dispatch-only, protected, main+tier gated, env-bound and always cleans up', () => {
    const yml = readFileSync(join(ROOT, '.github/workflows/email-code-hmac-secret.yml'), 'utf8');
    assert.ok(yml.startsWith('name: Email-code HMAC Secret\n'));
    assert.ok(!/^\s*(push|schedule):/m.test(yml), 'dispatch-only');
    assert.match(yml, /^on:\n  workflow_dispatch:/m);
    assert.match(yml, /^permissions:\n  contents: read$/m);
    assert.match(yml, /cancel-in-progress: false/);
    assert.match(yml, /group: email-code-hmac-secret-\$\{\{ inputs\.tier \}\}/);
    for (const job of ['selftest', 'materialize-preprod', 'materialize-prod']) assert.ok(yml.includes(`${job}:`), job);
    assert.ok(yml.includes('environment: sentropic-idp-run'));
    assert.ok(yml.includes('environment: sentropic-idp-prod'));
    assert.ok(yml.includes("if: github.ref == 'refs/heads/main' && inputs.tier == 'preprod'"));
    assert.ok(yml.includes("if: github.ref == 'refs/heads/main' && inputs.tier == 'prod'"));
    assert.ok(yml.includes('run: make test-email-code-hmac-selftest ENV=test-email-code-hmac'));
    assert.ok(yml.includes('secrets.KUBE_CONFIG_DATA_EMAIL_CODE_HMAC'));
    for (const name of ['EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_PREVIOUS']) assert.ok(yml.includes(`secrets.${name}`), name);
    for (const name of ['EMAIL_CODE_HMAC_KEY_ACTIVE_REF', 'EMAIL_CODE_HMAC_KEY_PREVIOUS_REF']) assert.ok(yml.includes(`vars.${name}`), name);
    // expressions belong in env:, never in run commands
    for (const line of yml.split('\n')) {
      if (/^\s*run:/.test(line)) assert.ok(!line.includes('${{'), `run command carries an expression: ${line}`);
    }
    assert.ok(!/printenv|set -x|\becho\b/.test(yml), 'no echo/printenv/set -x in the workflow');
    assert.ok(!/kubectl (create|list)|--from-literal/.test(yml), 'no create/list/from-literal');
    assert.match(yml, /if: always\(\)/);
    assert.ok(yml.includes('rollout'));
    assert.ok(yml.includes('workflow.mjs cleanup'));
  });

  check('Makefile wires the seven reviewed targets with ENV guards', () => {
    const mk = readFileSync(join(ROOT, 'Makefile'), 'utf8');
    for (const t of ['email-code-hmac-generate', 'email-code-hmac-rotate-begin', 'email-code-hmac-rotate-promote',
      'email-code-hmac-rotate-retire', 'email-code-hmac-fingerprint', 'email-code-hmac-verify-vector', 'test-email-code-hmac-selftest']) {
      assert.ok(mk.includes(`${t}:`), `missing target ${t}`);
    }
    assert.ok(mk.includes('case "$(ENV)" in preprod|prod|test-*|e2e-*)'));
    assert.ok(mk.includes('case "$(ENV)" in test-*) ;; *) echo "ERROR: use ENV=test-*"; exit 1 ;; esac'));
    assert.ok(mk.includes('EMAIL_CODE_HMAC_DEPOSIT_FLAG = $(if $(filter preprod prod,$(ENV)),--deposit,)'));
    assert.ok(mk.includes('node deploy/ci/email-code-hmac/custody.mjs'));
    assert.ok(mk.includes('node deploy/ci/email-code-hmac/selftest.mjs'));
  });

  check('no literal 64-hex key material in any committed source of this lane', () => {
    const files = readdirSync(TOOL_DIR).filter(f => f.endsWith('.mjs')).map(f => join(TOOL_DIR, f));
    files.push(join(ROOT, '.github/workflows/email-code-hmac-secret.yml'));
    for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /\b[a-f0-9]{64}\b/, `literal 64-hex in ${f}`);
  });

  check('custody.mjs is importable and its CLI entrypoint guard works', () => {
    assert.match(readFileSync(CUSTODY, 'utf8'), /fileURLToPath\(import\.meta\.url\)/);
    assert.match(KEY_RE.source, /a-f0-9/);
    assert.equal(NAMESPACES.preprod, 'sentropic-preprod');
    assert.equal(NAMESPACES.prod, 'sentropic');
  });
}
