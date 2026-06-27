/**
 * Slice 2 — elicitation state-machine probes (§5.1, §5.2, §11).
 *
 * Covers: forward resume releases the gate; cancel/timeout/denied terminals
 * deny; NHI fail-closed; anti-phishing initiator.sub == completer.sub.
 */
import { describe, expect, it } from 'vitest';
import { ElicitationManager, type Completer, type CreateInput } from '../src/elicitation.js';

const baseInput = (over: Partial<CreateInput> = {}): CreateInput => ({
  id: over.id ?? 'el-1',
  mode: over.mode ?? 'confirm',
  sessionRef: 'sess-1',
  capabilityRef: 'create_widget',
  actor: over.actor ?? { sub: 'user-1', client: 'claude.ai' },
  ttlSeconds: over.ttlSeconds ?? 300,
  auditId: 'audit-1',
  now: over.now,
  ...over,
});

const human = (sub: string): Completer => ({ sub, isHuman: true });

function driveToResumed(m: ElicitationManager, id: string, completer: Completer): void {
  m.render(id);
  m.answer(id, completer);
  m.validate(id);
  m.resume(id);
}

describe('ElicitationManager — fail-closed state machine', () => {
  it('only resume releases the gate (full forward path)', () => {
    const m = new ElicitationManager();
    m.create(baseInput());
    expect(m.isGateReleased('el-1')).toBe(false);
    driveToResumed(m, 'el-1', human('user-1'));
    expect(m.get('el-1')?.state).toBe('resumed');
    expect(m.isGateReleased('el-1')).toBe(true);
  });

  it('cancel is a terminal that denies the gate and is absorbing', () => {
    const m = new ElicitationManager();
    m.create(baseInput());
    m.render('el-1');
    m.cancel('el-1');
    expect(m.get('el-1')?.state).toBe('cancelled');
    // absorbing: cannot be advanced or resumed afterwards
    m.advance('el-1');
    m.resume('el-1');
    expect(m.get('el-1')?.state).toBe('cancelled');
    expect(m.isGateReleased('el-1')).toBe(false);
  });

  it('times out fail-closed once the TTL elapses', () => {
    const m = new ElicitationManager();
    m.create(baseInput({ ttlSeconds: 10, now: 0 }));
    m.render('el-1');
    m.tick('el-1', 5_000); // within TTL
    expect(m.get('el-1')?.state).toBe('rendered');
    m.tick('el-1', 11_000); // past TTL
    expect(m.get('el-1')?.state).toBe('timed_out');
    expect(m.isGateReleased('el-1')).toBe(false);
  });

  it('explicit deny is terminal and never releases the gate', () => {
    const m = new ElicitationManager();
    m.create(baseInput());
    m.render('el-1');
    m.deny('el-1');
    expect(m.get('el-1')?.state).toBe('denied');
    expect(m.isGateReleased('el-1')).toBe(false);
  });

  it('NHI fail-closed: an agent cannot auto-satisfy a human-targeted elicitation', () => {
    const m = new ElicitationManager();
    m.create(baseInput({ id: 'el-nhi', mode: 'consent' }));
    m.render('el-nhi');
    const agent: Completer = { sub: 'user-1', isHuman: false }; // no delegating human
    m.answer('el-nhi', agent);
    expect(m.get('el-nhi')?.state).toBe('denied');
    expect(m.isGateReleased('el-nhi')).toBe(false);
  });

  it('NHI routed to a delegating human is accepted', () => {
    const m = new ElicitationManager();
    m.create(baseInput({ id: 'el-deleg', mode: 'consent' }));
    m.render('el-deleg');
    const delegated: Completer = { sub: 'user-1', isHuman: false, delegatingHumanSub: 'human-7' };
    m.answer('el-deleg', delegated);
    expect(m.get('el-deleg')?.state).toBe('answered');
  });

  it('anti-phishing: a completer sub mismatch denies a sensitive elicitation', () => {
    const m = new ElicitationManager();
    m.create(baseInput({ id: 'el-url', mode: 'url', actor: { sub: 'user-1', client: 'claude.ai' } }));
    m.render('el-url');
    m.answer('el-url', human('attacker-9')); // initiator user-1 != completer attacker-9
    expect(m.get('el-url')?.state).toBe('denied');
  });

  it('anti-phishing: matching subs proceed for a sensitive elicitation', () => {
    const m = new ElicitationManager();
    m.create(baseInput({ id: 'el-cred', mode: 'credential', actor: { sub: 'user-1' } }));
    driveToResumed(m, 'el-cred', human('user-1'));
    expect(m.isGateReleased('el-cred')).toBe(true);
  });
});
