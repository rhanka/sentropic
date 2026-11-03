// Shared helpers for the email-code HMAC selftests. Scratch dirs live in the
// OS tmpdir and are removed at the end; stub binaries on PATH guarantee that no
// real git/gh/kubectl is ever invoked (the selftest runs with --network none).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROOT = process.cwd();
export const TOOL_DIR = join(ROOT, 'deploy/ci/email-code-hmac');
export const CUSTODY = join(TOOL_DIR, 'custody.mjs');
export const WORKFLOW = join(TOOL_DIR, 'workflow.mjs');

export function scratch(name) {
  return mkdtempSync(join(tmpdir(), `ech-selftest-${name}-`));
}

export function run(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

export function writeStub(dir, name, source) {
  const file = join(dir, name);
  writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return file;
}

// A stub `git` that answers `check-ignore -q -- <path>` from a control list of
// basenames (env GIT_STUB_IGNORED, comma-separated). Exit 0 = ignored.
export const GIT_STUB = `
const args = process.argv.slice(2);
const i = args.indexOf('--');
const path = i >= 0 ? args[i + 1] : '';
const ignored = (process.env.GIT_STUB_IGNORED || '').split(',').map(s => s.trim()).filter(Boolean);
process.exit(ignored.includes(path.split('/').pop()) ? 0 : 1);
`;

// A stub `gh` that records argv and stdin (JSON lines) to GH_STUB_LOG.
export const GH_STUB = `
const fs = require('node:fs');
let stdin = '';
process.stdin.on('data', c => { stdin += c; });
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.GH_STUB_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin }) + '\\n');
});
`;

// A stub `kubectl` driven by KUBECTL_STUB_MODE: ok | created | no-shell |
// forbidden. Records every argv (JSON lines) to KUBECTL_STUB_LOG and the applied
// manifest to KUBECTL_STUB_MANIFEST. Like real kubectl, it rejects any
// `auth can-i` call that is not exactly `<verb> <resource>/<name>`.
export const KUBECTL_STUB = `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.KUBECTL_STUB_LOG, JSON.stringify(args) + '\\n');
const mode = process.env.KUBECTL_STUB_MODE || 'ok';
const joined = args.join(' ');
// Real kubectl accepts only "auth can-i <verb> <resource>" or
// "auth can-i <verb> <resource>/<name>": exactly two positional arguments after
// "can-i". Any other shape (e.g. the legacy "<verb> <resource> <name>") is
// rejected client-side before any server call.
const ci = args.indexOf('can-i');
if (ci >= 0) {
  const positional = [];
  for (let i = ci + 1; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--namespace') { i++; continue; }
    if (args[i].startsWith('-')) continue;
    positional.push(args[i]);
  }
  if (positional.length !== 2 || !positional[1].includes('/')) {
    console.error('error: you must specify two arguments: verb resource or verb resource/resourceName');
    process.exit(1);
  }
}
if (mode === 'no-shell' && joined.includes(' get secret ')) { console.error('Error from server (NotFound): secrets "email-code-hmac" not found'); process.exit(1); }
if (mode === 'forbidden' && args.includes('auth')) { console.log('no'); process.exit(0); }
if (args.includes('apply')) {
  const file = args[args.indexOf('-f') + 1];
  const st = fs.statSync(file);
  if ((st.mode & 0o777) !== 0o600) { console.error('manifest file mode is not 0600'); process.exit(1); }
  fs.writeFileSync(process.env.KUBECTL_STUB_MANIFEST, fs.readFileSync(file));
  console.log(mode === 'created' ? 'secret/email-code-hmac created' : 'secret/email-code-hmac serverside-applied');
  process.exit(0);
}
if (args.includes('auth')) { console.log('yes'); process.exit(0); }
if (joined.includes(' get secret ')) { console.log('secret/email-code-hmac'); process.exit(0); }
if (joined.includes(' rollout restart ')) { console.log('deployment.apps/api restarted'); process.exit(0); }
if (joined.includes(' rollout status ')) { console.log('deployment "api" successfully rolled out'); process.exit(0); }
process.exit(0);
`;

export function readJsonLines(file) {
  try { return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
}

export function envFileWith(dir, name, lines, mode = 0o600) {
  const file = join(dir, name);
  writeFileSync(file, lines.join('\n') + '\n', { mode });
  return file;
}

export { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync };
