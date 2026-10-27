// Terminal voice controller (r3 L4). Owns key handling on its own TTY input:
// toggle or explicit start/end keys, plus immediate Stop. The controller never
// touches process.stdin implicitly, never forwards keys anywhere (no leakage),
// and restores raw mode on detach. A generic terminal key stream cannot report
// key release, so push mode requires a qualified hold source (holdCapable) and
// fails closed without one; true press-and-hold lives in that source, which
// drives mic-on/mic-off directly. Key handling never depends on VAD.
export type TerminalControlEvent =
  | { readonly kind: 'mic-toggle' }
  | { readonly kind: 'mic-on' }
  | { readonly kind: 'mic-off' }
  | { readonly kind: 'mic-mode' }
  | { readonly kind: 'stop' };

export interface TerminalKeyBindings {
  /** Toggle-mode mic key (default 'm'). */
  readonly toggle: string;
  /** Push-mode explicit mic-on key (default '['). */
  readonly on: string;
  /** Push-mode explicit mic-off key (default ']'). */
  readonly off: string;
  /** Open-mic request key in every mode (default 'o'). */
  readonly micMode: string;
  /** Immediate-stop key in every mode (default 's'). */
  readonly stop: string;
}

const DEFAULT_BINDINGS: TerminalKeyBindings = { toggle: 'm', on: '[', off: ']', micMode: 'o', stop: 's' };

export type TerminalKeyMode = 'toggle' | 'start-end' | 'hold';

/** Qualified hold source: delivers discrete down/up edges for true press-and-hold. */
export interface HoldSource {
  on(event: 'down' | 'up', listener: () => void): void;
  off(event: 'down' | 'up', listener: () => void): void;
}

export interface TerminalControllerOptions {
  readonly bindings?: Partial<TerminalKeyBindings>;
  readonly mode?: TerminalKeyMode;
  /**
   * Real hold-source object enabling hold mode (spec §5.1: true hold needs a
   * qualified native hotkey or browser companion). Without it, hold fails
   * closed. A boolean cannot qualify a source, so none is accepted.
   */
  readonly holdSource?: HoldSource;
}

/** Minimal TTY input surface. Pass an owned stream; stdin is never implicit. */
export interface KeyInput {
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  off(event: 'data', listener: (chunk: Buffer) => void): void;
  setRawMode?(mode: boolean): void;
  readonly isTTY?: boolean;
}

export class ControlError extends Error {
  readonly code = 'stt_control_error';
  constructor(message: string) {
    super(`Terminal control error: ${message}`);
    this.name = 'ControlError';
  }
}

/** Key-mode and open-mic toggle control on a dedicated TTY stream. */
export class TerminalController {
  private readonly bindings: TerminalKeyBindings;
  private readonly mode: TerminalKeyMode;
  private readonly holdSource?: HoldSource;
  private input: KeyInput | null = null;
  private attachedRaw = false;
  private readonly listener = (chunk: Buffer): void => {
    this.onKey(chunk.toString('utf8'));
  };
  private readonly onHoldDown = (): void => {
    this.emit({ kind: 'mic-on' });
  };
  private readonly onHoldUp = (): void => {
    this.emit({ kind: 'mic-off' });
  };

  constructor(
    private readonly emit: (event: TerminalControlEvent) => void,
    options: TerminalControllerOptions = {},
  ) {
    this.bindings = { ...DEFAULT_BINDINGS, ...options.bindings };
    this.mode = options.mode ?? 'toggle';
    this.holdSource = options.holdSource;
    if (this.mode === 'hold' && this.holdSource === undefined) {
      throw new ControlError('hold mode needs a real hold source object (down/up edges)');
    }
  }

  /** Attach to an owned TTY stream and take raw mode. Never steals stdin. */
  attach(input: KeyInput): void {
    if (this.input !== null) throw new ControlError('controller already attached');
    this.input = input;
    if (typeof input.setRawMode === 'function') {
      input.setRawMode(true);
      this.attachedRaw = true;
    }
    input.on('data', this.listener);
    this.holdSource?.on('down', this.onHoldDown);
    this.holdSource?.on('up', this.onHoldUp);
  }

  /** Remove the listener and restore raw mode. Idempotent. */
  detach(): void {
    const input = this.input;
    this.input = null;
    if (input !== null) {
      input.off('data', this.listener);
      if (this.attachedRaw && typeof input.setRawMode === 'function') {
        input.setRawMode(false);
        this.attachedRaw = false;
      }
    }
    this.holdSource?.off('down', this.onHoldDown);
    this.holdSource?.off('up', this.onHoldUp);
  }

  private onKey(chunk: string): void {
    // Strip ANSI escape sequences, then dispatch per code point: a raw-mode
    // chunk can coalesce several keys ('ms' from fast typing or paste), and
    // Stop must never be lost to coalescing. Lone ESC is dropped, never a key.
    const stripped = chunk.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b./g, '');
    for (const key of stripped) this.onKeyPress(key);
  }

  private onKeyPress(key: string): void {
    if (key === this.bindings.stop) {
      this.emit({ kind: 'stop' });
      return;
    }
    if (key === this.bindings.micMode) {
      this.emit({ kind: 'mic-mode' });
      return;
    }
    if (this.mode === 'toggle') {
      if (key === this.bindings.toggle) this.emit({ kind: 'mic-toggle' });
      return;
    }
    if (key === this.bindings.on) this.emit({ kind: 'mic-on' });
    else if (key === this.bindings.off) this.emit({ kind: 'mic-off' });
  }
}
