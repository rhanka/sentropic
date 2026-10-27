// TTS engine registry (r3 L6a). Config-only engine selection over an injected
// port: production resolves the local eSpeak NG entry, tests inject fakes, and
// cloud voices arrive at Lp1 (unknown names fail closed, never silently fall
// back). The eSpeak NG binary is hash-verified before every synthesis, exactly
// like the L4 arecord backend; no pins are baked in until a qualified binary
// is measured, so the entry refuses until provisioned instead of guessing.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TtsEngineName = 'local-espeak';

/** Complete WAV file bytes from one synthesis. Freed after playback. */
export interface TtsAudio {
  readonly wav: Buffer;
  readonly voice: string;
  readonly chars: number;
}

export interface TtsSynthesizeOptions {
  readonly voice?: string;
  readonly speedWpm?: number;
}

export interface TtsCapabilities {
  /** File-based engines render a whole WAV before playback (no streaming). */
  readonly streaming: false;
  readonly fileBased: true;
  /** Absolute input bound; longer text is refused, never silently cut. */
  readonly maxChars: number;
}

export interface TtsEnginePort {
  readonly engineId: string;
  readonly capabilities: TtsCapabilities;
  synthesize(text: string, options?: TtsSynthesizeOptions): Promise<TtsAudio>;
  close(): Promise<void>;
}

export class TtsUnsupportedError extends Error {
  readonly code = 'tts_unsupported';
  constructor(message: string) {
    super(`TTS engine unsupported: ${message}`);
    this.name = 'TtsUnsupportedError';
  }
}

export class TtsSynthesisError extends Error {
  readonly code = 'tts_synthesis_failed';
  constructor(message: string) {
    super(`TTS synthesis failed: ${message}`);
    this.name = 'TtsSynthesisError';
  }
}

/**
 * Pinned SHA-256 digests of vetted eSpeak NG builds. Empty until a qualified
 * binary is measured: no digest may be invented, and synthesis refuses until
 * an operator allowlists a local build via ESPEAK_DIGESTS (comma-separated).
 */
export const ESPEAK_SHA256_PINS: readonly string[] = [];

function extraPins(): string[] {
  const raw = process.env.ESPEAK_DIGESTS ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[0-9a-f]{64}$/.test(entry));
}

async function resolveBinary(binary: string): Promise<string> {
  if (binary.includes('/')) return binary;
  const path = process.env.PATH ?? '';
  for (const dir of path.split(':')) {
    if (dir.length === 0) continue;
    const full = `${dir}/${binary}`;
    try {
      await access(full, constants.X_OK);
      return full;
    } catch {
      // Not here; keep searching.
    }
  }
  throw new TtsUnsupportedError(`${binary} is not installed or not executable`);
}

async function digestBinary(path: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new TtsUnsupportedError(`${path} is not installed or not executable`);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

/** Absolute synthesis bound: longer input is refused, never silently cut. */
export const ESPEAK_MAX_CHARS = 2000;

/** Exact espeak-ng argv for file synthesis (explicit argv, shell:false). Pure. */
export function buildEspeakArgs(
  text: string,
  options: { voice: string; speedWpm: number; wavPath: string },
): string[] {
  return ['-v', options.voice, '-s', String(options.speedWpm), '-w', options.wavPath, text];
}

export interface EspeakNgOptions {
  readonly voice?: string;
  readonly speedWpm?: number;
  readonly maxChars?: number;
}

/** Spawn runner: real espeak-ng unless tests inject a fake. */
export type EspeakRunner = (argv: string[], wavPath: string) => Promise<void>;

let tempCounter = 0;

/**
 * Local eSpeak NG engine. Text travels as an explicit argv element (bounded
 * narration keeps it short); audio lands in a temp WAV that is always deleted,
 * whether synthesis succeeds or fails.
 */
export class EspeakNgEngine implements TtsEnginePort {
  readonly engineId = 'espeak-ng/1.52';
  readonly capabilities: TtsCapabilities = { streaming: false, fileBased: true, maxChars: ESPEAK_MAX_CHARS };
  private readonly voice: string;
  private readonly speedWpm: number;
  private readonly maxChars: number;
  private closed = false;

  constructor(
    private readonly binary = process.env.ESPEAK_BIN ?? 'espeak-ng',
    private readonly allowPins: readonly string[] = [],
    private readonly runner: EspeakRunner | null = null,
    options: EspeakNgOptions = {},
  ) {
    this.voice = options.voice ?? 'en';
    this.speedWpm = options.speedWpm ?? 175;
    this.maxChars = options.maxChars ?? ESPEAK_MAX_CHARS;
  }

  private async verifiedBinary(): Promise<string> {
    const path = await resolveBinary(this.binary);
    const digest = await digestBinary(path);
    const pins = [...ESPEAK_SHA256_PINS, ...this.allowPins, ...extraPins()];
    if (!pins.includes(digest)) {
      throw new TtsUnsupportedError(
        `digest mismatch for ${path}: refusing unpinned helper (allowlist via ESPEAK_DIGESTS)`,
      );
    }
    return path;
  }

  async synthesize(text: string, options: TtsSynthesizeOptions = {}): Promise<TtsAudio> {
    if (this.closed) throw new TtsSynthesisError('engine is closed');
    if (text.length === 0) throw new TtsSynthesisError('refusing empty narration');
    const maxChars = this.maxChars;
    if (text.length > maxChars) {
      throw new TtsSynthesisError(`narration too long: ${text.length} chars (max ${maxChars})`);
    }
    const voice = options.voice ?? this.voice;
    if (voice.length === 0) throw new TtsSynthesisError('refusing empty voice');
    const speedWpm = options.speedWpm ?? this.speedWpm;
    if (!Number.isInteger(speedWpm) || speedWpm < 80 || speedWpm > 450) {
      throw new TtsSynthesisError(`speed out of range: ${String(speedWpm)} wpm (80-450)`);
    }
    // Pins first: no helper exists yet, so nothing can leak on mismatch.
    const binary = await this.verifiedBinary();
    const wavPath = join(tmpdir(), `live-stt-tts-${process.pid}-${tempCounter++}.wav`);
    const argv = buildEspeakArgs(text, { voice, speedWpm, wavPath });
    try {
      if (this.runner !== null) {
        await this.runner(argv, wavPath);
      } else {
        await runEspeak(binary, argv);
      }
      let wav: Buffer;
      try {
        wav = await readFile(wavPath);
      } catch {
        throw new TtsSynthesisError('espeak-ng produced no WAV output');
      }
      if (wav.length === 0) throw new TtsSynthesisError('espeak-ng produced an empty WAV');
      return { wav, voice, chars: text.length };
    } finally {
      await rm(wavPath, { force: true });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function runEspeak(binary: string, argv: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, argv, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.on('error', () => reject(new TtsSynthesisError(`${binary} is not installed or not executable`)));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-300);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new TtsSynthesisError(`espeak-ng exited ${String(code)}: ${stderr}`));
    });
  });
}

export interface TtsRegistryOptions {
  /** Injected engines for tests (config-only switch without a binary). */
  readonly engines?: Record<string, TtsEnginePort>;
}

/**
 * Named TTS engine selection. Cloud voices are an Lp1 concern: any name that
 * is not a registered local engine fails closed with that pointer.
 */
export class TtsRegistry {
  private readonly engines: Record<string, TtsEnginePort>;
  constructor(options: TtsRegistryOptions = {}) {
    this.engines = options.engines ?? { 'local-espeak': new EspeakNgEngine() };
  }

  /** Engine names selectable by configuration. */
  availableEngines(): string[] {
    return Object.keys(this.engines);
  }

  selectTtsEngine(name: string): TtsEnginePort {
    const engine = this.engines[name];
    if (!engine) {
      throw new TtsUnsupportedError(
        `unknown TTS engine ${JSON.stringify(name)} (available: ${this.availableEngines().join(', ') || 'none'}; cloud voices arrive at Lp1)`,
      );
    }
    return engine;
  }
}
