// Cancellable WAV playback (r3 L6a). The loop never touches the speaker
// directly: playback owns one aplay child fed over stdin — no audio files at
// any point, only a bounded RAM buffer that is dropped after close. Barge-in
// cancels through a generation counter, so a cancel that lands during the
// pre-spawn verification still prevents the spawn (sticky cancel): audio can
// never play after the fence. The binary is hash-verified before every play,
// exactly like the L4 arecord backend; anything unpinned is refused before
// any audio flows.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

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

/**
 * Exact aplay argv for stdin WAV playback (WAV header autodetected by aplay,
 * per its man page: no filename means standard input). Pure.
 */
export function buildAplayArgs(options: { device?: string }): string[] {
  if (options.device !== undefined) return ['-D', options.device];
  return [];
}

export interface PlaybackPort {
  /** Resolve on natural end; reject PlaybackCancelledError on cancel. */
  play(wav: Buffer): Promise<void>;
  /** Fence cancel: reap the child (SIGTERM, then SIGKILL) and settle the play. */
  cancel(): void;
  readonly playing: boolean;
  close(): void;
}

/** SIGKILL escalation delay: bounded by the §9 150 ms stop-to-silence gate. */
const ESCALATE_MS = 100;

/** aplay subprocess playback with fence cancel. Sticky across the pre-spawn window. */
export class AplayPlayback implements PlaybackPort {
  private child: ReturnType<typeof spawn> | null = null;
  private settlePlay: ((error: Error | null) => void) | null = null;
  private playGen = -1;
  private runGen = 0;
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
    // Capture the generation first: a cancel that lands during verification
    // still wins — the child is never spawned after the fence.
    const myGen = this.runGen;
    // Pins first: no child exists yet, so nothing can leak on mismatch.
    const binary = await this.verifiedBinary();
    if (this.runGen !== myGen) {
      throw new PlaybackCancelledError();
    }
    await new Promise<void>((resolve, reject) => {
      this.settlePlay = (error) => (error === null ? resolve() : reject(error));
      const child = spawn(binary, buildAplayArgs({ device: this.device }), {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      this.playGen = myGen;
      this._playing = true;
      let stderr = '';
      child.on('error', () => this.settle(new PlaybackError(`${binary} is not installed or not executable`)));
      child.stdin?.on('error', () => {
        // The child died early (e.g. nonzero exit before reading): the close
        // code below decides the outcome, never the pipe.
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-300);
      });
      try {
        child.stdin?.write(wav);
        child.stdin?.end();
      } catch {
        // Already gone; the close event settles the play.
      }
      child.on('close', () => {
        if (this.runGen !== myGen) this.settle(new PlaybackCancelledError());
        else if (child.exitCode === 0) this.settle(null);
        else this.settle(new PlaybackError(`aplay exited ${String(child.exitCode)}: ${stderr}`));
      });
    }).finally(() => {
      this._playing = false;
      this.child = null;
      this.settlePlay = null;
    });
  }

  private settle(error: Error | null): void {
    const settle = this.settlePlay;
    this.settlePlay = null;
    settle?.(error);
  }

  cancel(): void {
    // Always bump the generation — even with no child yet — so a cancel that
    // lands before spawn still prevents it.
    this.runGen += 1;
    const child = this.child;
    if (child === null || !this._playing) return;
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
    }, ESCALATE_MS);
    escalate.unref?.();
    child.once('close', () => clearTimeout(escalate));
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.cancel();
  }
}
