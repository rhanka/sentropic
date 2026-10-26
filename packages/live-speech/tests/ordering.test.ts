import { describe, expect, it, vi } from 'vitest';
import { commit, fixture, mutation, scope } from './fixtures.js';

describe('submission, tool history and effect barrier', () => {
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
    expect(await f.core.admitTool(turn, tool)).toEqual(await f.core.toolResult(turn, tool.callId));
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
    await expect(restarted.core.admitTool(next, mutation('a'))).rejects.toThrow('action');
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
    await expect(f.core.acceptRisk(req)).rejects.toThrow('stale');
    expect(f.journal.state.effects['effect:b'].status).toBe('completion-pending');
    expect(Object.keys(f.journal.state.riskAcceptances)).toHaveLength(0);
  });
});
