// Terminal-controller tests (r3 L4): toggle/stop keys, unknown keys ignored,
// no key leakage, raw-mode restore, push mode fails closed without a qualified
// hold source. VAD independence is proven by the capture-control wiring test.
import { describe, expect, it } from 'vitest';
import { ControlError, TerminalController, type KeyInput, type TerminalControlEvent } from '../src/node/terminal-control.js';

class FakeKeyInput implements KeyInput {
  readonly listeners = new Set<(chunk: Buffer) => void>();
  rawMode: boolean | null = null;
  readonly writes: unknown[] = [];
  readonly isTTY = true;

  on(_event: 'data', listener: (chunk: Buffer) => void): void {
    this.listeners.add(listener);
  }

  off(_event: 'data', listener: (chunk: Buffer) => void): void {
    this.listeners.delete(listener);
  }

  setRawMode(mode: boolean): void {
    this.rawMode = mode;
  }

  write(chunk: unknown): void {
    this.writes.push(chunk);
  }

  press(key: string): void {
    for (const listener of this.listeners) listener(Buffer.from(key, 'utf8'));
  }
}

function driven(options?: ConstructorParameters<typeof TerminalController>[1]): {
  controller: TerminalController;
  input: FakeKeyInput;
  events: TerminalControlEvent[];
} {
  const events: TerminalControlEvent[] = [];
  const controller = new TerminalController((event) => events.push(event), options);
  const input = new FakeKeyInput();
  return { controller, input, events };
}

describe('terminal controller', () => {
  it('should emit mic-toggle on the toggle key and stop on the stop key', async () => {
    const { controller, input, events } = driven();
    controller.attach(input);
    input.press('m');
    input.press('s');
    expect(events).toEqual([{ kind: 'mic-toggle' }, { kind: 'stop' }]);
    controller.detach();
  });

  it('should emit mic-mode on the open-mic key without disturbing toggle', async () => {
    const { controller, input, events } = driven();
    controller.attach(input);
    input.press('o');
    input.press('m');
    expect(events).toEqual([{ kind: 'mic-mode' }, { kind: 'mic-toggle' }]);
    controller.detach();
  });

  it('should ignore unknown keys and multi-key sequences', async () => {
    const { controller, input, events } = driven();
    controller.attach(input);
    input.press('x');
    input.press('\u001b[A');
    expect(events).toEqual([]);
    controller.detach();
  });

  it('should never leak keys: no writes, no forwarding, silent after detach', async () => {
    const { controller, input, events } = driven();
    controller.attach(input);
    input.press('m');
    expect(events).toHaveLength(1);
    expect(input.writes).toEqual([]);
    controller.detach();
    expect(input.listeners.size).toBe(0);
    input.press('m');
    input.press('s');
    expect(events).toHaveLength(1);
  });

  it('should take and restore raw mode only around the attachment', async () => {
    const { controller, input } = driven();
    expect(input.rawMode).toBeNull();
    controller.attach(input);
    expect(input.rawMode).toBe(true);
    controller.detach();
    expect(input.rawMode).toBe(false);
    controller.detach();
    expect(input.rawMode).toBe(false);
  });

  it('should fail closed on push mode without a qualified hold source', async () => {
    expect(() => driven({ mode: 'push' }).controller).toThrow(ControlError);
  });

  it('should emit explicit mic-on and mic-off in push mode with a hold source', async () => {
    const { controller, input, events } = driven({
      mode: 'push',
      holdCapable: true,
      bindings: { on: '[', off: ']' },
    });
    controller.attach(input);
    input.press('m');
    input.press('[');
    input.press(']');
    expect(events).toEqual([{ kind: 'mic-on' }, { kind: 'mic-off' }]);
    controller.detach();
  });
});
