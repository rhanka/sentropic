// Cancellable WAV playback (r3 L6a). The loop never touches the speaker
// directly: playback owns one aplay child, a bounded temp file, and a fence
// cancel (SIGTERM, then SIGKILL) that the voice loop invokes synchronously on
// barge-in. The binary is hash-verified before every play, exactly like the L4
// arecord backend; anything unpinned is refused before any audio flows.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class PlaybackError extends Error {
  readonly code = 'tts_playback_failed';
  constructor(message: string) {
    super(`Playback failed: ${message}`);
    this.name = 'PlaybackError';
  }
}

export class PlaybackCancelledError extends Error {
  readonly code = 'tts_playback_cancelled';
  constructor() {
    super('Playback cancelled');
    this.name = 'PlaybackCancelledError';
  }
}

/**
 * Pinned SHA-256 digests of vetted aplay builds. aplay and arecord are
 * byte-identical dual alsa-utils binaries (verified with cmp on the Ubuntu
 * host), so the vetted host build carries the same digest; the pinned CI
 * image build is still pending (receipt: blocked). Operators may allowlist a
 * local build via APLAY_DIGESTS (comma-separated).
 */
export const APLAY_SHA256_PINS: readonly string[] = [
  '4436d05a3f9ce9d92432ea73dd5b6233f69d6243a6cfb3b6b1b8852622cb26c5',
];

function extraPins(): string[] {
  const raw = process.env.APLAY_DIGESTS ?? '';
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
  throw new PlaybackError(`${binary} is not installed or not executable`);
}

async function digestBinary(path: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new PlaybackError(`${path} is not installed or not executable`);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

/** Absolute WAV bound: larger payloads are refused, never partially played. */
export const PLAYBACK_MAX_WAV_BYTES = 16 * 1024 * 1024;

/** Exact aplay argv for WAV playback. Pure: unit-tested without spawning. */
export function buildAplayArgs(wavPath: string, options: { device?: string }): string[] {
  if (options.device !== undefined) return ['-D', options.device, wavPath];
  return [wavPath];
}

export interface PlaybackPort {
  /** Resolve on natural end; reject PlaybackCancelledError on cancel. */
  play(wav: Buffer): Promise<void>;
  /** Fence cancel: reap the child (SIGTERM, then SIGKILL) and settle the play. */
  cancel(): void;
  readonly playing: boolean;
  close(): void;
}

let tempCounter = 0;

/** aplay subprocess playback with fence cancel and temp-file hygiene. */
export class AplayPlayback implements PlaybackPort {
  private child: ReturnType<typeof spawn> | null = null;
  private settlePlay: ((error: Error | null) => void) | null = null;
  private cancelled = false;
  private _playing = false;
  private _closed = false;

  constructor(
    private readonly binary = process.env.APLAY_BIN ?? 'aplay',
    private readonly allowPins: readonly string[] = [],
    private readonly device?: string,
  ) {}

  get playing(): boolean {
    return this._playing;
  }

  private async verifiedBinary(): Promise<string> {
    const path = await resolveBinary(this.binary);
    const digest = await digestBinary(path);
    const pins = [...APLAY_SHA256_PINS, ...this.allowPins, ...extraPins()];
    if (!pins.includes(digest)) {
      throw new PlaybackError(`digest mismatch for ${path}: refusing unpinned helper`);
    }
    return path;
  }

  async play(wav: Buffer): Promise<void> {
    if (this._closed) throw new PlaybackError('playback is closed');
    if (this._playing) throw new PlaybackError('playback already playing');
    if (wav.length === 0) throw new PlaybackError('refusing empty WAV');
    if (wav.length > PLAYBACK_MAX_WAV_BYTES) {
      throw new PlaybackError(`WAV too large: ${wav.length} bytes (max ${PLAYBACK_MAX_WAV_BYTES})`);
    }
    // Pins first: no child exists yet, so nothing can leak on mismatch.
    const binary = await this.verifiedBinary();
    const wavPath = join(tmpdir(), `live-stt-play-${process.pid}-${tempCounter++}.wav`);
    await writeFile(wavPath, wav);
    this._playing = true;
    this.cancelled = false;
    try {
      await new Promise<void>((resolve, reject) => {
        this.settlePlay = (error) => (error === null ? resolve() : reject(error));
        const child = spawn(binary, buildAplayArgs(wavPath, { device: this.device }), {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;
        let stderr = '';
        child.on('error', () => this.settle(new PlaybackError(`${binary} is not installed or not executable`)));
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString('utf8')}`.slice(-300);
        });
        child.on('close', (code) => {
          if (this.cancelled) this.settle(new PlaybackCancelledError());
          else if (code === 0) this.settle(null);
          else this.settle(new PlaybackError(`aplay exited ${String(code)}: ${stderr}`));
        });
      });
    } finally {
      this._playing = false;
      this.child = null;
      this.settlePlay = null;
      await rm(wavPath, { force: true });
    }
  }

  private settle(error: Error | null): void {
    const settle = this.settlePlay;
    this.settlePlay = null;
    settle?.(error);
  }

  cancel(): void {
    const child = this.child;
    if (child === null || !this._playing) return;
    this.cancelled = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // Already gone: its close event settles the play.
    }
    const escalate = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Gone between the two signals.
      }
    }, 500);
    escalate.unref?.();
    child.once('close', () => clearTimeout(escalate));
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.cancel();
  }
}
