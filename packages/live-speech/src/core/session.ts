import { InterruptAuthority } from './interrupt.js';

export interface Scope {
  speechSessionId: string; tenantId: string; principalId: string; targetSessionId: string;
  sourceGeneration: string; controllerEpoch: number; consentRevision: string;
}
export interface TurnRef { scope: Scope; turnEpoch: number; submitKey: string }
export type ToolOutcome = 'cancelled-before-start' | 'cancelled' | 'completed-before-cancel' | 'completion-pending' | 'unknown';
export type EffectStatus = ToolOutcome | 'unknown-accepted';
export interface ToolResult { callId: string; effectId?: string; outcome: ToolOutcome; evidence: string }
export interface ToolCall {
  callId: string; actionId: string; toolClass: string; toolName: string; argumentsDigest: string;
  effectId?: string; operation?: string; proof?: unknown;
}
export interface FenceReceipt {
  eventId: string; sequence: number; turnEpoch: number; submitKey: string; coverage: string[];
}
export interface Turn extends TurnRef {
  utteranceId: string; inputRef: string; nativeTurnId?: string;
  phase: 'committed' | 'starting' | 'running' | 'cancelling' | 'completed' | 'interrupted' | 'failed';
  terminal?: string; fence?: FenceReceipt; interruptIds: string[];
  tools: Record<string, { call: Omit<ToolCall, 'proof'>; admissionSequence: number; result?: ToolResult }>;
}
export interface Effect {
  effectId: string; turnEpoch: number; callId: string; operation: string; status: EffectStatus;
  evidence: { status: ToolOutcome; evidence: string; timestamp: number }[];
}
export interface RiskPrompt {
  scope: Scope; barrierRevision: number; effectIds: string[]; confirmation: string;
  displayed: { effectId: string; operation: string; lastEvidence: string; uncertainty: string }[];
}
export interface RiskRequest extends RiskPrompt { requestId: string; proof: unknown }
export interface RiskAcceptance extends RiskPrompt { requestId: string; principalId: string; timestamp: number }
export interface SessionState {
  schemaVersion: 1; scope: Scope; nextEpoch: number; sequence: number; barrierRevision: number;
  connected: boolean; connectionEpoch: number;
  enabledClasses: Record<string, 'read-only' | 'mutating' | 'unclassified'>; statusTools: string[];
  turns: Record<string, Turn>; utterances: Record<string, number>; effects: Record<string, Effect>;
  actions: Record<string, { turnEpoch: number; callId: string }>;
  authorizations: Record<string, string>;
  riskAcceptances: Record<string, RiskAcceptance>;
}
/** Storage owns serialization, durability, rollback and isolation; callbacks must be synchronous. */
export interface Journal { transact<T>(change: (draft: SessionState) => T): Promise<T> }
/** This port never exposes or modifies opaque provider history. */
export interface ControlPort {
  start(turn: TurnRef & { inputRef: string }): Promise<{ nativeTurnId: string }>;
  interrupt(turn: TurnRef & { nativeTurnId?: string }): Promise<void>;
  query(turn: TurnRef): Promise<{ status: 'unknown' | 'running' | 'completed' | 'interrupted' | 'failed'; nativeTurnId?: string }>;
}
export interface MutationRequest {
  scope: Scope; turnEpoch: number; submitKey: string; toolClass: string; toolName: string;
  actionId: string; argumentsDigest: string; proof: unknown;
}
export interface TrustedAuthority {
  verifyRisk(request: RiskRequest): Promise<{ principalId: string; tenantId: string; method: 'typed' }>;
  verifyMutation(request: MutationRequest): Promise<MutationRequest & {
    authorizationId: string; principalId: string; tenantId: string;
  }>;
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const validIdentity = (id: string): boolean => typeof id === 'string' && id.length > 0 && id.length <= 512
  && !['__proto__', 'constructor', 'prototype'].includes(id);
export const assertScope = (state: SessionState, scope: Scope): void => {
  if (!same(state.scope, scope)) throw new Error('Stale or unauthorized scope');
};
export const getTurn = (state: SessionState, ref: TurnRef): Turn => {
  assertScope(state, ref.scope);
  const turn = state.turns[ref.turnEpoch];
  if (!turn || turn.submitKey !== ref.submitKey) throw new Error('Unknown turn identity');
  return turn;
};
export const isTerminal = (turn: Turn): boolean => ['completed', 'interrupted', 'failed'].includes(turn.phase);
export const createSession = (scope: Scope, enabledClasses: SessionState['enabledClasses'],
  interceptedClasses: string[], statusTools: string[]): SessionState => {
  if (!Object.values(scope).every(v => typeof v === 'number' ? Number.isSafeInteger(v) && v > 0 : Boolean(v))
    || Object.keys(enabledClasses).some(c => !interceptedClasses.includes(c))) throw new Error('Invalid scope or fence coverage');
  return { schemaVersion: 1, scope: structuredClone(scope), nextEpoch: 1, sequence: 0, barrierRevision: 0,
    connected: true, connectionEpoch: 1, enabledClasses: { ...enabledClasses }, statusTools: [...statusTools],
    turns: {}, utterances: {}, effects: {}, actions: {}, authorizations: {}, riskAcceptances: {} };
};

export class SpeechCoordinator extends InterruptAuthority {
  async commit(input: { scope: Scope; utteranceId: string; inputRef: string }): Promise<TurnRef> {
    return this.journal.transact(state => {
      assertScope(state, input.scope);
      if (!validIdentity(input.utteranceId)) throw new Error('Invalid utterance identity');
      const existing = state.turns[state.utterances[input.utteranceId]];
      if (existing) {
        if (existing.inputRef !== input.inputRef) throw new Error('Immutable final reference conflict');
        return { scope: existing.scope, turnEpoch: existing.turnEpoch, submitKey: existing.submitKey };
      }
      if (!state.connected) throw new Error('Disconnected session');
      if (Object.values(state.turns).some(t => !isTerminal(t))) throw new Error('Previous turn needs terminal acknowledgement');
      if (!input.utteranceId || !input.inputRef) throw new Error('Final input reference required');
      const turnEpoch = state.nextEpoch++;
      const ref = { scope: state.scope, turnEpoch, submitKey: `${state.scope.speechSessionId}:${state.scope.sourceGeneration}:${state.scope.controllerEpoch}:${turnEpoch}` };
      state.turns[turnEpoch] = { ...ref, utteranceId: input.utteranceId, inputRef: input.inputRef,
        phase: 'committed', interruptIds: [], tools: {} };
      state.utterances[input.utteranceId] = turnEpoch;
      return ref;
    });
  }
}
