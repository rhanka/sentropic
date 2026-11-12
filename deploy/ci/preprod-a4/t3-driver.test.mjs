import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RBAC_COUNT, buildProbes, checkRbac, classify, drive, loadSql, splitSql } from './t3-window-driver.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
import { poll } from './t3-watchdog.mjs';

const CANDIDATE = 'ghcr.io/rhanka/sentropic-api@sha256:candidate';
const UI_IMAGE = 'ghcr.io/rhanka/sentropic-ui@sha256:ui';

// Fault-injectable kubectl double: canned reads, recorded writes.
export function makeCall(scenario = {}) {
  const calls = [];
  const liveSecrets = { ...(scenario.secretData ?? {}) };
  const call = (args, input) => {
    calls.push(args.join(' '));
    const cmd = args.join(' ');
    if (cmd.startsWith('patch secret sentropic-api')) {
      const patch = JSON.parse(args[args.indexOf('-p') + 1]);
      for (const op of patch) delete liveSecrets[op.path.replace('/data/', '')];
      return '';
    }
    if (cmd.startsWith('auth can-i')) return 'yes';
    if (args[0] === 'exec') {
      const statement = String(input ?? '');
      if (statement.includes('journal_present')) return scenario.journal === false ? 'f|0\n' : 't|0\n';
      if (statement.includes('identity_committed')) return scenario.committed ? 't\n' : 'f\n';
      if (statement.includes('asset_column_present')) return 'f\n';
      if (statement.includes('AS k,')) return 'enc-key||3\n';
      return '\n';
    }
    if (cmd === 'get pods -l app.kubernetes.io/name=sentropic,app.kubernetes.io/component=api -o json'
      || cmd === 'get pods -l app.kubernetes.io/name=sentropic,app.kubernetes.io/component=auth-idp -o json'
      || cmd === 'get pods -l app.kubernetes.io/name=sentropic,app.kubernetes.io/component=ui -o json') {
      return JSON.stringify({ items: [] });
    }
    if (cmd === 'get secret sentropic-api -o json') return JSON.stringify({ data: liveSecrets });
    if (cmd === 'get cronjob sentropic-idp-identity-export -o json') {
      return JSON.stringify({ spec: { suspend: true } });
    }
    if (cmd === 'get deployment api -o json') return JSON.stringify(scenario.api ?? { spec: { replicas: 0 }, status: { replicas: 0 } });
    if (/^get (deployment|middleware|ingress|cronjob) /.test(cmd)) return '{}';
    return '';
  };
  return { call, calls };
}

export function makeCtx(overrides = {}) {
  const { call, calls } = makeCall(overrides.scenario ?? {});
  const printed = [];
  return {
    ctx: {
      call, printed,
      print: line => printed.push(line),
      dryRun: false, probeReadOnly: false, tier: 'preprod', postgresPod: 'postgres-0',
      stateDir: mkdtempSync(join(tmpdir(), 't3-test-')),
      probe: async () => ({ status: 200, body: { cancel: async () => {} } }),
      delivered: async () => '',
      config: {
        kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod', tier: 'preprod',
        candidateImage: CANDIDATE, revisions: { api: '12', 'auth-idp': '9', ui: '4' },
        images: { candidate: CANDIDATE, ui: UI_IMAGE },
        request: { format: 'x', operationId: 'test' },
        ...(overrides.config ?? {}),
      },
    },
    calls, printed,
  };
}

test('RBAC matrix covers exactly 50 couples', () => {
  assert.equal(RBAC_COUNT, 50);
});

test('classifier SQL is schema-safe and versioned', () => {
  const text = loadSql('t3-classify.sql');
  assert.match(text, /t3-classify-v1/);
  const parts = splitSql(text);
  assert.deepEqual(Object.keys(parts).sort(), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']);
  for (const q of Object.values(parts)) {
    assert.doesNotMatch(q, /control\.artifact_packages/);
    assert.doesNotMatch(q, /offline_grant_id/);
    assert.doesNotMatch(q, /authorization_codes\.\w*id/);
  }
  assert.doesNotMatch(text, /\bsettings\.id\b/);
});

test('classifier reports uncommitted on a journal-less database', () => {
  const { ctx } = makeCtx({ scenario: { journal: false } });
  assert.deepEqual(classify(ctx), { journal: false, locks: 0, committed: false, receipts: 0, apiReady: false });
});

test('classifier proves branch P only with commit marker and ready api', () => {
  const ready = { spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image: CANDIDATE }] } } },
    status: { readyReplicas: 1, observedGeneration: 7 }, metadata: { generation: 7 } };
  const { ctx } = makeCtx({ scenario: { journal: true, committed: true, api: ready } });
  const info = classify(ctx);
  assert.equal(info.committed, true);
  assert.equal(info.apiReady, true);
});

test('pre-commit rollback removes both rotated keys before any scale-up', () => {
  const { ctx, calls } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
  const out = preCommitRollback({ call: ctx.call, revisions: ctx.config.revisions });
  assert.deepEqual(out.removedKeys.sort(), ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY']);
  const joined = calls.join('\n');
  assert.match(joined, /patch secret sentropic-api/);
  const scaleUp = calls.findIndex(c => c === 'scale deployment/api --replicas=1');
  const patchIdx = calls.findIndex(c => c.startsWith('patch secret sentropic-api'));
  assert.ok(patchIdx !== -1 && patchIdx < scaleUp);
  assert.ok(calls.some(c => c.includes('app.kubernetes.io/component=api')));
  assert.ok(!calls.some(c => c.includes('-l app=api')));
  assert.ok(calls.includes('delete secret auth-idp-session-signing --ignore-not-found=true'));
  assert.ok(calls.includes('patch cronjob pgbackup --type=merge -p {"spec":{"suspend":false}}'));
  assert.ok(!calls.some(c => c.includes('identity-export') && c.includes('patch')));
});
