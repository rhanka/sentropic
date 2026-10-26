// Local STT bench runner (r3 L3). Real tiny/base timing through the production
// path — one child per profile (native binding loads once per process) running
// profile-run.mjs: worker + session over eSpeak NG fixtures (see profiles.ts pins).
// Usage: node bench/run-local-bench.mjs --dist <dir> --models-dir <dir> --out <receipt.json>
//   [--install-lock <package-lock.json>] [--espeak-bin <path>]
// Exit 0 measured, else exit 2 pending with the exact blocker. Never invent numbers.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

/** Read the pinned model digests from src/node/profiles.ts (single source of truth). */
function readPinnedDigests() {
  const source = readFileSync(join(here, '..', 'src', 'node', 'profiles.ts'), 'utf8');
  const digests = [...source.matchAll(/modelBin:\s*'(sha256:[0-9a-f]+)'/g)].map((match) => match[1]);
  const engine = source.match(/engineVersion:\s*'([^']+)'/)?.[1] ?? null;
  if (digests.length !== 2 || !engine) throw new Error('cannot extract pinned tiny/base digests from profiles.ts');
  return { tiny: digests[0], base: digests[1], engineVersion: engine };
}

function pendingReceipt(out, blocker, evidence) {
  const receipt = {
    status: 'pending',
    lot: 'L3',
    createdAt: new Date().toISOString(),
    blocker,
    evidence,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(`bench pending: ${blocker}`);
  process.exit(2);
}

const dist = arg('dist');
const modelsDir = arg('models-dir');
const out = resolve(arg('out', join(here, 'local-stt-bench.receipt.json')));
const installLock = arg('install-lock');
const espeakBin = arg('espeak-bin', 'espeak-ng');

const pinned = readPinnedDigests();
const evidence = {
  node: `${process.version} ${process.platform} ${process.arch}`,
  engine: `faster-whisper-ts@${pinned.engineVersion}`,
  pinned,
  modelsDir: modelsDir ?? '(missing --models-dir)',
};

if (!dist) pendingReceipt(out, 'no compiled dist directory provided (pass --dist)', evidence);
if (!modelsDir) {
  pendingReceipt(out, 'no models directory provided (pass --models-dir)', evidence);
}

const espeakVersion = spawnSync(espeakBin, ['--version'], { encoding: 'utf8' });
if (espeakVersion.status !== 0) pendingReceipt(out, 'espeak-ng binary not available', { ...evidence, detail: String(espeakVersion.error?.message ?? '').slice(0, 300) });

const utterances = {
  'local-tiny': { lang: 'en', voice: 'en', speed: '175', text: 'The quick brown fox jumps over the lazy dog' },
  'local-base': { lang: 'fr', voice: 'fr', speed: '120', text: 'Bonjour, comment allez vous ?' },
};
const results = {};
let provisioned = null;
for (const [profileId, utterance] of Object.entries(utterances)) {
  const runs = [];
  for (const kind of ['espeak', 'silence']) {
    const childArgs = [join(here, 'profile-run.mjs'), '--dist', dist, '--models-dir', modelsDir,
      '--profile', profileId, '--fixture-kind', kind, '--espeak-bin', espeakBin, '--utterance', utterance.text,
      '--voice', utterance.voice, '--speed', utterance.speed];
    if (installLock) childArgs.push('--install-lock', installLock);
    const child = spawnSync(process.execPath, childArgs, { encoding: 'utf8', timeout: 300000 });
    let parsed = null;
    try { parsed = JSON.parse(String(child.stdout)); } catch { parsed = null; }
    if (child.status !== 0 || !parsed) {
      pendingReceipt(out, `bench child failed for ${profileId}/${kind}`, { ...evidence, detail: String(child.stderr ?? child.error?.message ?? '').slice(0, 500) });
    }
    if (!provisioned) provisioned = parsed.provisioned;
    runs.push({ loadMs: parsed.loadMs, ...parsed.run });
    if (kind === 'espeak') results[profileId] = { fixture: { lang: utterance.lang, ...parsed.fixture } };
    results[profileId].runs = runs;
  }
}
const receipt = {
  status: 'measured',
  lot: 'L3',
  createdAt: new Date().toISOString(),
  note: 'Functional pipeline timings through worker + session on eSpeak NG fixtures resampled to 16 kHz in-process; quality and latency budgets belong to the M1 campaign with real speech fixtures.',
  ...evidence,
  engineId: 'faster-whisper-ts/1.2.1',
  espeak: { binary: espeakBin, version: String(espeakVersion.stdout ?? '').split('\n')[0].slice(0, 120) },
  provisioned,
  results,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`bench measured: ${out}`);
