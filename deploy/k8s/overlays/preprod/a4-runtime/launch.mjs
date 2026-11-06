import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const activeRef = 'email-code-hmac:v1:preprod:15c2f8b66073655a';
export const approvalRef = 'qk-secret-custody-r2:Q-K=A:2026-11-02';
export function compose(source) {
  const env = { ...source };
  if (env.CM_IDENTITY_EMAIL_CODE_POLICY !== 'hmac-sha256'
    || env.CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF !== approvalRef) throw new Error('hmac_custody_invalid');
  const keys = {};
  for (const slot of ['ACTIVE', 'PREVIOUS']) {
    const hex = env[`EMAIL_CODE_HMAC_KEY_${slot}`], ref = env[`EMAIL_CODE_HMAC_KEY_${slot}_REF`];
    if (slot === 'PREVIOUS' && hex === undefined && ref === undefined) continue;
    if (!/^[a-f0-9]{64}$/.test(hex ?? '') || !/^email-code-hmac:v1:preprod:[a-f0-9]{16}$/.test(ref ?? '')
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
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv[2] === '--custodian') {
      setInterval(() => {}, 60_000);
    } else {
      const child = spawn(process.execPath, ['/workspace/api/dist/index.js', ...process.argv.slice(2)],
        { env: compose(process.env), stdio: 'inherit' });
      for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
      child.once('error', () => { process.exitCode = 1; });
      child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    }
  } catch {
    // Do not serialize source env or parser errors.
    process.stderr.write('hmac_composition_failed\n');
    process.exitCode = 1;
  }
}
