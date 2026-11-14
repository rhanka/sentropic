import { pathToFileURL } from 'node:url';
import { assertAuthorization, digest, privateInput, tierOf } from './guards.mjs';
import { execute, executionGrant } from './execution.mjs';
import { ops } from './ops.mjs';
import { buildProbes, validateProbes } from './t3-lib.mjs';
import { validateApplicability } from './t3-applicability.mjs';

// Offline only. Never interprets a request template as observed fence evidence.
export function preflight(config, read = privateInput) {
  const tier = tierOf({ A4_TIER: config.tier });
  if (config.namespace !== tier.namespace || config.candidateImage !== config.images?.candidate
    || config.request?.candidateImage !== config.candidateImage) throw new Error('config_binding_invalid');
  const env = { A4_TIER: config.tier, A4_DRY_RUN: '1', A4_KUBECONFIG_FILE: config.kubeconfigFile,
    A4_AUTHORIZATION_FILE: config.authorizationFile, A4_EXECUTION_FILE: config.executionFile,
    A4_EXECUTION_SHA256: config.executionSha256, A4_REQUEST_FILE: 'request-template',
    A4_BUDGETS_FILE: config.budgetsFile, A4_OPERATION: 'budgets' };
  const localRead = path => path === 'request-template' ? JSON.stringify(config.request) : read(path);
  const authorization = JSON.parse(read(config.authorizationFile));
  assertAuthorization(authorization, tier);
  const grant = executionGrant(env, authorization, read, tier);
  if (config.images.ui !== grant.uiImage) throw new Error('ui_binding_invalid');
  const noCalls = () => { throw new Error('offline_preflight_attempted_cluster_access'); };
  execute({ ...env, A4_ACTION: 'fence' }, noCalls, localRead);
  ops(env, noCalls, localRead);
  if (digest(read(config.remoteFile, 64 * 1024 * 1024)) !== config.request.remoteSnapshotDigest) {
    throw new Error('remote_digest_mismatch');
  }
  validateApplicability(JSON.parse(read(config.applicabilityBaselineFile)));
  validateProbes(buildProbes(config).probes);
  for (const name of ['apiJwtSecretFile', 'secretEncryptionKeyFile', 'idpSessionJwtFile']) {
    if (!read(config.rotationKeyFiles?.[name]).trim()) throw new Error('rotation_key_empty');
  }
  for (const name of ['api', 'auth-idp', 'ui']) {
    if (!/^[1-9][0-9]*$/.test(String(config.revisions?.[name]))) throw new Error('revision_missing');
  }
  read(`${config.preCmDir}/pre-cm-api.yaml`);
  read(`${config.preCmDir}/pre-cm-auth-idp.yaml`);
  return { version: 't3-preflight/1', executionSha256: config.executionSha256, namespace: config.namespace };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(preflight(JSON.parse(privateInput(process.argv[2]))))); }
  catch { console.error('preflight_refused'); process.exitCode = 1; }
}
