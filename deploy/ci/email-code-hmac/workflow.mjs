// Runner-side steps of .github/workflows/email-code-hmac-secret.yml (method
// qk-secret-custody-r2 §3.2). Subcommands: configure | preflight | materialize |
// rollout | cleanup. The kubeconfig and the key values are bound only through
// step env (secrets.*/vars.*); this module never prints them, never passes them
// as argv, and never writes them outside the runner-private workdir.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SECRET_NAME, FIELD_MANAGER } from './core.mjs';
import { NAMESPACES, ROLLOUT_DEPLOYMENT, validateRing, buildManifest, applyResultOk, summaryLine, summaryMarkdown } from './materialize.mjs';

export const workdir = () => join(process.env.RUNNER_TEMP || '/tmp', 'email-code-hmac');

export function kube(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('kubectl', ['--kubeconfig', join(workdir(), 'kubeconfig'), ...args], { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && !allowFailure)) throw new Error(`kubectl ${args[0]} failed (details withheld)`);
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// Base64-decode KUBE_CONFIG_DATA_EMAIL_CODE_HMAC into a runner-private kubeconfig
// (exclusive create, mode 0600). The payload is never printed or logged.
export function configure() {
  const raw = process.env.KUBE_CONFIG_DATA_EMAIL_CODE_HMAC;
  if (!raw) throw new Error('email_code_hmac_writer_forbidden');
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  mkdirSync(workdir(), { recursive: true, mode: 0o700 });
  writeFileSync(join(workdir(), 'kubeconfig'), decoded.startsWith('apiVersion:') ? decoded : raw, { mode: 0o600, flag: 'wx' });
  console.log('writer kubeconfig materialized (payload withheld)');
}

// Platform preflight by name only: the pre-created empty shell exists and the
// writer holds exactly the §1.3 rights. Never lists Secrets; never reads values.
export function preflight(tier) {
  const namespace = NAMESPACES[tier];
  if (!namespace) throw new Error('email_code_hmac_ref_mismatch');
  const got = kube(['-n', namespace, 'get', 'secret', SECRET_NAME, '-o', 'name'], { allowFailure: true });
  if (got.status !== 0 || got.stdout.trim() !== `secret/${SECRET_NAME}`) {
    // The writer holds no create: a missing shell is never repaired by apply.
    throw new Error('email_code_hmac_shell_missing');
  }
  const rights = [
    ['get', 'secrets', SECRET_NAME],
    ['patch', 'secrets', SECRET_NAME],
    ['update', 'secrets', SECRET_NAME],
    ['get', 'deployments', ROLLOUT_DEPLOYMENT],
    ['patch', 'deployments', ROLLOUT_DEPLOYMENT],
    ['watch', 'deployments', ROLLOUT_DEPLOYMENT],
  ];
  for (const [verb, resource, name] of rights) {
    const r = kube(['auth', 'can-i', verb, resource, name, '-n', namespace], { allowFailure: true });
    if (r.status !== 0 || r.stdout.trim() !== 'yes') throw new Error('email_code_hmac_writer_forbidden');
  }
  console.log(JSON.stringify({ preflight: 'ok', namespace, secret: SECRET_NAME, deployment: ROLLOUT_DEPLOYMENT }));
}

// Server-side apply onto the existing shell, single fixed field manager.
// Values come from step env only; the manifest lives in a 0600 mkdtemp file.
export function materialize(tier) {
  const namespace = NAMESPACES[tier];
  if (!namespace) throw new Error('email_code_hmac_ref_mismatch');
  const ring = validateRing({
    tier,
    active: process.env.EMAIL_CODE_HMAC_KEY_ACTIVE,
    activeRef: process.env.EMAIL_CODE_HMAC_KEY_ACTIVE_REF,
    previous: process.env.EMAIL_CODE_HMAC_KEY_PREVIOUS,
    previousRef: process.env.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF,
  });
  const manifest = buildManifest({
    namespace,
    active: process.env.EMAIL_CODE_HMAC_KEY_ACTIVE,
    activeRef: process.env.EMAIL_CODE_HMAC_KEY_ACTIVE_REF,
    previous: process.env.EMAIL_CODE_HMAC_KEY_PREVIOUS,
    previousRef: process.env.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF,
  });
  const dir = mkdtempSync(join(workdir(), 'apply-'));
  try {
    const file = join(dir, 'secret.json');
    writeFileSync(file, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
    const result = kube(['-n', namespace, 'apply', '--server-side', `--field-manager=${FIELD_MANAGER}`, '-f', file]);
    if (!applyResultOk(result.stdout)) throw new Error('email_code_hmac_apply_failed');
    const line = summaryLine({ namespace, ring });
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown({ namespace, ring }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function rollout(tier) {
  const namespace = NAMESPACES[tier];
  if (!namespace) throw new Error('email_code_hmac_ref_mismatch');
  kube(['-n', namespace, 'rollout', 'restart', `deployment/${ROLLOUT_DEPLOYMENT}`]);
  kube(['-n', namespace, 'rollout', 'status', `deployment/${ROLLOUT_DEPLOYMENT}`, '--timeout=300s']);
  console.log(JSON.stringify({ rollout: 'complete', namespace, deployment: ROLLOUT_DEPLOYMENT }));
}

export function cleanup() { rmSync(workdir(), { recursive: true, force: true }); }

export function main(argv = process.argv.slice(2)) {
  const [cmd, tier] = argv;
  switch (cmd) {
    case 'configure': configure(); return;
    case 'preflight': preflight(tier); return;
    case 'materialize': materialize(tier); return;
    case 'rollout': rollout(tier); return;
    case 'cleanup': cleanup(); return;
    default: throw new Error('unknown workflow action');
  }
}

if (process.argv[1] && process.argv[1].endsWith('workflow.mjs')) {
  try { main(); } catch (error) {
    console.error(error.message); // fixed codes only; never a value
    process.exitCode = 1;
  }
}
