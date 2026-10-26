// Local STT bench runner (r3 L3). Real tiny/base transcription timing on
// Node-generated PCM fixtures — no microphone, no paid API, no audio in output.
// The engine (faster-whisper-ts) is loaded dynamically; models are pinned local
// artifacts (see profiles.ts, the single source of truth for digests).
// Usage: node bench/run-local-bench.mjs --models-dir <dir> --out <receipt.json>
//   [--engine faster-whisper-ts] [--wav-16k <file> (optional real-speech fixture)]
// Exit 0 with a measured receipt when the engine runs, else exit 2 with a receipt
// marked pending that records the exact blocker. Never invent numbers.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Read the pinned model digests from src/node/profiles.ts (single source of truth). */
function readPinnedDigests() {
  const source = readFileSync(join(here, '..', 'src', 'node', 'profiles.ts'), 'utf8');
  const digests = [...source.matchAll(/modelDigest:\s*'(sha256:[0-9a-f]+)'/g)].map((match) => match[1]);
  const engine = source.match(/engineVersion:\s*'([^']+)'/)?.[1] ?? null;
  if (digests.length !== 2 || !engine) throw new Error('cannot extract pinned tiny/base digests from profiles.ts');
  return { tiny: digests[0], base: digests[1], engineVersion: engine };
}

/** Deterministic 16 kHz mono fixture (sine + silence padding); digest recorded, audio never logged. */
function makeFixture(kind) {
  const rate = 16000;
  const seconds = kind === 'tone' ? 3 : 1;
  const pcm = new Float32Array(seconds * rate);
  if (kind === 'tone') {
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }
  return { kind, sampleRateHz: rate, samples: pcm.length, sha256: `sha256:${sha256Hex(Buffer.from(pcm.buffer))}` };
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

const modelsDir = arg('models-dir');
const out = resolve(arg('out', join(here, 'local-stt-bench.receipt.json')));
const engineSpecifier = arg('engine', 'faster-whisper-ts');

const pinned = readPinnedDigests();
const evidence = {
  node: `${process.version} ${process.platform} ${process.arch}`,
  engine: `faster-whisper-ts@${pinned.engineVersion}`,
  pinned,
  modelsDir: modelsDir ?? '(missing --models-dir)',
};

if (!modelsDir) {
  pendingReceipt(out, 'no models directory provided (pass --models-dir)', evidence);
} else {
  let engineModule;
  try {
    engineModule = await import(engineSpecifier);
  } catch (error) {
    pendingReceipt(out, 'engine module not loadable', {
      ...evidence,
      detail: String(error?.message ?? error).slice(0, 500),
      hint: 'npm install faster-whisper-ts@1.2.1 (pinned) with a working native toolchain, then rerun',
    });
  }
  if (!engineModule?.transcribe && typeof engineModule?.WhisperModel !== 'function') {
    pendingReceipt(out, 'engine module has no usable transcribe entry', {
      ...evidence,
      exports: Object.keys(engineModule ?? {}),
    });
  }
  const models = {};
  for (const [id, subdir] of [['tiny', 'faster-whisper-tiny'], ['base', 'faster-whisper-base']]) {
    const binPath = join(modelsDir, subdir, 'model.bin');
    let bytes;
    try {
      bytes = readFileSync(binPath);
    } catch {
      pendingReceipt(out, `model artifact missing: ${binPath}`, evidence);
    }
    const digest = `sha256:${sha256Hex(bytes)}`;
    if (digest !== pinned[id]) {
      pendingReceipt(out, `model digest mismatch for ${id}`, { ...evidence, expected: pinned[id], actual: digest });
    }
    models[id] = { dir: join(modelsDir, subdir), digest };
  }
  const fixtures = [makeFixture('tone'), makeFixture('silence')];
  const results = {};
  for (const [id, model] of Object.entries(models)) {
    const started = performance.now();
    const instance = new engineModule.WhisperModel(model.dir);
    const loadedMs = performance.now() - started;
    const runs = [];
    for (const fixture of fixtures) {
      const pcm = new Float32Array(fixture.samples);
      if (fixture.kind === 'tone') {
        for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / fixture.sampleRateHz);
      }
      const at = performance.now();
      const transcription = await instance.transcribe(pcm, { language: 'en' });
      const elapsedMs = performance.now() - at;
      const textLength = (transcription.segments ?? []).reduce((sum, segment) => sum + String(segment.text ?? '').length, 0);
      runs.push({
        fixture: fixture.kind,
        fixtureDigest: fixture.sha256,
        samples: fixture.samples,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        segments: (transcription.segments ?? []).length,
        chars: textLength,
      });
    }
    if (typeof instance.free === 'function') await instance.free();
    results[id] = { modelDigest: model.digest, loadMs: Math.round(loadedMs * 10) / 10, runs };
  }
  const receipt = {
    status: 'measured',
    lot: 'L3',
    createdAt: new Date().toISOString(),
    note: 'Functional pipeline timing on synthetic fixtures (no speech content); quality and latency budgets belong to the M1 campaign with real speech fixtures.',
    ...evidence,
    modelsDir,
    results,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`bench measured: ${out}`);
}
