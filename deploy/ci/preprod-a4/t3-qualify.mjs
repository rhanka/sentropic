import { writeFileSync } from 'node:fs';
import { checkRbac, psql } from './t3-window-driver.mjs';
import { inspectApplicability } from './t3-applicability.mjs';
import { privateInput, tierOf } from './guards.mjs';
import { runKubectl, loadState, monoMs, effectiveTimeout } from './t3-lib.mjs';
import { digest } from './guards.mjs';
import { fixture } from './t3-fixture.mjs';

// OPERATOR-only qualification utilities: Kubernetes reads, protected exclusive local outputs.
export async function qualify(action, config, dependencies = {}) {
  const tier = tierOf({ A4_TIER: config.tier });
  if (config.namespace !== (tier.destinationNamespace ?? tier.namespace)) throw new Error('qualification_destination_invalid');
  const read = dependencies.read ?? privateInput;
  const write = dependencies.write ?? ((path,value) => writeFileSync(path,JSON.stringify(value),{ mode: 0o600, flag: 'wx' }));
  if (action === 'usable-auth') {
    const state = (dependencies.state ?? loadState)(config.qualificationStateDir);
    if (state?.step !== 'DONE' || !Number.isFinite(state.t0MonoMs)) throw new Error('qualification_window_incomplete');
    const witnesses = config.postAuthWitnesses;
    if (!Array.isArray(witnesses) || witnesses.length !== 2) throw new Error('qualification_witnesses_missing');
    const now = dependencies.now ?? monoMs;
    const deadlineMs = state.t0MonoMs+(state.recoveryReason ? 300000 : 175000);
    for (const name of ['app','idp']) {
      const w = witnesses.find(w => w.name === name), url = config.endpoints[`${name}Me`];
      if (!w || w.url !== url || !w.expectedUserId || (config.tier === 'restore'
        && !new URL(url).hostname.endsWith('.restore-a4.test'))) throw new Error('qualification_witness_binding');
      const response = await (dependencies.probe ?? fetch)(url,{ redirect: 'error',
        headers: { cookie: read(w.cookieFile).trim() },signal: AbortSignal.timeout(effectiveTimeout(5000,{deadlineMs},now())) });
      if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
        throw new Error('qualification_auth_failed');
      }
      const body = await response.json();
      if (body.user?.id !== w.expectedUserId) throw new Error('qualification_identity_failed');
    }
    const usableAtMonoMs = now(), elapsedMs = usableAtMonoMs-state.t0MonoMs;
    effectiveTimeout(1,{deadlineMs},usableAtMonoMs);
    const faultToAuthMs = state.recoveryReason ? usableAtMonoMs-config.qualificationFaultMonoMs : null;
    if (state.recoveryReason && (!Number.isFinite(faultToAuthMs) || faultToAuthMs < 0
      || (state.commitVerified === false && faultToAuthMs >= 120000))) throw new Error('qualification_recovery_overrun');
    const receipt = { version: 't3-usable-auth/1',stateSha256: digest(JSON.stringify(state)),usableAtMonoMs,elapsedMs,faultToAuthMs };
    write(`${config.qualificationStateDir}/usable-auth.json`,receipt);
    return receipt;
  }
  if (action === 'fixture') {
    if (config.tier !== 'restore') throw new Error('fixture_tier_required');
    const objects = JSON.parse(read(config.fixtureInventoryFile,64*1024*1024));
    write(config.fixtureManifestFile,fixture(objects.items));
    return { fixtureWritten: true };
  }
  const call = dependencies.call ?? runKubectl({ kubeconfig: config.kubeconfigFile, namespace: config.namespace });
  const ctx = { config, call, print: () => {}, postgresPod: config.postgresPod ?? 'postgres-0',
    postgresUser: config.postgresUser ?? 'app' };
  if (action === 'rbac') { checkRbac(ctx); return { rbacPassed: true }; }
  if (action === 'baseline') {
    write(config.applicabilityBaselineFile,inspectApplicability(ctx,psql));
    return { baselineWritten: true };
  }
  throw new Error('qualification_action_invalid');
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { console.log(JSON.stringify(await qualify(process.argv[2],JSON.parse(privateInput(process.argv[3]))))); }
  catch { console.error('qualification_refused'); process.exitCode = 1; }
}
