import { assertScope, getTurn, isTerminal, same } from './session.js';
import type { ControlPort, FenceReceipt, Journal, RiskAcceptance, RiskPrompt, RiskRequest, Scope,
  SessionState, ToolCall, ToolOutcome, ToolResult, TrustedAuthority, TurnRef } from './session.js';

const unresolved = (state: SessionState) => Object.values(state.effects)
  .filter(e => e.status === 'unknown' || e.status === 'completion-pending');

export class InterruptAuthority {
  constructor(protected readonly journal: Journal, protected readonly control: ControlPort,
    protected readonly authority: TrustedAuthority, private readonly stopPlayback: (turnEpoch: number) => void,
    protected readonly now: () => number) {}

  async status(ref: TurnRef) { return this.journal.transact(state => getTurn(state, ref)); }

  async send(ref: TurnRef): Promise<boolean> {
    const input = await this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (turn.fence || turn.phase !== 'committed' || !state.connected) return undefined;
      turn.phase = 'starting'; // Durable before the single native submission attempt.
      return { ...ref, inputRef: turn.inputRef };
    });
    if (!input) return false;
    const result = await this.control.start(input);
    await this.bindNative(ref, result.nativeTurnId);
    return true;
  }

  private async bindNative(ref: TurnRef, nativeTurnId: string) {
    if (!nativeTurnId) throw new Error('Native turn identity required');
    const fenced = await this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (turn.nativeTurnId && turn.nativeTurnId !== nativeTurnId) throw new Error('Native identity conflict');
      turn.nativeTurnId = nativeTurnId;
      if (!turn.fence && !isTerminal(turn)) turn.phase = 'running';
      return Boolean(turn.fence);
    });
    if (fenced) await this.flushInterrupt(ref);
  }

  /** Retryable idempotent control only; never reissues turn/start. RPC receipt is not terminal. */
  async flushInterrupt(ref: TurnRef): Promise<void> {
    const turn = await this.status(ref);
    if (turn.fence && turn.nativeTurnId) await this.control.interrupt({ ...ref, nativeTurnId: turn.nativeTurnId });
  }

  async recover(ref: TurnRef): Promise<void> {
    await this.status(ref);
    const result = await this.control.query(ref);
    if (result.nativeTurnId) await this.bindNative(ref, result.nativeTurnId);
    if (['completed', 'interrupted', 'failed'].includes(result.status)) {
      await this.complete(ref, result.status as 'completed' | 'interrupted' | 'failed');
    }
  }

  async interrupt(ref: TurnRef, interruptId: string): Promise<FenceReceipt> {
    this.stopPlayback(ref.turnEpoch);
    const receipt = await this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (!interruptId) throw new Error('Interrupt identity required');
      if (!turn.interruptIds.includes(interruptId)) turn.interruptIds.push(interruptId);
      if (turn.fence) return turn.fence;
      const sequence = ++state.sequence;
      turn.fence = { eventId: `fence:${sequence}`, sequence, turnEpoch: turn.turnEpoch,
        submitKey: turn.submitKey, coverage: Object.keys(state.enabledClasses).sort() };
      if (turn.phase === 'committed') { turn.phase = 'interrupted'; turn.terminal = 'cancelled-before-start'; }
      else if (!isTerminal(turn)) turn.phase = 'cancelling';
      return turn.fence;
    });
    // Fence acceptance never waits for an RPC. Recovery replays only this idempotent Stop.
    void this.flushInterrupt(ref).catch(() => undefined);
    return receipt;
  }

  async complete(ref: TurnRef, outcome: 'completed' | 'interrupted' | 'failed'): Promise<void> {
    await this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (isTerminal(turn)) return;
      turn.phase = outcome;
      turn.terminal = outcome;
      for (const tool of Object.values(turn.tools)) {
        tool.result ??= { callId: tool.call.callId, effectId: tool.call.effectId,
          outcome: 'completion-pending', evidence: 'Runtime terminal; tool outcome remains unresolved' };
      }
    });
  }

  async disconnect(scope: Scope): Promise<void> {
    const refs = await this.journal.transact(state => {
      assertScope(state, scope);
      state.connected = false;
      return Object.values(state.turns).filter(t => !isTerminal(t))
        .map(t => ({ scope: t.scope, turnEpoch: t.turnEpoch, submitKey: t.submitKey }));
    });
    for (const ref of refs) await this.interrupt(ref, `disconnect:${ref.submitKey}`);
  }

  async reconnect(scope: Scope, connectionEpoch: number): Promise<void> {
    await this.journal.transact(state => {
      assertScope(state, scope);
      if (!Number.isSafeInteger(connectionEpoch) || connectionEpoch <= state.connectionEpoch) throw new Error('Stale connection epoch');
      state.connectionEpoch = connectionEpoch;
      state.connected = true; // No capture/microphone operation is implied.
    });
  }
}
