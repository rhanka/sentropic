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

export type TerminalKeyMode = 'toggle' | 'push';

export interface TerminalControllerOptions {
  readonly bindings?: Partial<TerminalKeyBindings>;
  readonly mode?: TerminalKeyMode;
  /** Qualified native hotkey source enabling push mode. Without it, push fails closed. */
  readonly holdCapable?: boolean;
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
  private input: KeyInput | null = null;
  private attachedRaw = false;
  private readonly listener = (chunk: Buffer): void => {
    this.onKey(chunk.toString('utf8'));
  };

  constructor(
    private readonly emit: (event: TerminalControlEvent) => void,
    options: TerminalControllerOptions = {},
  ) {
    this.bindings = { ...DEFAULT_BINDINGS, ...options.bindings };
    this.mode = options.mode ?? 'toggle';
    if (this.mode === 'push' && options.holdCapable !== true) {
      throw new ControlError('push mode needs a qualified hold source (holdCapable)');
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
  }

  /** Remove the listener and restore raw mode. Idempotent. */
  detach(): void {
    const input = this.input;
    this.input = null;
    if (input === null) return;
    input.off('data', this.listener);
    if (this.attachedRaw && typeof input.setRawMode === 'function') {
      input.setRawMode(false);
      this.attachedRaw = false;
    }
  }

  private onKey(key: string): void {
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
