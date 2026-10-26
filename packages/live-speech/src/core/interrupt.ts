import { assertScope, getTurn, isTerminal, isValidScope, same, validIdentity } from './session.js';
import type { ControlPort, FenceReceipt, Journal, RiskAcceptance, RiskPrompt, RiskRequest, Scope,
  SessionState, ToolCall, ToolOutcome, ToolResult, TrustedAuthority, Turn, TurnRef } from './session.js';

const installFence = (state: SessionState, turn: Turn, interruptId: string, now: number): FenceReceipt => {
  if (turn.fence) return turn.fence;
  turn.interruptIds.push(interruptId);
  const sequence = ++state.sequence;
  if (!isTerminal(turn)) state.barrierRevision++;
  turn.fence = { eventId: `fence:${sequence}`, sequence, turnEpoch: turn.turnEpoch,
    submitKey: turn.submitKey, coverage: Object.keys(state.enabledClasses).sort(), installedAtMs: now };
  if (turn.phase === 'committed') { turn.phase = 'interrupted'; turn.terminal = 'cancelled-before-start'; }
  else if (!isTerminal(turn)) turn.phase = 'cancelling';
  return turn.fence;
};

const unresolved = (state: SessionState) => Object.values(state.effects)
  .filter(e => (e.status === 'unknown' || e.status === 'completion-pending')
    && (state.turns[e.turnEpoch].fence || isTerminal(state.turns[e.turnEpoch])));

const promptFor = (state: SessionState, effectIds: string[]): RiskPrompt => {
  const ids = [...effectIds].sort();
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Selected effect IDs required');
  const pending = unresolved(state);
  const displayed = ids.map(effectId => {
    const effect = pending.find(e => e.effectId === effectId);
    if (!effect) throw new Error('Effect is not awaiting risk confirmation');
    return { effectId, operation: effect.operation, lastEvidence: effect.evidence.at(-1)?.evidence ?? 'No terminal evidence',
      uncertainty: 'The original operation or descendants may still complete; no rollback or replay is authorized.' };
  });
  return { scope: state.scope, barrierRevision: state.barrierRevision, effectIds: ids, displayed,
    confirmation: `Accept unresolved effects: ${ids.join(', ')}` };
};

export class InterruptAuthority {
  constructor(protected readonly journal: Journal, protected readonly control: ControlPort,
    protected readonly authority: TrustedAuthority, private readonly stopPlayback: (turnEpoch: number) => void,
    protected readonly now: () => number) {}

  async status(ref: TurnRef) { return this.journal.transact(state => getTurn(state, ref)); }

  async interruptStatus(ref: TurnRef) {
    return this.journal.transact(state => {
      const turn = getTurn(state, ref);
      const status = isTerminal(turn) ? turn.phase === 'completed' ? 'completed' : 'stopped'
        : !turn.fence ? 'active' : this.now() - turn.fence.installedAtMs >= 2000 ? 'pending' : 'stopping';
      return { state: status, fence: turn.fence,
        effectsPending: unresolved(state).map(e => e.effectId) };
    });
  }

  async riskPrompt(effectIds: string[]): Promise<RiskPrompt> {
    return this.journal.transact(state => promptFor(state, effectIds));
  }

  async acceptRisk(request: RiskRequest): Promise<RiskAcceptance> {
    const { proof, ...body } = request;
    request = { ...structuredClone(body), proof };
    const actor = await this.authority.verifyRisk({ ...structuredClone(body), proof });
    if (actor.method !== 'typed') throw new Error('Authenticated typed confirmation required');
    return this.journal.transact(state => {
      assertScope(state, request.scope);
      if (actor.principalId !== state.scope.principalId || actor.tenantId !== state.scope.tenantId) throw new Error('Controlling principal required');
      const snapshot: RiskPrompt = { scope: request.scope, barrierRevision: request.barrierRevision,
        effectIds: request.effectIds, displayed: request.displayed, confirmation: request.confirmation };
      if (!validIdentity(request.requestId)) throw new Error('Invalid risk confirmation identity');
      const prior = state.riskAcceptances[request.requestId];
      if (prior) {
        const original: RiskPrompt = { scope: prior.scope, barrierRevision: prior.barrierRevision,
          effectIds: prior.effectIds, displayed: prior.displayed, confirmation: prior.confirmation };
        if (!same(snapshot, original)) throw new Error('Risk confirmation identity conflict');
        return prior;
      }
      if (request.barrierRevision !== state.barrierRevision) throw new Error('Stale barrier revision');
      if (!request.requestId || !same(snapshot, promptFor(state, request.effectIds))) throw new Error('Risk confirmation mismatch');
      const acceptance = { ...snapshot, requestId: request.requestId, principalId: actor.principalId, timestamp: this.now() };
      for (const id of request.effectIds) state.effects[id].status = 'unknown-accepted';
      state.barrierRevision++;
      state.riskAcceptances[request.requestId] = acceptance;
      return acceptance;
    });
  }

  async admitTool(ref: TurnRef, call: ToolCall): Promise<{ admitted: boolean; admissionSequence: number; result?: ToolResult }> {
    ref = structuredClone(ref);
    call = { ...call };
    if (![call.callId, call.actionId, call.toolClass].every(validIdentity)
      || (call.effectId !== undefined && !validIdentity(call.effectId))) throw new Error('Invalid tool identity');
    const preliminary = await this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (turn.fence || isTerminal(turn) || !state.connected) throw new Error('Turn fenced');
      if (turn.phase !== 'starting' && turn.phase !== 'running') throw new Error('Turn not submitted');
      const classification = state.enabledClasses[call.toolClass];
      if (!Object.hasOwn(state.enabledClasses, call.toolClass) || !classification) throw new Error('Tool class lacks fence coverage');
      return { mutating: classification !== 'read-only', barrierRevision: state.barrierRevision };
    });
    const request = { ...ref, callId: call.callId, toolClass: call.toolClass, toolName: call.toolName,
      actionId: call.actionId, argumentsDigest: call.argumentsDigest,
      barrierRevision: preliminary.barrierRevision, proof: call.proof };
    const grant = preliminary.mutating ? await this.authority.verifyMutation({ ...request, scope: { ...request.scope } }) : undefined;
    return this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (turn.fence || isTerminal(turn) || !state.connected) throw new Error('Turn fenced');
      const classification = state.enabledClasses[call.toolClass];
      const mutating = classification !== 'read-only';
      const normalized = { callId: call.callId, actionId: call.actionId, toolClass: call.toolClass,
        toolName: call.toolName, argumentsDigest: call.argumentsDigest,
        ...(mutating ? { effectId: call.effectId, operation: call.operation } : {}) };
      const prior = state.actions[call.actionId];
      if (prior) {
        const existing = state.turns[prior.turnEpoch].tools[prior.callId];
        if (prior.turnEpoch !== ref.turnEpoch || !same(existing.call, normalized)) throw new Error('Action identity conflict or replay');
        return { admitted: false, admissionSequence: existing.admissionSequence, result: existing.result };
      }
      if (!call.callId || !call.actionId || !call.argumentsDigest || !call.toolName || turn.tools[call.callId]) {
        throw new Error('Invalid or duplicate call identity');
      }
      if (unresolved(state).length && (mutating || !state.statusTools.includes(call.toolName))) throw new Error('Unresolved effect barrier');
      if (mutating) {
        if (!grant || grant.actionId !== call.actionId || grant.argumentsDigest !== call.argumentsDigest
          || !same(grant.scope, state.scope) || grant.principalId !== state.scope.principalId
          || grant.tenantId !== state.scope.tenantId || !validIdentity(grant.authorizationId)
          || grant.turnEpoch !== ref.turnEpoch || grant.submitKey !== ref.submitKey || grant.callId !== call.callId
          || grant.barrierRevision !== state.barrierRevision
          || grant.toolClass !== call.toolClass || grant.toolName !== call.toolName
          || state.authorizations[grant.authorizationId]) throw new Error('Fresh authorization required');
        if (!call.effectId || !call.operation || state.effects[call.effectId]) throw new Error('New effect identity required');
        state.effects[call.effectId] = { effectId: call.effectId, turnEpoch: ref.turnEpoch, callId: call.callId,
          operation: call.operation, status: 'completion-pending', evidence: [] };
        state.authorizations[grant.authorizationId] = call.actionId;
      }
      state.actions[call.actionId] = { turnEpoch: ref.turnEpoch, callId: call.callId };
      const admissionSequence = ++state.sequence;
      turn.tools[call.callId] = { call: normalized, admissionSequence };
      return { admitted: true, admissionSequence };
    });
  }

  async toolResult(ref: TurnRef, callId: string): Promise<ToolResult | undefined> {
    return this.journal.transact(state => getTurn(state, ref).tools[callId]?.result);
  }

  /** Records a call emitted by the runtime but demonstrably never admitted by this authority. */
  async recordRejectedCall(ref: TurnRef, call: ToolCall, evidence: string): Promise<ToolResult> {
    if (![call.callId, call.actionId, call.toolClass].every(validIdentity) || !evidence) throw new Error('Invalid call identity');
    return this.journal.transact(state => {
      const turn = getTurn(state, ref);
      const existing = turn.tools[call.callId];
      if (existing) {
        if (existing.call.actionId !== call.actionId || existing.admissionSequence !== 0 || !existing.result) throw new Error('Call already admitted');
        return existing.result;
      }
      if (state.actions[call.actionId]) throw new Error('Action already admitted');
      const result: ToolResult = { callId: call.callId, outcome: 'cancelled-before-start', evidence };
      turn.tools[call.callId] = { call: { callId: call.callId, actionId: call.actionId, toolClass: call.toolClass,
        toolName: call.toolName, argumentsDigest: call.argumentsDigest }, admissionSequence: 0, result };
      state.actions[call.actionId] = { turnEpoch: ref.turnEpoch, callId: call.callId };
      return result;
    });
  }

  /** Native history owner consumes this one paired result; later facts belong to the journal. */
  async resolveTool(ref: TurnRef, callId: string, outcome: ToolOutcome, evidence: string): Promise<void> {
    const effectId = await this.journal.transact(state => {
      const tool = getTurn(state, ref).tools[callId];
      if (!tool || !evidence || !['cancelled-before-start', 'cancelled', 'completed-before-cancel', 'completion-pending', 'unknown'].includes(outcome)) {
        throw new Error('Invalid tool outcome');
      }
      if (!tool.call.effectId) tool.result ??= { callId, outcome, evidence };
      return tool.call.effectId;
    });
    if (effectId) await this.resolveEffect(effectId, outcome, evidence);
  }

  async resolveEffect(effectId: string, outcome: ToolOutcome, evidence: string): Promise<void> {
    await this.journal.transact(state => {
      const effect = state.effects[effectId];
      if (!effect || !evidence || !['cancelled-before-start', 'cancelled', 'completed-before-cancel', 'completion-pending', 'unknown'].includes(outcome)) {
        throw new Error('Invalid effect outcome');
      }
      if (effect.evidence.some(e => e.status === outcome && e.evidence === evidence)) return;
      const wasUnresolved = unresolved(state).some(e => e.effectId === effectId);
      effect.evidence.push({ status: outcome, evidence, timestamp: this.now() });
      if (['unknown', 'completion-pending'].includes(effect.status)
        || (effect.status === 'unknown-accepted' && !['unknown', 'completion-pending'].includes(outcome))) effect.status = outcome;
      const tool = state.turns[effect.turnEpoch].tools[effect.callId];
      tool.result ??= { callId: effect.callId, effectId, outcome, evidence };
      if (wasUnresolved || unresolved(state).some(e => e.effectId === effectId)) state.barrierRevision++;
    });
  }

  async send(ref: TurnRef): Promise<boolean> {
    ref = structuredClone(ref);
    const input = await this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (turn.fence || turn.phase !== 'committed' || !state.connected) return undefined;
      if (Object.values(state.turns).some(t => t.turnEpoch < turn.turnEpoch && !isTerminal(t) && !t.fence)) return undefined;
      turn.phase = 'starting'; // Durable before the single native submission attempt.
      return { ...ref, inputRef: turn.inputRef };
    });
    if (!input) return false;
    try {
      const result = await this.control.start(input);
      await this.bindNative(ref, result.nativeTurnId);
    } catch (error) {
      await this.interrupt(ref, `uncertain-start:${ref.submitKey}`);
      throw error;
    }
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
    if (turn.fence && turn.nativeTurnId && !isTerminal(turn)) await this.control.interrupt({ ...ref, nativeTurnId: turn.nativeTurnId });
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
    ref = structuredClone(ref);
    this.stopPlayback(ref.turnEpoch);
    const receipt = await this.journal.transact(state => {
      const turn = getTurn(state, ref);
      if (!interruptId) throw new Error('Interrupt identity required');
      return installFence(state, turn, interruptId, this.now());
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
      if (!turn.fence && Object.values(state.effects).some(e => e.turnEpoch === turn.turnEpoch
        && ['unknown', 'completion-pending'].includes(e.status))) state.barrierRevision++;
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

  /** Trusted host authority rotates generations in the same durable journal, never an empty session. */
  async rotateGeneration(expected: Scope, next: Scope): Promise<void> {
    expected = structuredClone(expected);
    next = structuredClone(next);
    const previous = await this.journal.transact(state => {
      assertScope(state, expected);
      if (!isValidScope(next) || next.controllerEpoch <= expected.controllerEpoch
        || !same(expected, { ...next, sourceGeneration: expected.sourceGeneration,
          controllerEpoch: expected.controllerEpoch, consentRevision: expected.consentRevision })) {
        throw new Error('Invalid generation rotation');
      }
      const turns = Object.values(state.turns).filter(t => !isTerminal(t));
      for (const turn of turns) {
        if (turn.phase === 'committed' && !turn.fence) turn.scope = next;
        else installFence(state, turn, `rotation:${next.controllerEpoch}`, this.now());
      }
      state.scope = next;
      state.barrierRevision++;
      state.connectionEpoch++;
      state.connected = true;
      return turns.filter(t => t.fence);
    });
    for (const turn of previous) {
      this.stopPlayback(turn.turnEpoch);
      void this.flushInterrupt(turn).catch(() => undefined);
    }
  }
}
