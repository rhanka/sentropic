import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { COMMIT_CUTOFF_MS, FINISH_CUTOFF_MS, RBAC_COUNT, TOTAL_BUDGET_MS,
  buildProbes, checkRbac, classify, drive, loadSql, splitSql } from './t3-window-driver.mjs';
import { loadState, monoMs, saveState, withExecStdin } from './t3-lib.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
import { poll } from './t3-watchdog.mjs';

const CANDIDATE = 'ghcr.io/rhanka/sentropic-api@sha256:candidate';
const UI_IMAGE = 'ghcr.io/rhanka/sentropic-ui@sha256:ui';

// Fault-injectable kubectl double: canned reads, recorded writes.
export function makeCall(scenario = {}) {
  const calls = [];
  const liveSecrets = { ...(scenario.secretData ?? {}) };
  const createdSecrets = {};
  let frontalPollsLeft = scenario.frontalTerminating ?? 0;
  const scaled = {};
  const readyDeploy = (name, image) => ({ spec: { replicas: 1,
    template: { spec: { containers: [{ name, image }] } } },
    status: { replicas: 1, readyReplicas: 1, observedGeneration: 7 }, metadata: { generation: 7 } });
  const call = (args, input) => {
    calls.push(args.join(' ') + (args[0] === 'exec' ? ` <<<${String(input ?? '').split('\n')[0].slice(0, 120)}` : ''));
    const cmd = args.join(' ');
    const patchPayload = () => {
      const at = args.indexOf('-p');
      if (at !== -1) return JSON.parse(args[at + 1]);
      const file = args.find(a => String(a).startsWith('--patch-file='));
      if (file && !String(file).includes('<redacted>')) {
        return JSON.parse(readFileSync(String(file).slice('--patch-file='.length), 'utf8'));
      }
      return null;
    };
    if (cmd.startsWith('patch secret sentropic-api')) {
      const patch = patchPayload();
      if (Array.isArray(patch)) {
        for (const op of patch) {
          if (op.op === 'remove') delete liveSecrets[op.path.replace('/data/', '')];
          else if (op.op === 'add' || op.op === 'replace') liveSecrets[op.path.replace('/data/', '')] = op.value;
        }
      } else if (patch?.data) {
        Object.assign(liveSecrets, patch.data);
      }
      return '';
    }
    if (cmd.startsWith('patch secret auth-idp-session-signing')) {
      const patch = patchPayload();
      if (patch?.data) {
        createdSecrets['auth-idp-session-signing'] = { data: { ...(createdSecrets['auth-idp-session-signing']?.data ?? {}), ...patch.data } };
      }
      return '';
    }
    if (cmd.startsWith('auth can-i')) return 'yes';
    if (args[0] === 'exec') {
      const statement = String(input ?? '');
      if (statement.includes('journal_present')) return scenario.journal === false ? 'f|0\n' : `t|${scenario.locks ?? 0}\n`;
      if (statement.includes('identity_committed')) return scenario.committed ? 't\n' : 'f\n';
      if (statement.includes('asset_column_present')) return 'f\n';
      if (statement.includes('to_regclass(name)')) {
        return scenario.relations ?? 'control.artifact_host_kv|t\npublic.__drizzle_control_migrations|t\nartifacts.artifacts|t\nartifact_host.activation_namespaces|t\n';
      }
      if (statement.includes('AS k,')) return 'enc-key||3\n';
      return '\n';
    }
    if (cmd.startsWith('get pods -l app.kubernetes.io/name=sentropic')) {
      const component = cmd.match(/component=([a-z-]+)/)?.[1];
      if ((component === 'ui' || component === 'auth-idp') && frontalPollsLeft > 0) {
        frontalPollsLeft -= 1;
        return JSON.stringify({ items: [{ metadata: { name: 'terminating' } }] });
      }
      return JSON.stringify({ items: [] });
    }
    if ((cmd === 'apply -f -' || cmd === 'create -f -') && typeof input === 'string') {
      try {
        const doc = JSON.parse(input);
        if (doc?.kind === 'Secret' && doc.metadata?.name === 'sentropic-api') {
          Object.assign(liveSecrets, doc.data ?? {});
        }
        if (doc?.kind === 'Secret' && doc.metadata?.name) {
          createdSecrets[doc.metadata.name] = doc;
        }
      } catch { /* non-JSON stdin */ }
      return '';
    }
    if (cmd.startsWith('get secret ') && cmd.endsWith(' -o json')) {
      const name = cmd.split(' ')[2];
      if (name === 'sentropic-api') return JSON.stringify({ data: liveSecrets });
      if (createdSecrets[name]) return JSON.stringify({ data: createdSecrets[name].data ?? {} });
    }
    if (cmd === 'get middleware a4-verification -o json') {
      if (scenario.middlewareSpec === false) return '{}';
      return JSON.stringify({ spec: scenario.middlewareSpec ?? { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } });
    }
    if (cmd === 'get cronjob sentropic-idp-identity-export -o json') {
      return JSON.stringify({ spec: { suspend: scenario.exportSuspended !== false } });
    }
    if (cmd.startsWith('patch cronjob sentropic-idp-identity-export')) {
      scenario.exportSuspended = true;
      return '';
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
  // Default rotation key material: every full drive poses the W3 keys, so
  // tests get files unless they opt out (rotationKeyFiles: undefined).
  const keyDir = mkdtempSync(join(tmpdir(), 't3-keys-'));
  const defaultKeys = {
    apiJwtSecretFile: join(keyDir, 'jwt'),
    secretEncryptionKeyFile: join(keyDir, 'enc'),
    idpSessionJwtFile: join(keyDir, 'idp'),
  };
  writeFileSync(defaultKeys.apiJwtSecretFile, 'test-jwt-secret');
  writeFileSync(defaultKeys.secretEncryptionKeyFile, 'test-enc-key');
  writeFileSync(defaultKeys.idpSessionJwtFile, 'test-idp-jwt');
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
        rotationKeyFiles: defaultKeys,
        ...(overrides.config ?? {}),
      },
    },
    calls, printed,
  };
}

test('RBAC matrix covers exactly 50 couples', () => {
  assert.equal(RBAC_COUNT, 50);
});

test('RUN6 budgets and staged PVC inputs precede every consumer', async () => {
  const { ctx } = makeCtx();
  const seen = [];
  ctx.config.remoteFile = '/private/remote.json';
  ctx.config.rehearsalFile = '/private/rehearsal.json';
  ctx.delivered = (c, script, env) => {
    const op = env.A4_ACTION ?? env.A4_OPERATION ?? env.A4_PHASE;
    if (op === 'custodian') assert.ok(seen.includes('budgets'), 'mandatory budgets Secret exists');
    if (op === 'snapshot') assert.ok(seen.includes('stage:inputs'), 'request/remote on PVC');
    if (op === 'checkpoint') assert.ok(seen.includes('stage:rehearsal'), 'rehearsal on PVC');
    if (op === 'stage') {
      assert.equal(env.A4_REMOTE_FILE, ctx.config.remoteFile);
      assert.equal(env.A4_REHEARSAL_FILE, ctx.config.rehearsalFile);
    }
    seen.push(op === 'stage' ? `${op}:${env.A4_STAGE}` : op);
    return '';
  };
  await drive(ctx);
  assert.deepEqual(seen.slice(0, 11), ['fence', 'restrict', 'wire', 'budgets', 'custodian',
    'stage:inputs', 'snapshot', 'stage:rehearsal', 'checkpoint', 'delete-custodian', 'start-api']);
});

test('RUN6 TWO_HOSTS_OPEN restarts all deployments after emergency classification', async () => {
  const { ctx, calls } = makeCtx();
  const { finishOpen } = await import('./t3-finish-open.mjs');
  const state = { namespace: ctx.config.namespace, substate: 'TWO_HOSTS_OPEN' };
  await finishOpen({ ...ctx, state, save: () => {}, images: ctx.config.images });
  for (const name of ['api', 'ui', 'auth-idp']) {
    assert.ok(calls.includes(`scale deployment/${name} --replicas=1`), name);
    assert.ok(calls.includes(`rollout status deployment/${name} --timeout=120s`), name);
  }
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

test('kubectl exec forwards stdin with -i or psql reads EOF', () => {
  assert.deepEqual(withExecStdin(['exec', 'pod', '--', 'psql'], 'SELECT 1;'),
    ['exec', '-i', 'pod', '--', 'psql']);
  assert.deepEqual(withExecStdin(['get', 'pods'], undefined), ['get', 'pods']);
  assert.deepEqual(withExecStdin(['exec', 'pod', '--', 'true'], undefined),
    ['exec', 'pod', '--', 'true']);
});

test('classifier SQL is SELECT-only so exec may run it in probe mode', () => {
  const code = loadSql('t3-classify.sql')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  for (const keyword of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'COPY']) {
    assert.doesNotMatch(code, new RegExp(`\\b${keyword}\\b`, 'i'));
  }
});

test('W3 poses the rotation keys as explicit steps after wire', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-keys-'));
  const files = {
    apiJwtSecretFile: join(dir, 'jwt'),
    secretEncryptionKeyFile: join(dir, 'enc'),
    idpSessionJwtFile: join(dir, 'idp-jwt'),
  };
  writeFileSync(files.apiJwtSecretFile, 'test-jwt-secret');
  writeFileSync(files.secretEncryptionKeyFile, 'test-enc-key');
  writeFileSync(files.idpSessionJwtFile, 'test-idp-jwt');
  const { ctx, calls } = makeCtx({ config: { rotationKeyFiles: files } });
  const { applyRotationKeys } = await import('./t3-window-driver.mjs');
  applyRotationKeys(ctx);
  const joined = calls.join('\n');
  assert.ok(!joined.includes('apply -f -'), 'no apply, merge patch only');
  assert.ok(joined.includes('patch secret sentropic-api --type=merge'), 'merge patch used');
  assert.ok(!joined.includes('test-jwt-secret'), 'values never in argv');
  assert.ok(!joined.includes('test-enc-key'), 'values never in argv');
  assert.ok(!joined.includes('test-idp-jwt'), 'values never in argv');
});

test('W3 fails closed without rotation key files', async () => {
  const { ctx } = makeCtx({ config: { rotationKeyFiles: undefined } });
  const { applyRotationKeys } = await import('./t3-window-driver.mjs');
  assert.throws(() => applyRotationKeys(ctx), /rotation_keys_missing/);
});

test('W3 key steps print without files in dry-run', async () => {
  const { ctx, printed } = makeCtx();
  ctx.dryRun = true;
  const { applyRotationKeys } = await import('./t3-window-driver.mjs');
  applyRotationKeys(ctx);
  assert.ok(printed.join('\n').includes('rotation keys'));
});

test('classifier reports locks, receipts and artifact relations', () => {
  const { ctx } = makeCtx({ scenario: { journal: true } });
  const info = classify(ctx);
  assert.equal(info.locks, 0);
  assert.ok(Array.isArray(info.relations));
  assert.equal(info.relations.length, 4);
  assert.ok(info.relations.every(r => r.present === true && typeof r.name === 'string'));
});

test('recover stops api before classifying, then rolls back pre-commit', async () => {
  const { ctx, calls } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==' } } });
  const { recover } = await import('./t3-window-driver.mjs');
  const code = await recover(ctx, { step: 'W7b', namespace: 'sentropic-preprod' }, 'test-stop-first');
  assert.equal(code, 3);
  const scaleApi0 = calls.findIndex(c => c === 'scale deployment/api --replicas=0');
  const journalExec = calls.findIndex(c => c.includes('journal_present'));
  const patchKeys = calls.findIndex(c => c.startsWith('patch secret sentropic-api'));
  assert.ok(scaleApi0 !== -1 && journalExec !== -1 && patchKeys !== -1);
  assert.ok(scaleApi0 < journalExec, 'api stopped before classify');
  assert.ok(journalExec < patchKeys, 'classified before rollback');
});

test('recover refuses to decide while migration locks are held', async () => {
  const { ctx } = makeCtx({ scenario: { journal: true, locks: 2 } });
  const { recover } = await import('./t3-window-driver.mjs');
  await assert.rejects(
    recover(ctx, { step: 'W7b', namespace: 'sentropic-preprod' }, 'test-locks'),
    /migration_locks_held/);
});

test('classifier reports uncommitted on a journal-less database', () => {
  const { ctx } = makeCtx({ scenario: { journal: false } });
  assert.deepEqual(classify(ctx), { journal: false, locks: 0, committed: false, receipts: 0, apiReady: false, relations: [] });
});

test('classifier proves branch P only with commit marker and ready api', () => {
  const ready = { spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image: CANDIDATE }] } } },
    status: { readyReplicas: 1, observedGeneration: 7 }, metadata: { generation: 7 } };
  const { ctx } = makeCtx({ scenario: { journal: true, committed: true, api: ready } });
  const info = classify(ctx);
  assert.equal(info.committed, true);
  assert.equal(info.apiReady, true);
});

test('post-rollback verification fails the rollback on bad health', async () => {
  const { ctx } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
  const badProbe = async () => ({ status: 500, body: { cancel: async () => {} } });
  await assert.rejects(
    preCommitRollback({ call: ctx.call, revisions: ctx.config.revisions, probe: badProbe,
      healthUrl: 'https://app/health', jwksUrl: 'https://idp/jwks' }),
    /rollback_verify_failed/);
});

test('rollback forces identity-export suspension and still reopens ingress', async () => {
  const { ctx, calls } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' }, exportSuspended: false } });
  const out = await preCommitRollback({ call: ctx.call, revisions: ctx.config.revisions });
  assert.deepEqual(out.removedKeys.sort(), ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY']);
  const joined = calls.join('\n');
  assert.ok(joined.includes('patch cronjob sentropic-idp-identity-export'), 'guard forced back on');
  assert.ok(joined.includes('annotate ingress sentropic traefik.ingress.kubernetes.io/router.middlewares-'), 'ingress reopened');
  assert.ok(joined.includes('delete middleware a4-verification --ignore-not-found=true'), 'middleware removed');
});

test('pre-commit rollback removes both rotated keys before any scale-up', async () => {
  const { ctx, calls } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
  const out = await preCommitRollback({ call: ctx.call, revisions: ctx.config.revisions });
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
  assert.ok(FINISH_CUTOFF_MS <= 300_000);
  assert.ok(TOTAL_BUDGET_MS <= 300_000);
});

test('kubectl timeouts are bounded by the live step deadline', async () => {
  const { effectiveTimeout } = await import('./t3-lib.mjs');
  const now = monoMs();
  assert.equal(effectiveTimeout(60_000, { deadlineMs: now + 5_000 }, now), 5_000);
  assert.equal(effectiveTimeout(60_000, { deadlineMs: now + 500_000 }, now), 60_000);
  assert.equal(effectiveTimeout(60_000, { deadlineMs: now - 1_000 }, now), 1000);
  assert.equal(effectiveTimeout(60_000, null, now), 60_000);
});

test('step cutoffs match the window contract', async () => {
  const { STEP_CUTOFFS, COMMIT_CUTOFF_MS: commit, TOTAL_BUDGET_MS: total } =
    await import('./t3-window-driver.mjs');
  assert.equal(STEP_CUTOFFS.W5, 110_000);
  assert.equal(STEP_CUTOFFS.W7b, commit);
  assert.ok(STEP_CUTOFFS.W7b <= 175_000);
  assert.equal(STEP_CUTOFFS.W8, 300_000);
  assert.equal(STEP_CUTOFFS.W9, 300_000);
  assert.ok(total <= 300_000);
});

test('drive refuses to open traffic on an unverified commit', async () => {
  const { ctx, calls } = makeCtx({ scenario: { journal: true, committed: false,
    secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
  const code = await drive(ctx);
  assert.equal(code, 3);
  assert.equal(loadState(ctx.stateDir).recoveryReason, 'commit_unverified');
  assert.ok(!calls.join('\n').includes('set image'), 'no frontal converged onto the candidate');
});

test('drive restarts rather than opens on a committed-but-not-ready api', async () => {
  const { ctx, calls } = makeCtx({ scenario: { journal: true, committed: true,
    secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
  const code = await drive(ctx);
  assert.equal(code, 4);
  assert.equal(loadState(ctx.stateDir).recoveryReason, 'api_not_ready');
  const joined = calls.join('\n');
  assert.ok(joined.includes('scale deployment/api --replicas=1'), 'committed api restarted');
  assert.equal(loadState(ctx.stateDir).substate, 'TWO_HOSTS_OPEN');
});

test('delivered timeouts never outlive the step cutoff', async () => {
  const { ctx } = makeCtx();
  const seen = [];
  ctx.delivered = (c, script, env, timeoutMs) => {
    seen.push([env.A4_ACTION ?? env.A4_OPERATION ?? env.A4_PHASE, timeoutMs]);
    if (env.A4_OPERATION === 'custodian') throw new Error('stop-at-W4');
    return '';
  };
  const code = await drive(ctx);
  assert.equal(code, 3);
  const cap = op => seen.find(([name]) => name === op)[1];
  assert.ok(cap('fence') <= 25_000, `fence timeout ${cap('fence')}`);
  assert.ok(cap('restrict') <= 35_000, `restrict timeout ${cap('restrict')}`);
  assert.ok(cap('wire') <= 50_000, `wire timeout ${cap('wire')}`);
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
  assert.ok(joined.includes('scale deployment/api --replicas=0'), 'writers freeze before classify');
  assert.ok(joined.includes('scale deployment/ui --replicas=1'), 'frontals converge');
  assert.equal(loadState(ctx.stateDir).substate, 'TWO_HOSTS_OPEN');
});

test('committed but not ready api restarts without legacy boot (U2b)', async () => {
  const { ctx, calls } = makeCtx({
    config: { middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } },
    scenario: { journal: true, committed: true },
  });
  let n = 0;
  ctx.delivered = () => { if (++n >= 9) throw new Error('driver_killed'); return ''; };
  const code = await drive(ctx);
  assert.equal(code, 4);
  const joined = calls.join('\n');
  assert.ok(joined.includes('scale deployment/api --replicas=0'), 'U2b stops the dead api');
  assert.ok(joined.includes('scale deployment/api --replicas=1'), 'U2b restarts it');
  assert.ok(!joined.includes('rollout undo'), 'no legacy boot after commit');
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

test('finishOpen patches an existing middleware instead of recreating it', async () => {
  const readyApi = { spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image: CANDIDATE }] } } },
    status: { replicas: 1, readyReplicas: 1, observedGeneration: 7 }, metadata: { generation: 7 } };
  const { ctx, calls } = makeCtx({ config: { middlewareSpec: { ipAllowList: { sourceRange: ['1.2.3.4/32'] } } },
    scenario: { api: readyApi } });
  const { finishOpen } = await import('./t3-finish-open.mjs');
  const state = { namespace: 'sentropic-preprod', middlewareSpec: ctx.config.middlewareSpec };
  const images = { candidate: CANDIDATE, ui: UI_IMAGE };
  await finishOpen({ call: ctx.call, probe: ctx.probe, state,
    save: next => Object.assign(state, next), images, probes: [], externalProbes: [] });
  const joined = calls.join('\n');
  assert.ok(!joined.includes('create -f -'), 'no create over the existing middleware (no AlreadyExists)');
  assert.ok(joined.includes('patch middleware a4-verification'), 'middleware patched in place');
  assert.equal(state.substate, 'TWO_HOSTS_OPEN');
});

test('finishOpen resumes from ACCEPTED without replaying probes', async () => {
  const readyApi = { spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image: CANDIDATE }] } } },
    status: { replicas: 1, readyReplicas: 1, observedGeneration: 7 }, metadata: { generation: 7 } };
  const { ctx } = makeCtx({ scenario: { api: readyApi } });
  const { finishOpen } = await import('./t3-finish-open.mjs');
  const state = { namespace: 'sentropic-preprod', substate: 'ACCEPTED',
    middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } };
  const images = { candidate: CANDIDATE, ui: UI_IMAGE };
  const neverProbe = async () => { throw new Error('probe replayed after ACCEPTED'); };
  await finishOpen({ call: ctx.call, probe: neverProbe, state,
    save: next => Object.assign(state, next), images,
    probes: [{ id: 'S-3', url: 'https://app/health', expect: 200 }], externalProbes: [] });
  assert.equal(state.substate, 'TWO_HOSTS_OPEN');
});

test('finishOpen resumes from BACKUP_RESUMED and ONE_HOST_OPEN', async () => {
  for (const substate of ['BACKUP_RESUMED', 'ONE_HOST_OPEN']) {
    const { ctx } = makeCtx();
    const { finishOpen } = await import('./t3-finish-open.mjs');
    const state = { namespace: 'sentropic-preprod', substate,
      middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } };
    const images = { candidate: CANDIDATE, ui: UI_IMAGE };
    await finishOpen({ call: ctx.call, probe: ctx.probe, state,
      save: next => Object.assign(state, next), images, probes: [], externalProbes: [] });
    assert.equal(state.substate, 'TWO_HOSTS_OPEN', substate);
  }
});

test('recover records missing artifact relations instead of deciding blind', async () => {
  const { ctx, printed } = makeCtx({ scenario: { relations: 'public.__drizzle_control_migrations|t\ncontrol.artifact_host_kv|f\n' } });
  const { recover } = await import('./t3-window-driver.mjs');
  const code = await recover(ctx, { step: 'W7b', namespace: 'sentropic-preprod' }, 'test-relations');
  assert.equal(code, 3);
  const missing = loadState(ctx.stateDir).relations.filter(r => !r.present);
  assert.deepEqual(missing.map(r => r.name), ['control.artifact_host_kv']);
  assert.ok(printed.join('\n').includes('missing artifact relations'), 'operator warned');
});

test('reconcile waits for terminating frontals instead of failing', async () => {
  const { ctx, calls } = makeCtx({ scenario: { frontalTerminating: 3 } });
  const { reconcileRestrictSafe } = await import('./t3-finish-open.mjs');
  const state = { namespace: 'sentropic-preprod',
    middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } };
  reconcileRestrictSafe({ call: ctx.call, dryRun: false }, state);
  const joined = calls.join('\n');
  assert.ok(joined.includes('scale deployment/ui --replicas=0'), 'frontal fenced first');
  assert.ok(joined.includes('scale deployment/auth-idp --replicas=0'), 'frontal fenced first');
});

test('dry-run prints the key-removal patch even with no keys present', async () => {
  const { ctx, calls } = makeCtx({ scenario: { secretData: {} } });
  const { preCommitRollback } = await import('./t3-rollback.mjs');
  await preCommitRollback({ call: ctx.call, revisions: ctx.config.revisions, dryRun: true });
  assert.ok(calls.some(c => c.startsWith('patch secret sentropic-api')), 'patch printed in dry-run');
});

test('dry-run prints the exact B3 command sequence and touches nothing', async () => {
  const { ctx, printed, calls } = makeCtx();
  ctx.dryRun = true;
  ctx.delivered = undefined;
  const code = await drive(ctx);
  assert.equal(code, 0);
  const text = printed.join('\n');
  const order = ['A4_ACTION=fence', 'A4_ACTION=restrict', 'A4_OPERATION=wire',
    'A4_OPERATION=budgets', 'A4_OPERATION=custodian', 'A4_STAGE=inputs',
    'A4_PHASE=snapshot', 'A4_STAGE=rehearsal',
    'A4_PHASE=checkpoint', 'A4_ACTION=delete-custodian', 'A4_ACTION=start-api'];
  let last = -1;
  for (const marker of order) {
    const at = text.indexOf(marker);
    assert.ok(at > last, marker);
    last = at;
  }
  assert.ok(!text.includes('A4_OP='));
  assert.ok(readFileSync(`${ctx.stateDir}/request.json`, 'utf8').includes('test'));
  const joined = calls.join('\n');
  assert.ok(joined.includes('set image deployment/ui'), 'W8 ui converged');
  assert.ok(joined.includes('scale deployment/ui --replicas=1'), 'W8 ui started');
  assert.ok(joined.includes('patch cronjob pgbackup'), 'W8 pgbackup resumed');
  assert.ok(joined.includes('delete middleware a4-verification --ignore-not-found=true'), 'W8 reopened');
  assert.ok(!joined.includes('rollout undo'), 'no legacy boot in dry-run');
});

test('recovery claim is single-flight even for the same owner', async () => {
  const { claimRecovery } = await import('./t3-lib.mjs');
  const { ctx } = makeCtx();
  assert.equal(claimRecovery(ctx.stateDir, 'watchdog'), true);
  assert.equal(claimRecovery(ctx.stateDir, 'watchdog'), false);
});

test('a pid claim older than two minutes is take-over-able', async () => {
  const { claimDead } = await import('./t3-lib.mjs');
  assert.equal(claimDead({ owner: `pid-${process.pid}`, at: monoMs() - 130_000 }), true);
  assert.equal(claimDead({ owner: `pid-${process.pid}`, at: monoMs() }), false);
});

test('step timeouts are bounded by the step cutoff', async () => {
  const { stepTimeoutMs } = await import('./t3-lib.mjs');
  const now = monoMs();
  assert.equal(stepTimeoutMs(120_000, now + 5_000, now), 5_000);
  assert.equal(stepTimeoutMs(120_000, now + 500_000, now), 120_000);
  assert.equal(stepTimeoutMs(30_000, now - 1_000, now), 1000);
});

test('concurrent watchdog polls keep a single writer', async () => {
  const { ctx, calls } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==' } } });
  saveState(ctx.stateDir, { step: 'W3', heartbeatMonoMs: monoMs() - 60_000,
    driverPid: 2147483647, t0MonoMs: monoMs(), namespace: 'sentropic-preprod' });
  const [a, b] = await Promise.all([poll(ctx), poll(ctx)]);
  const codes = [a, b].sort();
  assert.ok(codes.includes(3), `codes=${codes}`);
  assert.ok(codes.includes(5) || codes.includes('recovery-in-progress'), `codes=${codes}`);
  assert.equal(calls.filter(c => c.startsWith('patch secret sentropic-api')).length, 1);
});

test('recovery claim keeps a single writer', async () => {
  const first = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
  const { recover } = await import('./t3-window-driver.mjs');
  const state = { step: 'W3', heartbeatMonoMs: 0, driverPid: 2147483647,
    t0MonoMs: monoMs(), namespace: 'sentropic-preprod' };
  saveState(first.ctx.stateDir, state);
  const code1 = await recover(first.ctx, loadState(first.ctx.stateDir), 'test-race');
  assert.equal(code1, 3);
  const second = makeCtx();
  const code2 = await recover({ ...second.ctx, stateDir: first.ctx.stateDir, recoverOwner: 'test-loser' },
    loadState(first.ctx.stateDir), 'test-race-late');
  assert.equal(code2, 5);
  const patches = first.calls.filter(c => c.startsWith('patch secret sentropic-api'));
  assert.equal(patches.length, 1);
});

test('watchdog stands down while the driver owns recovery', async () => {
  const { ctx } = makeCtx();
  const sleeper = spawn('sleep', ['30']);
  try {
    saveState(ctx.stateDir, { step: 'W3', heartbeatMonoMs: monoMs() - 60_000,
      driverPid: sleeper.pid, t0MonoMs: monoMs(), stepDeadlineMonoMs: monoMs() - 1000,
      namespace: 'sentropic-preprod' });
    const { claimRecovery } = await import('./t3-lib.mjs');
    assert.equal(claimRecovery(ctx.stateDir, `pid-${sleeper.pid}`), true);
    assert.equal(await poll(ctx), 'recovery-in-progress');
    assert.doesNotThrow(() => process.kill(sleeper.pid, 0));
  } finally {
    try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already reaped */ }
    const { releaseRecovery } = await import('./t3-lib.mjs');
    releaseRecovery(ctx.stateDir);
  }
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

test('emergency refuses while another live recovery owns the lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-emg-'));
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ kubeconfigFile: '/private/kube',
    namespace: 'sentropic-preprod', revisions: {} }));
  writeFileSync(join(dir, 't3-recovering.lock'), `other-pid-${process.pid}|${monoMs()}`);
  assert.throws(() => execFileSync('sh', [join('deploy/ci/preprod-a4/t3-emergency.sh'),
    '--state-dir', dir, '--config', cfg, '--dry-run'], { encoding: 'utf8' }), /recovery owned by/);
});

test('emergency classifies after stopping api and passes pre-cm-dir to rollback', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-emg-'));
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod',
    revisions: { api: '12', 'auth-idp': '9', ui: '4' }, preCmDir: '/pre-cm' }));
  const out = execFileSync('sh', [join('deploy/ci/preprod-a4/t3-emergency.sh'),
    '--state-dir', dir, '--config', cfg, '--dry-run'], { encoding: 'utf8' });
  const stopped = out.indexOf('automation stopped, lock held');
  const classified = out.indexOf('classified committed=false');
  const patch = out.indexOf('patch secret sentropic-api');
  const undo = out.indexOf('rollout undo');
  assert.ok(stopped !== -1 && classified !== -1 && patch !== -1 && undo !== -1);
  assert.ok(stopped < classified && classified < patch && patch < undo, 'freeze, classify, then rollback');
  assert.ok(out.includes('/pre-cm'), 'pre-cm-dir wired into rollback');
});

test('emergency converges post-commit instead of legacy rollback', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-emg-'));
  const fakeBin = mkdtempSync(join(tmpdir(), 't3-fakebin-'));
  const fakeState = mkdtempSync(join(tmpdir(), 't3-fakestate-'));
  writeFileSync(join(fakeBin, 'kubectl'), `#!/bin/sh
S="$FAKE_KUBECTL_STATE"
A="$*"
case "$A" in
  *"get pods"*) echo '{"items":[]}';;
  *"get middleware"*) echo '{"spec":{"ipAllowList":{"sourceRange":["9.9.9.9/32"]}}}';;
  *"get deployment api "*) if [ -f "$S/scaled-api" ]; then echo '{"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"api","image":"candidate-img"}]}}},"status":{"replicas":1,"readyReplicas":1,"observedGeneration":7},"metadata":{"generation":7}}'; else echo '{"spec":{"replicas":0},"status":{"replicas":0}}'; fi;;
  *"get deployment "*) N=$(printf '%s' "$A" | sed 's/.*get deployment \\([^ ]*\\).*/\\1/'); if [ -f "$S/scaled-$N" ]; then IMG="candidate-img"; [ "$N" = "ui" ] && IMG="ui-img"; echo "{\\"spec\\":{\\"replicas\\":1,\\"template\\":{\\"spec\\":{\\"containers\\":[{\\"name\\":\\"$N\\",\\"image\\":\\"$IMG\\"}]}}},\\"status\\":{\\"replicas\\":1,\\"readyReplicas\\":1,\\"observedGeneration\\":7},\\"metadata\\":{\\"generation\\":7}}"; else echo '{"spec":{"replicas":0},"status":{"replicas":0}}'; fi;;
  *"scale deployment/"*"--replicas=1") N=$(printf '%s' "$A" | sed 's/.*scale deployment\\/\\([^ ]*\\).*/\\1/'); touch "$S/scaled-$N";;
  *"exec "*) IN=$(cat); case "$IN" in
      *journal_present*) echo 't|0';;
      *identity_committed*) echo 't';;
      *asset_column_present*) echo 't';;
      *to_regclass*) printf 'a|t\\nb|t\\nc|t\\nd|t\\n';;
      *"AS k,"*) echo 'k|u|3';;
      *) echo '';;
    esac;;
  *) echo '{}';;
esac
`);
  chmodSync(join(fakeBin, 'kubectl'), 0o755);
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod',
    revisions: { api: '12', 'auth-idp': '9', ui: '4' }, candidateImage: 'candidate-img',
    middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } },
    images: { candidate: 'candidate-img', ui: 'ui-img' } }));
  const out = execFileSync('sh', [join('deploy/ci/preprod-a4/t3-emergency.sh'),
    '--state-dir', dir, '--config', cfg],
  { encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_KUBECTL_STATE: fakeState } });
  assert.ok(out.includes('classified committed=true'), 'classified post-commit');
  assert.ok(out.includes('finish_open_ok substate=TWO_HOSTS_OPEN'), 'converged forward');
  assert.ok(!out.includes('rollout undo'), 'no legacy boot after commit');
  assert.ok(!out.includes('patch secret sentropic-api'), 'no key removal after commit');
});

// RUN 4 — Argon round-2 rework: every new BLOCKER/MAJOR first seen red here.
test('recover resets an expired step deadline so kubectl keeps a usable timeout', async () => {
  const { ctx } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==' } } });
  const { recover } = await import('./t3-window-driver.mjs');
  const { monoMs } = await import('./t3-lib.mjs');
  ctx.timeoutRef = { deadlineMs: monoMs() - 5_000 };
  const state = { step: 'W7b', namespace: 'sentropic-preprod', t0MonoMs: monoMs() };
  const code = await recover(ctx, state, 'test-deadline-reset');
  assert.equal(code, 3);
  assert.ok(ctx.timeoutRef.deadlineMs - monoMs() > 10_000, 'recovery deadline moved to the future');
});

test('recover waits for advisory locks to drain instead of failing fast', async () => {
  let classifies = 0;
  const { ctx, calls } = makeCtx({ scenario: { journal: true, locks: 0, secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
  const origCall = ctx.call;
  ctx.call = (args, input) => {
    if (args[0] === 'exec' && String(input ?? '').includes('journal_present')) {
      classifies += 1;
      return classifies === 1 ? 't|1\n' : 't|0\n';
    }
    return origCall(args, input);
  };
  const { recover } = await import('./t3-window-driver.mjs');
  const code = await recover(ctx, { step: 'W7b', namespace: 'sentropic-preprod', t0MonoMs: monoMs() }, 'test-lock-wait');
  assert.equal(code, 3, 'rollback after the lock drained');
  assert.ok(classifies >= 2, 'classify re-read after the first locked read');
  assert.ok(calls.join('\n').includes('patch secret sentropic-api'));
});

test('finishOpen restarts a stopped api before opening traffic', async () => {
  const { ctx, calls } = makeCtx({
    config: { middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } },
    scenario: {},
  });
  const { finishOpen } = await import('./t3-finish-open.mjs');
  const state = { namespace: 'sentropic-preprod', middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } };
  const images = { candidate: CANDIDATE, ui: UI_IMAGE };
  await finishOpen({ call: ctx.call, probe: ctx.probe, state,
    save: next => Object.assign(state, next), images, probes: [], externalProbes: [] });
  const joined = calls.join('\n');
  assert.ok(joined.includes('scale deployment/api --replicas=1'), 'stopped api restarted before open');
  assert.equal(state.substate, 'TWO_HOSTS_OPEN');
});

test('finishOpen CLI builds probes from config.endpoints, not only config.probes', async () => {
  const src = readFileSync(new URL('./t3-finish-open.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('config.endpoints') || src.includes('buildProbes'), 'endpoints wired into the CLI path');
});

test('driver records childPid so the watchdog can kill the in-flight child', async () => {
  const { ctx } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==' } } });
  const { drive } = await import('./t3-window-driver.mjs');
  const code = await drive(ctx);
  assert.equal(code, 3);
  const st = loadState(ctx.stateDir);
  assert.ok(st.childPid !== undefined && st.childPid !== null, 'childPid written');
});

test('watchdog kills children and grandchildren with SIGKILL, not only SIGTERM', async () => {
  const src = readFileSync(new URL('./t3-watchdog.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('pkill') && src.includes('-KILL') && src.includes('-P'), 'SIGKILL to direct children');
  assert.ok(src.includes('process.kill(-pid') || src.includes('kill(-pid'), 'process-group kill kept');
});

test('emergency stops the whole process group and SIGKILLs children', () => {
  const src = readFileSync(new URL('./t3-emergency.sh', import.meta.url), 'utf8');
  assert.ok(src.includes('pkill') && src.includes('-KILL') && src.includes('-P'), 'SIGKILL to direct children via pkill -KILL -P');
  assert.ok(src.includes('kill -TERM -') || src.includes('kill -- -') || src.includes('kill -TERM -') , 'group kill present');
  assert.ok(src.includes('kill -KILL -') || src.includes('kill -- -'), 'group SIGKILL present');
});

test('W3 poses rotation keys with patch, never apply (no last-applied annotation)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-keys-'));
  const files = {
    apiJwtSecretFile: join(dir, 'jwt'),
    secretEncryptionKeyFile: join(dir, 'enc'),
    idpSessionJwtFile: join(dir, 'idp-jwt'),
  };
  writeFileSync(files.apiJwtSecretFile, 'test-jwt-secret');
  writeFileSync(files.secretEncryptionKeyFile, 'test-enc-key');
  writeFileSync(files.idpSessionJwtFile, 'test-idp-jwt');
  const { ctx, calls } = makeCtx({ config: { rotationKeyFiles: files } });
  const { applyRotationKeys } = await import('./t3-window-driver.mjs');
  applyRotationKeys(ctx);
  const joined = calls.join('\n');
  assert.ok(!joined.includes('apply -f -'), 'no kubectl apply left');
  assert.ok(joined.includes('patch secret sentropic-api --type=merge'), 'merge patch used');
  assert.ok(!joined.includes('test-jwt-secret'), 'values never in argv');
});

// RUN 5 — Argon v3 round-3: every NOT FIXED first seen red here.
test('RUN5 recover marks DONE so the watchdog never runs a second recovery', async () => {
  for (const committed of [false, true]) {
    const { ctx } = makeCtx({ scenario: { journal: true, committed,
      secretData: { JWT_SECRET: 'eA==', SECRET_ENCRYPTION_KEY: 'eQ==' } } });
    const { recover } = await import('./t3-window-driver.mjs');
    // Real recoveries carry the W1 middleware record; the post-commit branch
    // converges through it, so the test state must too.
    const state = { step: 'W7b', namespace: 'sentropic-preprod', t0MonoMs: monoMs(),
      middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } };
    const code = await recover(ctx, state, 'run5-double-recover');
    assert.ok(code === 3 || code === 4, `recover exit, committed=${committed}`);
    const saved = loadState(ctx.stateDir);
    assert.equal(saved.step, 'DONE', 'driver marks DONE before exit');
    assert.equal(saved.watchdogDone, true, 'watchdog stands down after driver recovery');
  }
});

test('RUN5 finishOpen restarts a stopped api from ACCEPTED/BACKUP_RESUMED/ONE_HOST_OPEN', async () => {
  for (const substate of ['ACCEPTED', 'BACKUP_RESUMED', 'ONE_HOST_OPEN']) {
    const { ctx, calls } = makeCtx({ scenario: {} });
    const { finishOpen } = await import('./t3-finish-open.mjs');
    const state = { namespace: 'sentropic-preprod', substate,
      middlewareSpec: { ipAllowList: { sourceRange: ['9.9.9.9/32'] } } };
    const images = { candidate: CANDIDATE, ui: UI_IMAGE };
    await finishOpen({ call: ctx.call, probe: ctx.probe, state,
      save: next => Object.assign(state, next), images, probes: [], externalProbes: [] });
    const joined = calls.join('\n');
    assert.ok(joined.includes('scale deployment/api --replicas=1'), `${substate}: api restarted`);
    assert.ok(joined.includes('rollout status deployment/api'), `${substate}: api rollout awaited`);
    assert.equal(state.substate, 'TWO_HOSTS_OPEN', substate);
  }
});

test('RUN5 recover at/after the 300 s budget keeps a usable kubectl deadline', async () => {
  const { ctx } = makeCtx({ scenario: { secretData: { JWT_SECRET: 'eA==' } } });
  const { recover } = await import('./t3-window-driver.mjs');
  const { monoMs: now } = await import('./t3-lib.mjs');
  ctx.timeoutRef = {};
  const t0 = now() - 300_000;
  const state = { step: 'W8', namespace: 'sentropic-preprod', t0MonoMs: t0 };
  const code = await recover(ctx, state, 'run5-w8-cutoff');
  assert.equal(code, 3);
  assert.ok(ctx.timeoutRef.deadlineMs - now() > 10_000, 'recovery budget re-armed past the fence total');
});

test('RUN5 kill paths list children before the first SIGTERM', async () => {
  const watchdog = readFileSync(new URL('./t3-watchdog.mjs', import.meta.url), 'utf8');
  const helperAt = watchdog.indexOf('function listChildren');
  const killAt = watchdog.indexOf('function killPid');
  assert.ok(helperAt !== -1 && killAt !== -1 && helperAt < killAt, 'snapshot helper defined before killPid');
  assert.ok(watchdog.slice(helperAt, killAt).includes('ps -o pid'), 'helper snapshots with ps --ppid');
  const killBody = watchdog.slice(killAt);
  const snapCall = killBody.indexOf('listChildren(pid)');
  const signals = ['process.kill(-pid', "process.kill(pid, 'SIGTERM'", 'process.kill(c,', "'-TERM'", "'-KILL'"]
    .map(s => killBody.indexOf(s)).filter(i => i !== -1);
  const firstTerm = signals.length ? Math.min(...signals) : Infinity;
  assert.ok(snapCall !== -1 && snapCall < firstTerm, 'watchdog snapshots children before signalling');
  const emergency = readFileSync(new URL('./t3-emergency.sh', import.meta.url), 'utf8');
  const eps = emergency.indexOf('ps -o pid');
  const eterm = emergency.indexOf('pkill -TERM -P "$_pid"');
  assert.ok(eps !== -1 && eterm !== -1 && eps < eterm, 'emergency snapshots grandchildren before SIGTERM');
});

test('RUN5 rotation keys never travel in argv, even base64', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-keys-'));
  const files = {
    apiJwtSecretFile: join(dir, 'jwt'),
    secretEncryptionKeyFile: join(dir, 'enc'),
    idpSessionJwtFile: join(dir, 'idp-jwt'),
  };
  writeFileSync(files.apiJwtSecretFile, 'test-jwt-secret');
  writeFileSync(files.secretEncryptionKeyFile, 'test-enc-key');
  writeFileSync(files.idpSessionJwtFile, 'test-idp-jwt');
  const { ctx, calls } = makeCtx({ config: { rotationKeyFiles: files } });
  const { applyRotationKeys } = await import('./t3-window-driver.mjs');
  applyRotationKeys(ctx);
  const joined = calls.join('\n');
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  assert.ok(!joined.includes('test-jwt-secret') && !joined.includes('test-enc-key'), 'no raw secret in argv');
  assert.ok(!joined.includes(b64('test-jwt-secret')) && !joined.includes(b64('test-enc-key')), 'no base64 secret in argv');
  assert.ok(!joined.includes(' -p ') || !joined.includes('JWT_SECRET'), 'no secret payload in -p argv');
});
