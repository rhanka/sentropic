import { readFileSync } from 'node:fs';
import { buildProbes, loadState, runKubectl, validateProbes } from './t3-lib.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
import { finishOpen } from './t3-finish-open.mjs';

// Preview both possible decisions without stopping processes, claiming a lock,
// writing state, probing HTTP or issuing even read-only Kubernetes requests.
const [stateDir, configFile] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const state = loadState(stateDir) ?? {};
const call = runKubectl({ kubeconfig: config.kubeconfigFile, namespace: config.namespace,
  dryRun: true, print: console.log });
console.log('# dry-run: would stop automation, claim lock, stop api, classify and require zero locks');
console.log('# dry-run: pre-commit branch (only if committed=false and locks=0)');
await preCommitRollback({ call, revisions: config.revisions, preCmDir: config.preCmDir,
  dryRun: true, note: console.log });
console.log('# dry-run: post-commit branch (only if committed=true and locks=0)');
let qualified = true;
try { validateProbes(buildProbes(config).probes); }
catch (err) { qualified = false; console.log(`# dry-run: cannot accept post-commit: ${err.message}`); }
if (qualified) await finishOpen({ call, state: { ...state, namespace: config.namespace,
  middlewareSpec: state.middlewareSpec ?? config.middlewareSpec },
  images: config.images ?? { candidate: '<candidate-image>', ui: '<ui-image>' },
  ...buildProbes(config), save: () => {}, dryRun: true, print: console.log });
