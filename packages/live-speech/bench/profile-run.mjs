// Single-profile bench run (r3 L3). Runs in its own process because the native
// engine binding loads once per process: one profile and one fixture per process.
// Stdout: JSON { loadMs, run, fixture, pinned, provisioned } on success; stderr
// plus nonzero exit on failure. The eSpeak NG fixture is synthesized at run time
// and resampled to 16 kHz in-process; digests are recorded, audio never leaves.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const dist = arg('dist');
const modelsDir = arg('models-dir');
const profileId = arg('profile');
const fixtureKind = arg('fixture-kind', 'espeak');
const espeakBin = arg('espeak-bin', 'espeak-ng');
const utteranceText = arg('utterance');
const utteranceVoice = arg('voice', 'en');
const utteranceSpeed = arg('speed', '175');
const installLock = arg('install-lock');

if (!dist || !modelsDir || !profileId) {
  console.error('usage: profile-run.mjs --dist <dir> --models-dir <dir> --profile <id> [--fixture-kind espeak|silence] [--espeak-bin <path> --utterance <text>] [--install-lock <file>]');
  process.exit(2);
}

const profiles = await import(pathToFileURL(join(dist, 'node/profiles.js')).href);
const workerPort = await import(pathToFileURL(join(dist, 'node/worker-port.js')).href);
const sessionMod = await import(pathToFileURL(join(dist, 'node/local-stt.js')).href);

const profile = profiles.LOCAL_STT_PROFILES.find((item) => item.profileId === profileId);
if (!profile) {
  console.error(`unknown profile: ${profileId}`);
  process.exit(2);
}

/** Pinned digests from the TypeScript source (single source of truth). */
const pinned = {
  tiny: profiles.LOCAL_STT_PROFILES[0].model.files.modelBin,
  base: profiles.LOCAL_STT_PROFILES[1].model.files.modelBin,
  engineVersion: profiles.LOCAL_STT_PROFILES[0].model.engineVersion,
};

/** Installed engine provenance from the provisioning lockfile (recorded, never refetched). */
let provisioned = null;
if (installLock) {
  const lock = JSON.parse(readFileSync(installLock, 'utf8'));
  const pick = (name) => lock.packages?.[`node_modules/${name}`] ?? null;
  provisioned = {
    'faster-whisper-ts': pick('faster-whisper-ts'),
    'onnxruntime-node': pick('onnxruntime-node'),
    koffi: pick('koffi'),
    '@huggingface/tokenizers': pick('@huggingface/tokenizers'),
  };
}

/** Fixture PCM at the profile rate: silence (negative case) or eSpeak NG --stdout
 * WAV (22050 Hz int16 mono) resampled to 16 kHz in-process (positive case). */
function buildFixture(kind) {
  if (kind === 'silence') return { expectFinal: false, pcm: new Float32Array(profile.sampleRateHz), meta: null };
  if (kind === 'espeak') {
    if (!utteranceText) {
      console.error('profile-run.mjs: espeak fixture needs --utterance');
      process.exit(2);
    }
    const synth = spawnSync(espeakBin, ['-v', utteranceVoice, '-s', utteranceSpeed, '--stdout', utteranceText], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    if (synth.status !== 0 || !synth.stdout || synth.stdout.length < 100) {
      console.error(`espeak-ng synthesis failed: ${synth.error?.message ?? ''}`.slice(0, 300));
      process.exit(2);
    }
    const digest = `sha256:${createHash('sha256').update(synth.stdout).digest('hex')}`;
    const wav = synth.stdout;
    const pcm = (() => {
      const data = wav.subarray(44);
      const count = Math.floor(data.length / 2);
      const srcRate = 22050;
      const out = new Float32Array(Math.floor((count * profile.sampleRateHz) / srcRate));
      for (let i = 0; i < out.length; i++) {
        const pos = i * (srcRate / profile.sampleRateHz);
        const base = Math.floor(pos);
        const frac = pos - base;
        out[i] = (data.readInt16LE(base * 2) / 32768) * (1 - frac)
          + (data.readInt16LE(Math.min(base + 1, count - 1) * 2) / 32768) * frac;
      }
      return out;
    })();
    return { expectFinal: true, pcm, meta: { text: utteranceText, voice: utteranceVoice, speed: Number(utteranceSpeed), wavDigest: digest } };
  }
  return null;
}
const fixture = buildFixture(fixtureKind);
if (!fixture) {
  console.error(`unknown fixture kind: ${fixtureKind}`);
  process.exit(2);
}

const loadStart = performance.now();
const client = await workerPort.NodeWorkerClient.create({ profile, modelsRoot: modelsDir, timeoutMs: 120000 });
const loadMs = performance.now() - loadStart;
let run;
try {
  const events = [];
  const session = new sessionMod.LocalSttSession({ profile, port: client, emit: (event) => events.push(event) });
  const at = performance.now();
  const chunk = 8000;
  // Real-time pacing between chunks: without it the whole fixture lands in one
  // synchronous burst, every cadence tick after the first skips, and the endpoint
  // supersedes the single window decode — partials stay 0 and rolling-window
  // stitching is never exercised. Paced pushes let window decodes resolve and
  // commit mid-utterance, so partials count the windows actually stitched.
  for (let offset = 0; offset < fixture.pcm.length; offset += chunk) {
    session.pushFrames(fixture.pcm.subarray(offset, Math.min(offset + chunk, fixture.pcm.length)));
    if (offset + chunk < fixture.pcm.length) {
      await new Promise((resolve) => setTimeout(resolve, (chunk / profile.sampleRateHz) * 1000));
    }
  }
  session.pushFrames(new Float32Array(profile.sampleRateHz));
  let finals = [];
  if (fixture.expectFinal) {
    const deadline = Date.now() + 120000;
    while (finals.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finals = events.filter((event) => event.type === 'final');
      if (events.some((event) => event.type === 'error')) break;
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 500));
    finals = events.filter((event) => event.type === 'final');
  }
  const elapsedMs = performance.now() - at;
  if (fixture.expectFinal) {
    // Quiesce before teardown: with paced multi-window audio a superseded window
    // decode may still be in flight when the final lands; killing the worker
    // mid-native-call aborts the process (koffi FATAL at teardown). Waiting lets
    // the straggler resolve (superseded, never emitted) so terminate hits idle.
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  run = {
    fixture: fixtureKind,
    samples: fixture.pcm.length,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    finals: finals.length,
    partials: events.filter((event) => event.type === 'partial').length,
    chars: finals.reduce((sum, event) => sum + event.text.length, 0),
    errors: events.filter((event) => event.type === 'error').map((event) => event.message),
  };
  session.close();
} finally {
  client.terminate();
}
console.log(JSON.stringify({ loadMs: Math.round(loadMs * 10) / 10, run, fixture: fixture.meta, pinned, provisioned }));
