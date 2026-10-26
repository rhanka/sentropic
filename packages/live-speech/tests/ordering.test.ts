import { describe, expect, it, vi } from 'vitest';
import { commit, fixture, mutation, scope, TestJournal } from './fixtures.js';
import { createSession, SessionJournal } from '../src/core/session.js';
import type { JournalSnapshot } from '../src/core/session.js';

describe('submission, tool history and effect barrier', () => {
  it('should reject malformed historical turn references instead of inherited record entries', async () => {
    const f = fixture();
    await expect(f.core.status({ turnEpoch: '__proto__' } as never)).rejects.toThrow('identity');
    const turn = await commit(f.core);
    await expect(f.core.status({ ...turn, scope: undefined } as never)).rejects.toThrow('scope');
  });

  it('should retain new call approvals while accepted old effects receive terminal evidence', async () => {
    const f = fixture();
    const old = await commit(f.core);
    await f.core.send(old);
    await f.core.admitTool(old, mutation('old'));
    await f.core.interrupt(old, 'stop');
    const prompt = await f.core.riskPrompt(['effect:old']);
    await f.core.acceptRisk({ ...prompt, requestId: 'accept-old', proof: 'proof' });
    const next = await commit(f.core, 'next');
    await f.core.send(next);
    let release!: () => void;
    const waiting = new Promise<void>(r => { release = r; });
    vi.mocked(f.authority.verifyMutation).mockClear().mockImplementation(async request => {
      await waiting;
      return { ...request, authorizationId: `auth:${request.callId}`,
        principalId: scope.principalId, tenantId: scope.tenantId };
    });
    const a = f.core.admitTool(next, mutation('a'));
    const b = f.core.admitTool(next, mutation('b'));
    await vi.waitFor(() => expect(f.authority.verifyMutation).toHaveBeenCalledTimes(2));
    await f.core.complete(old, 'interrupted');
    await f.core.resolveEffect('effect:old', 'completed-before-cancel', 'late receipt');
    release();
    expect(await a).toMatchObject({ admitted: true });
    expect(await b).toMatchObject({ admitted: true });
  });

  it('should preserve a new call approval when Stop arrives for an already completed old turn', async () => {
    const f = fixture();
    const old = await commit(f.core);
    await f.core.send(old);
    await f.core.complete(old, 'completed');
    const next = await commit(f.core, 'next');
    await f.core.send(next);
    let release!: () => void;
    const waiting = new Promise<void>(r => { release = r; });
    vi.mocked(f.authority.verifyMutation).mockImplementationOnce(async request => {
      await waiting;
      return { ...request, authorizationId: 'new-call', principalId: scope.principalId, tenantId: scope.tenantId };
    });
    const admitting = f.core.admitTool(next, mutation());
    await vi.waitFor(() => expect(f.authority.verifyMutation).toHaveBeenCalledOnce());
    await f.core.interrupt(old, 'late-stop');
    release();
    expect(await admitting).toMatchObject({ admitted: true });
  });

  it('should admit separately approved parallel calls when a sibling resolves during approval', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    let release!: () => void;
    const waiting = new Promise<void>(r => { release = r; });
    vi.mocked(f.authority.verifyMutation).mockImplementation(async request => {
      if (request.callId === 'b') await waiting;
      return { ...request, authorizationId: `auth:${request.callId}`,
        principalId: scope.principalId, tenantId: scope.tenantId };
    });
    const a = f.core.admitTool(turn, mutation('a'));
    const b = f.core.admitTool(turn, mutation('b'));
    expect(await a).toMatchObject({ admitted: true });
    await f.core.resolveTool(turn, 'a', 'completed-before-cancel', 'receipt:a');
    release();
    expect(await b).toMatchObject({ admitted: true });
    expect(f.authority.verifyMutation).toHaveBeenCalledWith(expect.objectContaining({ turnEpoch: turn.turnEpoch, callId: 'b' }));
  });

  it('should revoke an in-flight call approval when Stop installs a fence', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    let release!: () => void;
    const waiting = new Promise<void>(r => { release = r; });
    vi.mocked(f.authority.verifyMutation).mockImplementationOnce(async request => {
      await waiting;
      return { ...request, authorizationId: 'pending', principalId: scope.principalId, tenantId: scope.tenantId };
    });
    const admitting = f.core.admitTool(turn, mutation());
    await vi.waitFor(() => expect(f.authority.verifyMutation).toHaveBeenCalledOnce());
    await f.core.interrupt(turn, 'stop');
    release();
    await expect(admitting).rejects.toThrow('fenced');
    expect(Object.keys(f.journal.state.effects)).toHaveLength(0);
  });

  it('should carry effect barriers, fences and consumed approvals into a new controller generation', async () => {
    let bytes: string | undefined;
    const storage = {
      read: async () => bytes ? JSON.parse(bytes) as JournalSnapshot : undefined,
      compareAndSwap: async (_key: string, expected: number | undefined, next: JournalSnapshot) => {
        if ((bytes ? (JSON.parse(bytes) as JournalSnapshot).revision : undefined) !== expected) return false;
        bytes = JSON.stringify(next);
        return true;
      },
    };
    const seed = new TestJournal().state;
    const f = fixture(new SessionJournal(storage, 'session', seed));
    const stale = new SessionJournal(storage, 'session', seed);
    const old = await commit(f.core);
    await f.core.send(old);
    await f.core.admitTool(old, mutation('a'));
    await f.core.interrupt(old, 'stop');
    const prior = await f.core.riskPrompt(['effect:a']);
    const queued = await commit(f.core, 'next');
    const nextScope = { ...scope, controllerEpoch: 2, sourceGeneration: 'source-2', consentRevision: 'consent-2' };
    await expect(f.core.rotateGeneration(scope, { ...nextScope, tenantId: 'other' })).rejects.toThrow('rotation');
    await f.core.rotateGeneration(scope, nextScope);
    await expect(stale.transact(s => s.scope)).rejects.toThrow('scope');
    await expect(f.core.rotateGeneration(scope, nextScope)).rejects.toThrow('scope');
    const restarted = fixture(new SessionJournal(storage, 'session', { ...seed, scope: nextScope }));
    await expect(restarted.core.acceptRisk({ ...prior, requestId: 'stale', proof: 'proof' })).rejects.toThrow('scope');
    const next = await restarted.core.commit({ scope: nextScope, utteranceId: 'next', inputRef: 'final:next' });
    expect(next).toEqual({ ...queued, scope: nextScope });
    await expect(restarted.core.send(queued)).rejects.toThrow('scope');
    await restarted.core.send(next);
    await expect(restarted.core.admitTool(next, mutation('b'))).rejects.toThrow('barrier');
    await expect(restarted.core.admitTool(old, mutation('late'))).rejects.toThrow('fenced');
    expect(await restarted.core.send(old)).toBe(false);
    vi.mocked(restarted.control.query).mockResolvedValueOnce({ status: 'unknown', nativeTurnId: 'native-1' });
    await restarted.core.recover(old);
    expect(restarted.control.interrupt).toHaveBeenCalledWith({ ...old, nativeTurnId: 'native-1' });
    const prompt = await restarted.core.riskPrompt(['effect:a']);
    await restarted.core.acceptRisk({ ...prompt, requestId: 'accepted', proof: 'proof' });
    await expect(restarted.core.admitTool(next, mutation('a'))).rejects.toThrow('Action identity');
    vi.mocked(restarted.authority.verifyMutation).mockImplementationOnce(async request => ({ ...request,
      authorizationId: 'auth:action:a', principalId: scope.principalId, tenantId: scope.tenantId }));
    await expect(restarted.core.admitTool(next, mutation('b'))).rejects.toThrow('authorization');
    await restarted.core.admitTool(next, mutation('b'));
    expect((await storage.read())?.state.authorizations['auth:action:a']).toBe('action:a');
  });

  it('should bind risk verification to an immutable request while authentication awaits', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    await f.core.admitTool(turn, mutation('a'));
    await f.core.admitTool(turn, mutation('b'));
    await f.core.interrupt(turn, 'stop');
    const a = await f.core.riskPrompt(['effect:a']);
    const b = await f.core.riskPrompt(['effect:b']);
    let release!: () => void;
    const wait = new Promise<void>(r => { release = r; });
    vi.mocked(f.authority.verifyRisk).mockImplementationOnce(async request => {
      await wait;
      expect(request.effectIds).toEqual(['effect:a']);
      return { principalId: scope.principalId, tenantId: scope.tenantId, method: 'typed' };
    });
    const request = { ...a, requestId: 'immutable', proof: 'proof' };
    const accepting = f.core.acceptRisk(request);
    Object.assign(request, b);
    release();
    await accepting;
    expect(f.journal.state.effects['effect:a'].status).toBe('unknown-accepted');
    expect(f.journal.state.effects['effect:b'].status).toBe('completion-pending');
  });
  it('should atomically commit storage revisions and restore tombstones from persisted bytes', async () => {
    let bytes: string | undefined;
    const storage = {
      read: async () => bytes ? JSON.parse(bytes) as JournalSnapshot : undefined,
      compareAndSwap: vi.fn(async (_key: string, expected: number | undefined, next: JournalSnapshot) => {
        const current = bytes ? JSON.parse(bytes) as JournalSnapshot : undefined;
        if (current?.revision !== expected) return false;
        bytes = JSON.stringify(next);
        return true;
      }),
    };
    const seed = createSession(scope, { read: 'read-only' }, ['read'], ['status']);
    const journal = new SessionJournal(storage, 'trusted-storage-key', seed);
    const f = fixture(journal);
    const turn = await commit(f.core);
    await f.core.interrupt(turn, 'stop');
    const restarted = fixture(new SessionJournal(storage, 'trusted-storage-key', seed));
    expect(await restarted.core.send(turn)).toBe(false);
    await expect(journal.transact(state => { state.nextEpoch = 999; throw new Error('rollback'); }))
      .rejects.toThrow('rollback');
    expect((await storage.read())?.state.nextEpoch).toBe(2);
    const calls = storage.compareAndSwap.mock.calls.length;
    storage.compareAndSwap.mockResolvedValueOnce(false);
    expect(await journal.transact(state => ++state.sequence)).toBe(2);
    expect(storage.compareAndSwap.mock.calls.length).toBe(calls + 2);
    expect((await storage.read())?.revision).toBeGreaterThan(1);
  });
  it('should keep typed acceptance idempotent across restart and append late outcomes only once', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    await f.core.admitTool(turn, mutation());
    await f.core.interrupt(turn, 'stop');
    await f.core.complete(turn, 'interrupted');
    const pending = await f.core.toolResult(turn, 'call-1');
    const prompt = await f.core.riskPrompt(['effect:call-1']);
    const request = { ...prompt, requestId: 'typed-1', proof: 'proof' };
    const acceptance = await f.core.acceptRisk(request);
    const restarted = fixture(f.journal.restart());
    expect(await restarted.core.acceptRisk(request)).toEqual(acceptance);
    await restarted.core.resolveEffect('effect:call-1', 'completed-before-cancel', 'receipt');
    await restarted.core.resolveEffect('effect:call-1', 'completed-before-cancel', 'receipt');
    expect(await restarted.core.toolResult(turn, 'call-1')).toEqual(pending);
    expect(restarted.journal.state.effects['effect:call-1'].evidence).toHaveLength(1);
    expect(restarted.control.start).not.toHaveBeenCalled();
  });
  it('should return a distinct non-dispatching receipt for duplicate admissions', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    expect(await f.core.admitTool(turn, mutation())).toMatchObject({ admitted: true });
    expect(await f.core.admitTool(turn, mutation())).toMatchObject({ admitted: false });
    const receipt = await f.core.interrupt(turn, 'stop');
    expect(f.journal.state.turns[turn.turnEpoch].tools['call-1'].admissionSequence).toBeLessThan(receipt.sequence);
  });

  it('should reject a reused approval and bind fresh approval to exact tool arguments', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    await f.core.admitTool(turn, mutation('a'));
    vi.mocked(f.authority.verifyMutation).mockImplementationOnce(async request => ({ ...request,
      authorizationId: 'auth:action:a', principalId: scope.principalId, tenantId: scope.tenantId }));
    await expect(f.core.admitTool(turn, mutation('b'))).rejects.toThrow('authorization');
    vi.mocked(f.authority.verifyMutation).mockImplementationOnce(async request => ({ ...request,
      argumentsDigest: 'other-arguments', authorizationId: 'fresh', principalId: scope.principalId, tenantId: scope.tenantId }));
    await expect(f.core.admitTool(turn, mutation('b'))).rejects.toThrow('authorization');
    vi.mocked(f.authority.verifyMutation).mockImplementationOnce(async request => ({ ...request,
      callId: 'a', authorizationId: 'wrong-call-approval', principalId: scope.principalId, tenantId: scope.tenantId }));
    await expect(f.core.admitTool(turn, mutation('b'))).rejects.toThrow('authorization');
  });

  it('should pair an emitted fenced call as cancelled-before-start without dispatch', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.interrupt(turn, 'stop');
    await expect(f.core.admitTool(turn, mutation())).rejects.toThrow('fenced');
    const result = await f.core.recordRejectedCall(turn, mutation(), 'Core gate denied admission');
    expect(result).toMatchObject({ callId: 'call-1', outcome: 'cancelled-before-start' });
    expect(await f.core.recordRejectedCall(turn, mutation(), 'Core gate denied admission')).toEqual(result);
    expect(await f.core.toolResult(turn, 'call-1')).toEqual(result);
    expect(Object.keys(f.journal.state.effects)).toHaveLength(0);
    expect(f.control.start).not.toHaveBeenCalled();
  });

  it('should reject reserved record keys and preserve isolation of returned references', async () => {
    const f = fixture();
    await expect(commit(f.core, '__proto__')).rejects.toThrow('identity');
    const turn = await commit(f.core);
    await f.core.send(turn);
    await expect(f.core.admitTool(turn, { ...mutation(), callId: 'constructor' })).rejects.toThrow('identity');
    turn.scope.tenantId = 'altered';
    expect(f.journal.state.scope.tenantId).toBe(scope.tenantId);
  });
  it('should commit one final once and reject stale or conflicting references', async () => {
    const { core } = fixture();
    const [a, b] = await Promise.all([commit(core), commit(core)]);
    expect(a).toEqual(b);
    await expect(core.commit({ scope, utteranceId: 'utterance-1', inputRef: 'different' })).rejects.toThrow('conflict');
    await expect(core.commit({ scope: { ...scope, controllerEpoch: 0 }, utteranceId: 'old', inputRef: 'final' }))
      .rejects.toThrow('scope');
  });

  it('should pair each admitted call once and append late evidence without replay', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    const tool = mutation();
    await f.core.admitTool(turn, tool);
    expect(await f.core.admitTool(turn, tool)).toMatchObject({ admitted: false });
    await f.core.interrupt(turn, 'stop');
    await f.core.resolveEffect(tool.effectId, 'unknown', 'lost status');
    const result = await f.core.toolResult(turn, tool.callId);
    expect(result?.outcome).toBe('unknown');
    await f.core.resolveEffect(tool.effectId, 'completed-before-cancel', 'remote receipt');
    expect(await f.core.toolResult(turn, tool.callId)).toEqual(result);
    expect(f.journal.state.effects[tool.effectId].evidence).toHaveLength(2);
    expect(f.control.start).toHaveBeenCalledOnce();
  });

  it('should keep uncertain effects across turns and release only the selected accepted subset', async () => {
    const f = fixture();
    const old = await commit(f.core);
    await f.core.send(old);
    for (const id of ['a', 'b']) await f.core.admitTool(old, mutation(id));
    await f.core.interrupt(old, 'stop');
    await f.core.complete(old, 'interrupted');
    const restarted = fixture(f.journal.restart());
    const next = await commit(restarted.core, 'next');
    await restarted.core.send(next);
    await expect(restarted.core.admitTool(next, mutation('c'))).rejects.toThrow('barrier');
    await restarted.core.admitTool(next, { ...mutation('status'), toolClass: 'read', toolName: 'status' });
    await expect(restarted.core.admitTool(next, { ...mutation('list'), toolClass: 'read', toolName: 'list' }))
      .rejects.toThrow('barrier');
    const prompt = await restarted.core.riskPrompt(['effect:a']);
    const request = { ...prompt, requestId: 'accept-a', proof: 'typed-user-proof' };
    await restarted.core.acceptRisk(request);
    expect(await restarted.core.acceptRisk(request)).toEqual(expect.objectContaining({ requestId: 'accept-a' }));
    await expect(restarted.core.admitTool(next, mutation('c'))).rejects.toThrow('barrier');
    const rest = await restarted.core.riskPrompt(['effect:b']);
    await restarted.core.acceptRisk({ ...rest, requestId: 'accept-b', proof: 'typed-user-proof' });
    vi.mocked(restarted.authority.verifyMutation).mockRejectedValueOnce(new Error('fresh authorization required'));
    await expect(restarted.core.admitTool(next, mutation('c'))).rejects.toThrow('fresh authorization');
    await expect(restarted.core.admitTool(next, mutation('a'))).rejects.toThrow('Action identity');
    await restarted.core.admitTool(next, mutation('c'));
    expect(restarted.journal.state.effects['effect:a'].status).toBe('unknown-accepted');
    await expect(restarted.core.admitTool(old, mutation('late'))).rejects.toThrow('fenced');
  });

  it('should reject stale, partial, speech and cross-tenant risk confirmations atomically', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    await f.core.send(turn);
    await f.core.admitTool(turn, mutation('a'));
    await f.core.admitTool(turn, mutation('b'));
    await f.core.interrupt(turn, 'stop');
    const prompt = await f.core.riskPrompt(['effect:a', 'effect:b']);
    const req = { ...prompt, requestId: 'accept', proof: 'proof' };
    await expect(f.core.acceptRisk({ ...req, displayed: prompt.displayed.slice(0, 1) })).rejects.toThrow('confirmation');
    await expect(f.core.acceptRisk({ ...req, confirmation: 'continue' })).rejects.toThrow('confirmation');
    vi.mocked(f.authority.verifyRisk).mockResolvedValueOnce({ principalId: 'intruder', tenantId: 'other', method: 'typed' });
    await expect(f.core.acceptRisk(req)).rejects.toThrow('principal');
    vi.mocked(f.authority.verifyRisk).mockResolvedValueOnce({ principalId: scope.principalId,
      tenantId: scope.tenantId, method: 'speech' } as never);
    await expect(f.core.acceptRisk(req)).rejects.toThrow('typed');
    await f.core.resolveEffect('effect:a', 'completed-before-cancel', 'status query');
    await expect(f.core.acceptRisk(req)).rejects.toThrow('Stale barrier revision');
    expect(f.journal.state.effects['effect:b'].status).toBe('completion-pending');
    expect(Object.keys(f.journal.state.riskAcceptances)).toHaveLength(0);
  });
});
