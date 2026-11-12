import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { COMMIT_CUTOFF_MS, FINISH_CUTOFF_MS, RBAC_COUNT, TOTAL_BUDGET_MS,
  buildProbes, checkRbac, classify, drive, loadSql, splitSql } from './t3-window-driver.mjs';
import { loadState, monoMs, saveState } from './t3-lib.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
import { poll } from './t3-watchdog.mjs';

const CANDIDATE = 'ghcr.io/rhanka/sentropic-api@sha256:candidate';
const UI_IMAGE = 'ghcr.io/rhanka/sentropic-ui@sha256:ui';

// Fault-injectable kubectl double: canned reads, recorded writes.
export function makeCall(scenario = {}) {
  const calls = [];
  const liveSecrets = { ...(scenario.secretData ?? {}) };
  const scaled = {};
  const readyDeploy = (name, image) => ({ spec: { replicas: 1,
    template: { spec: { containers: [{ name, image }] } } },
    status: { replicas: 1, readyReplicas: 1, observedGeneration: 7 }, metadata: { generation: 7 } });
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
    if (cmd === 'get deployment api -o json') {
      return JSON.stringify(scenario.api ?? (scaled.api
        ? readyDeploy('api', CANDIDATE)
        : { spec: { replicas: 0 }, status: { replicas: 0 } }));
    }
    if (cmd === 'get deployment ui -o json') {
      return JSON.stringify(scaled.ui ? readyDeploy('ui', UI_IMAGE) : { spec: { replicas: 0 }, status: { replicas: 0 } });
    }
    if (cmd === 'get deployment auth-idp -o json') {
      return JSON.stringify(scaled['auth-idp']
        ? readyDeploy('auth-idp', CANDIDATE)
        : { spec: { replicas: 0 }, status: { replicas: 0 } });
    }
    if (/^scale deployment\/(\S+) --replicas=1$/.test(cmd)) {
      scaled[cmd.split('/')[1].split(' ')[0]] = true;
      return '';
    }
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

test('budgets fit the 300 s contract', () => {
  assert.ok(COMMIT_CUTOFF_MS <= 175_000);
  assert.ok(FINISH_CUTOFF_MS <= 205_000);
  assert.ok(TOTAL_BUDGET_MS <= 300_000);
});

test('probe URLs are operator inputs, never invented by the driver', () => {
  assert.deepEqual(buildProbes({}), { probes: [], externalProbes: [] });
  const { probes } = buildProbes({ endpoints: {
    appHealth: 'https://app/health', idpConfig: 'https://idp/.well-known/openid-configuration',
    idpJwks: 'https://idp/jwks.json', appMe: 'https://app/me', idpMe: 'https://idp/me',
  } });
  assert.deepEqual(probes.map(p => p.id), ['S-3', 'S-4', 'S-5', 'S-7', 'S-8']);
});

test('kill at every pre-commit step rolls back without opening traffic', async () => {
  for (const killAt of ['fence', 'restrict', 'wire', 'custodian', 'snapshot',
    'budgets', 'checkpoint', 'delete-custodian', 'start-api']) {
    const { ctx, calls } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
    ctx.delivered = (c, script, env) => {
      if ((env.A4_ACTION ?? env.A4_OPERATION ?? env.A4_PHASE) === killAt) throw new Error('driver_killed');
      return '';
    };
    const code = await drive(ctx);
    assert.equal(code, 3, `kill at ${killAt}`);
    const joined = calls.join('\n');
    assert.ok(joined.includes('scale deployment/api --replicas=0'), killAt);
    assert.ok(joined.includes('patch secret sentropic-api'), killAt);
    assert.ok(!joined.includes('@kubernetescrd'), killAt);
  }
});

test('kill after commit converges forward with no legacy boot', async () => {
  const readyApi = { spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image: CANDIDATE }] } } },
    status: { readyReplicas: 1, observedGeneration: 7 }, metadata: { generation: 7 } };
  const { ctx, calls } = makeCtx({
    config: { middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } },
    scenario: { journal: true, committed: true, api: readyApi, deployReady: true },
  });
  let n = 0;
  ctx.delivered = () => { if (++n >= 9) throw new Error('driver_killed'); return ''; };
  const code = await drive(ctx);
  assert.equal(code, 4);
  const joined = calls.join('\n');
  assert.ok(!joined.includes('rollout undo'), 'no legacy boot after commit');
  assert.ok(!joined.includes('scale deployment/api --replicas=0'), 'api stays up on branch P');
  assert.ok(joined.includes('scale deployment/ui --replicas=1'), 'frontals converge');
  assert.equal(loadState(ctx.stateDir).substate, 'TWO_HOSTS_OPEN');
});

test('watchdog waits on a live fresh driver and fires on death', async () => {
  const live = makeCtx();
  saveState(live.ctx.stateDir, { step: 'W3', heartbeatMonoMs: monoMs(),
    driverPid: process.pid, t0MonoMs: monoMs(), namespace: 'sentropic-preprod' });
  assert.equal(await poll(live.ctx), 'waiting');
  const done = makeCtx();
  saveState(done.ctx.stateDir, { step: 'DONE', heartbeatMonoMs: 0, driverPid: 0, namespace: 'sentropic-preprod' });
  assert.equal(await poll(done.ctx), 'done');
  const dead = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==' } } });
  saveState(dead.ctx.stateDir, { step: 'W3', heartbeatMonoMs: monoMs() - 60_000,
    driverPid: 2147483647, t0MonoMs: monoMs(), namespace: 'sentropic-preprod' });
  assert.equal(await poll(dead.ctx), 3);
  assert.equal(loadState(dead.ctx.stateDir).watchdogDone, true);
});

test('watchdog tolerates a stale heartbeat inside the step deadline', async () => {
  const { ctx } = makeCtx();
  const sleeper = spawn('sleep', ['30']);
  try {
    saveState(ctx.stateDir, { step: 'W3', heartbeatMonoMs: monoMs() - 60_000,
      driverPid: sleeper.pid, t0MonoMs: monoMs(), stepDeadlineMonoMs: monoMs() + 60_000,
      namespace: 'sentropic-preprod' });
    assert.equal(await poll(ctx), 'waiting');
    assert.doesNotThrow(() => process.kill(sleeper.pid, 0));
  } finally {
    try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already reaped */ }
  }
});

test('watchdog enforces the total 300 s budget on a live driver', async () => {
  const { ctx, calls } = makeCtx();
  const sleeper = spawn('sleep', ['30']);
  try {
    saveState(ctx.stateDir, { step: 'W8', heartbeatMonoMs: monoMs(),
      driverPid: sleeper.pid, t0MonoMs: monoMs() - 400_000, namespace: 'sentropic-preprod' });
    assert.equal(await poll(ctx), 3);
  } finally {
    try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already reaped */ }
  }
  assert.ok(calls.join('\n').includes('scale deployment/api --replicas=0'));
});

test('dry-run prints the exact B3 command sequence and touches nothing', async () => {
  const { ctx, printed } = makeCtx();
  ctx.dryRun = true;
  ctx.delivered = undefined;
  const code = await drive(ctx);
  assert.equal(code, 3);
  const text = printed.join('\n');
  const order = ['A4_ACTION=fence', 'A4_ACTION=restrict', 'A4_OPERATION=wire',
    'A4_OPERATION=custodian', 'A4_PHASE=snapshot', 'A4_OPERATION=budgets',
    'A4_PHASE=checkpoint', 'A4_ACTION=delete-custodian', 'A4_ACTION=start-api'];
  let last = -1;
  for (const marker of order) {
    const at = text.indexOf(marker);
    assert.ok(at > last, marker);
    last = at;
  }
  assert.ok(!text.includes('A4_OP='));
  assert.ok(readFileSync(`${ctx.stateDir}/request.json`, 'utf8').includes('test'));
});

test('emergency command prints the rollback plan in dry-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-emg-'));
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ kubeconfigFile: '/private/kube',
    namespace: 'sentropic-preprod', revisions: { api: '12', 'auth-idp': '9', ui: '4' } }));
  const out = execFileSync('sh', [join('deploy/ci/preprod-a4/t3-emergency.sh'),
    '--state-dir', dir, '--config', cfg, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /scale deployment\/api --replicas=0/);
});
