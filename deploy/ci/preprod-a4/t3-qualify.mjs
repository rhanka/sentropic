import { writeFileSync } from 'node:fs';
import { checkRbac, psql } from './t3-window-driver.mjs';
import { inspectApplicability } from './t3-applicability.mjs';
import { privateInput, tierOf } from './guards.mjs';
import { runKubectl } from './t3-lib.mjs';
import { fixture } from './t3-fixture.mjs';

// OPERATOR-only qualification utilities: Kubernetes reads, protected exclusive local outputs.
export function qualify(action, config, dependencies = {}) {
  const tier = tierOf({ A4_TIER: config.tier });
  if (config.namespace !== (tier.destinationNamespace ?? tier.namespace)) throw new Error('qualification_destination_invalid');
  const read = dependencies.read ?? privateInput;
  const write = dependencies.write ?? ((path,value) => writeFileSync(path,JSON.stringify(value),{ mode: 0o600, flag: 'wx' }));
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
  try { console.log(JSON.stringify(qualify(process.argv[2],JSON.parse(privateInput(process.argv[3]))))); }
  catch { console.error('qualification_refused'); process.exitCode = 1; }
}
