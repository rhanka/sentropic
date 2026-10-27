// TTS engine registry (r3 L6a). Config-only engine selection over an injected
// port: production resolves the local eSpeak NG entry, tests inject fakes, and
// cloud voices arrive at Lp1 (unknown names fail closed, never silently fall
// back). Synthesis pipes text on stdin and collects WAV from stdout — the
// narration text never appears in argv (no /proc exposure) and no audio file
// is ever written, only a bounded RAM buffer that is dropped after playback.
// The eSpeak NG binary is hash-verified before every synthesis, exactly like
// the L4 arecord backend; no pins are baked in until a qualified binary is
// measured, so the entry refuses until provisioned instead of guessing.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

export type TtsEngineName = 'local-espeak';

/** Complete WAV file bytes from stdout. Dropped after playback. */
export interface TtsAudio {
  readonly wav: Buffer;
  readonly voice: string;
  readonly chars: number;
}

export interface TtsSynthesizeOptions {
  readonly voice?: string;
  readonly speedWpm?: number;
  /** Abort a running synthesis (barge-in kills the espeak child). */
  readonly signal?: AbortSignal;
}

export interface TtsCapabilities {
  /** Piped engines render a whole WAV to stdout before playback (no streaming). */
  readonly streaming: false;
  readonly fileBased: false;
  readonly pipedStdin: true;
  /** Absolute input bound: longer text is refused, never silently cut. */
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

/** Absolute stdout bound: runaway output kills the child instead of growing RAM. */
export const ESPEAK_MAX_WAV_BYTES = 8 * 1024 * 1024;

/**
 * Exact espeak-ng argv for piped synthesis (man page: --stdin reads text to
 * the end of stream, --stdout writes speech output). No text in argv. Pure.
 */
export function buildEspeakArgs(options: { voice: string; speedWpm: number }): string[] {
  return ['--stdin', '-v', options.voice, '-s', String(options.speedWpm), '--stdout'];
}

export interface EspeakNgOptions {
  readonly voice?: string;
  readonly speedWpm?: number;
  readonly maxChars?: number;
}

/**
 * Spawn runner: real espeak-ng unless tests inject a fake. The runner owns the
 * whole synth (argv without text, stdin text in, WAV bytes out).
 */
export type EspeakRunner = (argv: string[], stdinText: string, signal?: AbortSignal) => Promise<Buffer>;

/** SIGKILL escalation delay: bounded by the §9 150 ms stop-to-silence gate. */
const ESCALATE_MS = 100;

/**
 * Local eSpeak NG engine. Text travels on stdin (never argv); WAV returns on
 * stdout into a bounded RAM buffer. An abort signal kills the child, so a
 * barge during synthesis never waits for espeak to finish.
 */
export class EspeakNgEngine implements TtsEnginePort {
  // Unpinned until a qualified binary is measured (receipt: blocked).
  readonly engineId = 'espeak-ng/unpinned';
  readonly capabilities: TtsCapabilities = { streaming: false, fileBased: false, pipedStdin: true, maxChars: ESPEAK_MAX_CHARS };
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
    if (text.length > this.maxChars) {
      throw new TtsSynthesisError(`narration too long: ${text.length} chars (max ${this.maxChars})`);
    }
    const voice = options.voice ?? this.voice;
    if (voice.length === 0) throw new TtsSynthesisError('refusing empty voice');
    const speedWpm = options.speedWpm ?? this.speedWpm;
    if (!Number.isInteger(speedWpm) || speedWpm < 80 || speedWpm > 450) {
      throw new TtsSynthesisError(`speed out of range: ${String(speedWpm)} wpm (80-450)`);
    }
    if (options.signal?.aborted === true) {
      throw new TtsSynthesisError('synthesis aborted before spawn');
    }
    // A test seam bypasses verification: production never injects a runner,
    // and the digest paths below are covered against a fixture binary.
    if (this.runner !== null) {
      const wav = await this.runner(
        buildEspeakArgs({ voice, speedWpm }),
        text,
        options.signal,
      );
      if (wav.length === 0) throw new TtsSynthesisError('espeak-ng produced an empty WAV');
      return { wav, voice, chars: text.length };
    }
    // Pins first: no helper exists yet, so nothing can leak on mismatch.
    const binary = await this.verifiedBinary();
    const wav = await runEspeak(binary, buildEspeakArgs({ voice, speedWpm }), text, options.signal);
    return { wav, voice, chars: text.length };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function runEspeak(binary: string, argv: string[], text: string, signal?: AbortSignal): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(binary, argv, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    let aborting = false;
    const settle = (error: Error | null, wav?: Buffer): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error === null && wav !== undefined) resolve(wav);
      else reject(error ?? new TtsSynthesisError('espeak-ng failed'));
    };
    const kill = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Already gone; its close event settles the synth.
      }
      const escalate = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Gone between the two signals.
        }
      }, ESCALATE_MS);
      escalate.unref?.();
      child.once('close', () => clearTimeout(escalate));
    };
    const onAbort = (): void => {
      // Never settle here: the open only rejects once the child is reaped
      // below, so no orphan survives the abort.
      aborting = true;
      kill();
    };
    child.on('error', () => settle(new TtsSynthesisError(`${binary} is not installed or not executable`)));
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > ESPEAK_MAX_WAV_BYTES) {
        kill();
        settle(new TtsSynthesisError(`espeak-ng output exceeded ${ESPEAK_MAX_WAV_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-300);
    });
    child.on('close', (code) => {
      if (aborting) {
        settle(new TtsSynthesisError('synthesis aborted by barge-in'));
      } else if (code === 0) {
        const wav = Buffer.concat(chunks);
        if (wav.length === 0) settle(new TtsSynthesisError('espeak-ng produced no WAV output'));
        else settle(null, wav);
      } else {
        settle(new TtsSynthesisError(`espeak-ng exited ${String(code)}: ${stderr}`));
      }
    });
    if (signal?.aborted === true) {
      // No child exists yet: nothing to reap, settle at once.
      settle(new TtsSynthesisError('synthesis aborted by barge-in'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      child.stdin?.write(text, 'utf8');
      child.stdin?.end();
    } catch {
      // Already gone; the close event settles the synth.
    }
    child.stdin?.on('error', () => {
      // The child died early: the close code decides, never the pipe.
    });
  });
}

export interface TtsRegistryOptions {
  /** Injected engines for tests (config-only switching without a binary). */
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
