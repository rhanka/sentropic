import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The key ring tier follows the pod namespace (downward API, deploy/k8s/components/a4-wiring).
export const tiers = Object.freeze({ 'sentropic-preprod': 'preprod', sentropic: 'prod' });
export const approvalRef = 'qk-secret-custody-r2:Q-K=A:2026-11-02';
const scriptName = /^[a-z][a-z0-9-]*$/;
export const entrypoint = args => {
  if (args[0] === '--idp') return ['/workspace/apps/auth-idp/dist/index.js', ...args.slice(1)];
  if (args[0] === '--script') {
    // One compiled api script (governed one-off Job), by plain name, under the api pod composition.
    if (args.length !== 2 || !scriptName.test(args[1])) throw new Error('launch_target_invalid');
    return [`/workspace/api/dist/scripts/${args[1]}.js`];
  }
  return ['/workspace/api/dist/index.js', ...args];
};
export function compose(source) {
  const env = { ...source };
  if (env.CM_IDENTITY_EMAIL_CODE_POLICY !== 'hmac-sha256'
    || env.CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF !== approvalRef) throw new Error('hmac_custody_invalid');
  const tier = Object.hasOwn(tiers, env.CM_A4_NAMESPACE ?? '') ? tiers[env.CM_A4_NAMESPACE] : undefined;
  if (!tier) throw new Error('hmac_custody_invalid');
  const refPattern = new RegExp(`^email-code-hmac:v1:${tier}:[a-f0-9]{16}$`);
  const keys = {};
  for (const slot of ['ACTIVE', 'PREVIOUS']) {
    const hex = env[`EMAIL_CODE_HMAC_KEY_${slot}`], ref = env[`EMAIL_CODE_HMAC_KEY_${slot}_REF`];
    if (slot === 'PREVIOUS' && hex === undefined && ref === undefined) continue;
    if (!/^[a-f0-9]{64}$/.test(hex ?? '') || !refPattern.test(ref ?? '')
      || Object.hasOwn(keys, ref)) throw new Error('hmac_custody_invalid');
    const key = Buffer.from(hex, 'hex');
    try {
      const fingerprint = createHmac('sha256', key).update('sentropic/email-code-hmac/fingerprint/v1').digest('hex').slice(0, 16);
      if (!ref.endsWith(`:${fingerprint}`)) throw new Error('hmac_ref_mismatch');
      keys[ref] = key.toString('base64url');
    } finally { key.fill(0); }
  }
  env.CM_IDENTITY_EMAIL_CODE_KEYS_JSON = JSON.stringify(keys);
  env.CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF = env.EMAIL_CODE_HMAC_KEY_ACTIVE_REF;
  env.CM_IDENTITY_EMAIL_CODE_PREVIOUS_KEY_REFS_JSON = JSON.stringify(
    env.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF === undefined ? [] : [env.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF]);
  for (const name of Object.keys(env)) if (name.startsWith('EMAIL_CODE_HMAC_')) delete env[name];
  return env;
}
// A ConfigMap volume serves this file through a ..data symlink and Node resolves the
// main module to its real path, so compare real paths or the launcher would exit 0 idle.
export const isMain = (url, argv1) => {
  try { return url === pathToFileURL(realpathSync(argv1 ?? '')).href; } catch { return false; }
};
if (isMain(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  let target;
  // The target is resolved before any secret is read, so a bad target never composes custody.
  try { target = args[0] === '--custodian' ? null : entrypoint(args); } catch {
    process.stderr.write('launch_target_invalid\n');
    process.exitCode = 1;
  }
  if (target === null) setInterval(() => {}, 60_000);
  else if (target) {
    try {
      const child = spawn(process.execPath, target, { env: compose(process.env), stdio: 'inherit' });
      for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
      child.once('error', () => { process.exitCode = 1; });
      child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    } catch {
      // Do not serialize source env or parser errors.
      process.stderr.write('hmac_composition_failed\n');
      process.exitCode = 1;
    }
  }
}
