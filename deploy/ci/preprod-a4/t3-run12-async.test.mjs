import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { finishOpen } from './t3-finish-open.mjs';
import { buildProbes, loadState, monoMs, runKubectl } from './t3-lib.mjs';
import { supervisedAsync } from './t3-processes.mjs';
import { templateDigest } from './t3-rollback.mjs';
import { drive } from './t3-window-driver.mjs';
import { applicabilityFixture } from './t3-applicability.test.mjs';
import { witnessBinding } from './t3-applicability.mjs';
import { rehearsalFixture } from './t3-rehearsal-fixture.mjs';
import { PROD_POSTGRES_IMAGE, PROD_POSTGRES_TOOL_IMAGE } from './t3-fixture.mjs';
import { emailProbe, expectedSigningKid, observerProbes, probeEndpoints, probeReply,
  verificationFile, verificationHeader, verificationSecret, verificationSpec } from './t3-probe-fixture.mjs';

const alive = pid => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return false; } };

test('R12 MIN-6: supervisedAsync captures cleanupRecord failure in close handler and resolves without uncaught exception', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-r12-min6-'));
  const uncaught = [];
  const onUncaught = err => { uncaught.push(err); };
  process.on('uncaughtException', onUncaught);
  try {
    const script = `for f in '${dir}'/.t3-command-*.pgid; do rm -f "$f" && mkdir "$f"; done; printf ok`;
    const res = await Promise.race([
      supervisedAsync('sh', ['-c', script], {}, dir),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close_handler_threw_without_resolving')), 1500)),
    ]);
    assert.deepEqual(uncaught.map(e => e.code ?? e.message), [], 'close handler must never emit uncaughtException');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, 'ok');
    assert.equal(res.error?.code, 'EISDIR');
    for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true });

    const savedPath = process.env.PATH;
    writeFileSync(join(dir, 'kubectl'), `#!/bin/sh\nfor f in '${dir}'/.t3-command-*.pgid; do rm -f "$f" && mkdir "$f"; done\nexit 0\n`, { mode: 0o755 });
    process.env.PATH = `${dir}:${savedPath}`;
    try {
      const call = runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-preprod', stateDir: dir });
      await assert.rejects(
        Promise.race([
          call.async(['get', 'pods']),
          new Promise((_, reject) => setTimeout(() => reject(new Error('runKubectl_async_hung')), 1500)),
        ]),
        err => err.message.startsWith('kubectl_failed:') && /EISDIR/.test(String(err.cause)),
      );
      assert.equal(uncaught.length, 0);
    } finally {
      process.env.PATH = savedPath;
    }
  } finally {
    process.off('uncaughtException', onUncaught);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R12 MIN-8: post-commit W8 frontal failure converges via recover() async rollout and enforces async deadlineMs', async () => {
  const candidate = `ghcr.io/rhanka/sentropic-api@sha256:${'e'.repeat(64)}`, uiImg = 'ghcr.io/rhanka/sentropic-ui@sha256:ui';
  const legacyTpl = name => ({ spec: { containers: [{ name, image: `legacy-${name}` }] } });
  for (const stallInRecover of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 't3-r12-w8-post-')), stateDir = mkdtempSync(join(tmpdir(), 't3-r12-w8-state-')), savedPath = process.env.PATH;
    const witness = { url: 'https://idp.test/legacyWitness', cookie: 'synthetic-witness' }, salt = 'e'.repeat(64);
    const baseline = JSON.stringify({ ...applicabilityFixture(), witnessSalt: salt, witnessSha256: witnessBinding(witness, salt) });
    writeFileSync(join(dir, 'baseline.json'), baseline);
    for (const k of ['jwt', 'enc', 'idp']) writeFileSync(join(dir, k), `secret-${k}`);
    const qual = rehearsalFixture(dir, { candidateCommit: 'b'.repeat(40), candidateImage: candidate, operationId: 'test', namespace: 'sentropic-preprod' }, baseline);
    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(qual.snapshot));
    writeFileSync(join(dir, 'kubectl'), `#!/bin/sh
set -eu; a="$*"; printf '%s\\n' "$a" >> '${dir}/commands'
case "$a" in
  *'auth can-i'*) echo yes;;
  *'scale deployment/'*) n=\${a#*scale deployment/}; n=\${n%% *}; r=\${a##*--replicas=}; printf '%s' "$r" > '${dir}/rep-'"$n";;
  *'set image deployment/'*) kv=\${a##* }; printf '%s' "\${kv#*=}" > '${dir}/img-'"\${kv%%=*}";;
  *'rollout status deployment/ui '*) if [ ! -f '${dir}/ui-failed-once' ]; then : > '${dir}/ui-failed-once'; sleep 0.04; exit 1; fi; : > '${dir}/ready-ui';;
  *'rollout status deployment/auth-idp '*)
    [ -f '${dir}/ui-failed-once' ] && [ '${stallInRecover ? '1' : '0'}' = '1' ] && { printf '%s' "$$" > '${dir}/stalled.pid'; sleep 5; }
    sleep 0.04; : > '${dir}/ready-auth-idp';;
  *'rollout status deployment/api '*) : > '${dir}/ready-api';;
  *'delete middleware a4-verification'*) : > '${dir}/opened';;
  *'get secret a4-verification-auth -o json'*) printf '%s\\n' '${JSON.stringify(verificationSecret)}';;
  *'get secret '*) echo '{"data":{"JWT_SECRET":"eA==","SECRET_ENCRYPTION_KEY":"eA=="}}';;
  *'get middleware a4-verification -o json'*) printf '%s\\n' '{"spec":${JSON.stringify(verificationSpec)}}';;
  *'get ingress '*) echo '{"metadata":{"annotations":{"traefik.ingress.kubernetes.io/router.middlewares":"sentropic-preprod-a4-verification@kubernetescrd"}}}';;
  *'get pod postgres-0 -o json'*) printf '%s\\n' '{"status":{"containerStatuses":[{"name":"postgres","imageID":"docker.io/library/${PROD_POSTGRES_IMAGE}"}]}}';;
  *'get cronjob pgbackup -o json'*) printf '%s\\n' '{"spec":{"suspend":true,"jobTemplate":{"spec":{"template":{"spec":{"initContainers":[{"name":"dump","image":"${PROD_POSTGRES_TOOL_IMAGE}"}]}}}}}}';;
  *'get cronjob sentropic-idp-identity-export -o json'*) printf '%s\\n' '{"spec":{"suspend":true,"jobTemplate":{"spec":{"template":{"spec":{"initContainers":[{"name":"export-sql","image":"${PROD_POSTGRES_TOOL_IMAGE}"}]}}}}}}';;
  *'get pods -l'*) echo '{"items":[]}';;
  *'get deployment '*)
    n=\${a#*get deployment }; n=\${n%% *}
    if [ ! -f '${dir}/w7b' ]; then printf '{"metadata":{"generation":1},"status":{"replicas":0,"readyReplicas":0,"observedGeneration":1},"spec":{"replicas":0,"template":{"spec":{"containers":[{"name":"%s","image":"legacy-%s"}]}}}}\\n' "$n" "$n"
    else rep=0; [ -f '${dir}/rep-'"$n" ] && rep=$(cat '${dir}/rep-'"$n"); rdy=0; [ "$rep" = 1 ] && [ -f '${dir}/ready-'"$n" ] && rdy=1
      img="legacy-$n"; [ -f '${dir}/img-'"$n" ] && img=$(cat '${dir}/img-'"$n")
      printf '{"metadata":{"generation":2},"status":{"replicas":%s,"readyReplicas":%s,"observedGeneration":2},"spec":{"replicas":%s,"template":{"spec":{"containers":[{"name":"%s","image":"%s"}]}}}}\\n' "$rep" "$rdy" "$rep" "$n" "$img"
    fi;;
  *'exec '*)
    case "$a" in *snapshot.json*) cat '${dir}/snapshot.json'; exit 0;; esac
    sql=$(cat); case "$sql" in *'SHOW server_version'*) echo '17.11';; *cutover-applicability-v1*) printf '%s\\n' '${JSON.stringify(applicabilityFixture())}';;
      *'AS acl_sha256'*) printf '%064d\\n' 0 | tr 0 a;; *journal_present*) echo 't|0';; *identity_committed*) echo 't';; *to_regclass*) echo 'control.artifact_host_kv|t';; *) echo 'f';; esac;;
  *) echo '{}';;
esac`, { mode: 0o755 });
    process.env.PATH = `${dir}:${savedPath}`;
    try {
      const config = { kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod', tier: 'preprod', candidateImage: candidate,
        templateDigests: Object.fromEntries(['api', 'auth-idp', 'ui'].map(n => [n, templateDigest(legacyTpl(n))])),
        images: { candidate, ui: uiImg }, endpoints: probeEndpoints(), ...observerProbes(), emailProbe, expectedSigningKid,
        request: { format: 'x', operationId: 'test', candidateCommit: 'b'.repeat(40), candidateImage: candidate },
        rotationKeyFiles: { apiJwtSecretFile: join(dir, 'jwt'), secretEncryptionKeyFile: join(dir, 'enc'), idpSessionJwtFile: join(dir, 'idp') },
        applicabilityBaselineFile: join(dir, 'baseline.json'), verificationCredentialFile: verificationFile(dir), witness, ...qual };
      const ctx = { stateDir, dryRun: false, probeReadOnly: false, tier: 'preprod', postgresPod: 'postgres-0', print: () => {},
        verification: verificationHeader, config, recoveryBudgetMs: stallInRecover ? 350 : undefined,
        call: runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-preprod', stateDir }),
        delivered: (_c, _s, env) => {
          if (env.A4_ACTION === 'start-api') for (const [f, v] of [['w7b', '1'], ['rep-api', '1'], ['ready-api', '1'], ['img-api', candidate]]) writeFileSync(join(dir, f), v);
          return '';
        },
        probe: async (url, opts) => probeReply(url, opts, existsSync(join(dir, 'opened'))) };
      if (!stallInRecover) {
        assert.equal(await drive(ctx), 4, 'verified post-commit W8 failure must converge via recover() and exit 4');
        assert.deepEqual([loadState(stateDir).step, loadState(stateDir).substate, loadState(stateDir).commitVerified], ['DONE', 'TWO_HOSTS_OPEN', true]);
        assert.doesNotMatch(readFileSync(join(dir, 'commands'), 'utf8'), /rollout undo|patch secret sentropic-api --type=json/);
      } else {
        const t0 = performance.now();
        await assert.rejects(drive(ctx), /kubectl_failed: rollout status deployment\/auth-idp|budget_exhausted/);
        assert.ok(performance.now() - t0 < 2_000, 'recover() async rollout must respect recoveryBudgetMs');
        if (existsSync(join(dir, 'stalled.pid'))) assert.equal(alive(Number(readFileSync(join(dir, 'stalled.pid'), 'utf8'))), false);
        assert.deepEqual(readdirSync(stateDir).filter(n => n.startsWith('.t3-command-')), []);
      }
    } finally { process.env.PATH = savedPath; rmSync(dir, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true }); }
  }

  const dir = mkdtempSync(join(tmpdir(), 't3-r12-fo-dl-')), savedPath = process.env.PATH;
  writeFileSync(join(dir, 'kubectl'), `#!/bin/sh
set -eu; a="$*"
case "$a" in
  *'scale deployment/api --replicas=1'*) : > '${dir}/ready-api';;
  *'rollout status deployment/ui '*) printf '%s' "$$" > '${dir}/ui.pid'; sleep 5;;
  *'rollout status deployment/auth-idp '*) sleep 5;;
  *'get middleware a4-verification -o json'*) printf '%s\\n' '{"spec":${JSON.stringify(verificationSpec)}}';;
  *'get ingress '*) echo '{"metadata":{"annotations":{"traefik.ingress.kubernetes.io/router.middlewares":"sentropic-preprod-a4-verification@kubernetescrd"}}}';;
  *'get deployment api -o json'*) [ -f '${dir}/ready-api' ] && echo '{"metadata":{"generation":2},"status":{"readyReplicas":1,"observedGeneration":2},"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"api","image":"c"}]}}}}' || echo '{"spec":{"replicas":0}}';;
  *) echo '{"metadata":{"generation":1},"status":{"readyReplicas":0,"observedGeneration":1},"spec":{"replicas":0,"template":{"spec":{"containers":[{"name":"ui","image":"legacy"}]}}}}';;
esac`, { mode: 0o755 });
  process.env.PATH = `${dir}:${savedPath}`;
  try {
    const config = { endpoints: probeEndpoints(), ...observerProbes(), emailProbe, expectedSigningKid, images: { candidate: 'c', ui: 'u' } };
    const call = runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-preprod', stateDir: dir });
    const t0 = performance.now();
    await assert.rejects(finishOpen({ call, state: { namespace: 'sentropic-preprod', middlewareSpec: verificationSpec },
      images: config.images, ...buildProbes(config), verification: verificationHeader, save: () => {},
      probe: async () => new Response('{}', { status: 200 }), deadlineMs: monoMs() + 250 }), /kubectl_failed: rollout status|budget_exhausted/);
    assert.ok(performance.now() - t0 < 1_500, 'finishOpen must bound async rollout by deadlineMs');
    if (existsSync(join(dir, 'ui.pid'))) assert.equal(alive(Number(readFileSync(join(dir, 'ui.pid'), 'utf8'))), false);
  } finally { process.env.PATH = savedPath; rmSync(dir, { recursive: true, force: true }); }
});
