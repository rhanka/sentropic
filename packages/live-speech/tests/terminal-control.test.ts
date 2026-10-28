// Terminal-controller tests (r3 L4): toggle/stop keys, unknown keys ignored,
// no key leakage, raw-mode restore, push mode fails closed without a qualified
// hold source. VAD independence is proven by the capture-control wiring test.
import { describe, expect, it } from 'vitest';
import {
  ControlError,
  TerminalController,
  type HoldSource,
  type KeyInput,
  type TerminalControlEvent,
} from '../src/node/terminal-control.js';

class FakeHoldSource implements HoldSource {
  private readonly listeners = new Map<'down' | 'up', Set<() => void>>();
  on(event: 'down' | 'up', listener: () => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }
  off(event: 'down' | 'up', listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }
  fire(event: 'down' | 'up'): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
  get wired(): boolean {
    return (this.listeners.get('down')?.size ?? 0) + (this.listeners.get('up')?.size ?? 0) > 0;
  }
}

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

  it('should ignore unknown keys and escape sequences', async () => {
    const { controller, input, events } = driven();
    controller.attach(input);
    input.press('x');
    input.press('\u001b[A');
    input.press('\u001b');
    expect(events).toEqual([]);
    controller.detach();
  });

  it('should dispatch every key of a coalesced chunk in order, never losing stop', async () => {
    const { controller, input, events } = driven();
    controller.attach(input);
    // One raw-mode chunk from fast typing or paste: both keys must land.
    input.press('ms');
    expect(events).toEqual([{ kind: 'mic-toggle' }, { kind: 'stop' }]);
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

  it('should emit explicit mic-on and mic-off in start-end mode with no gate', async () => {
    // Spec §5.1: toggle or explicit start/end keys work on a plain TTY.
    const { controller, input, events } = driven({
      mode: 'start-end',
      bindings: { on: '[', off: ']' },
    });
    controller.attach(input);
    input.press('m');
    input.press('[');
    input.press(']');
    expect(events).toEqual([{ kind: 'mic-on' }, { kind: 'mic-off' }]);
    controller.detach();
  });

  it('should fail closed on hold mode without a real hold source object', async () => {
    expect(() => driven({ mode: 'hold' }).controller).toThrow(ControlError);
  });

  it('should drive mic-on and mic-off from hold-source edges, unwired on detach', async () => {
    const source = new FakeHoldSource();
    const { controller, input, events } = driven({ mode: 'hold', holdSource: source });
    controller.attach(input);
    expect(source.wired).toBe(true);
    source.fire('down');
    source.fire('up');
    expect(events).toEqual([{ kind: 'mic-on' }, { kind: 'mic-off' }]);
    controller.detach();
    expect(source.wired).toBe(false);
    source.fire('down');
    expect(events).toHaveLength(2);
  });
});
