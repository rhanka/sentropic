/**
 * Slice 2 — elicitation state-machine probes (§5.1, §5.2, §11).
 *
 * Covers: forward resume releases the gate; cancel/timeout/denied terminals
 * deny; NHI fail-closed; anti-phishing initiator.sub == completer.sub.
 */
import { describe, expect, it } from 'vitest';
import {
  ElicitationManager,
  type Completer,
  type CreateInput,
  type DelegationResolver,
} from '../src/elicitation.js';

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

// Legitimate human completer — carries the same MCP client as the default actor
// ('claude.ai'), so the §5.2(a) client binding passes for an on-client completion.
const human = (sub: string, client = 'claude.ai'): Completer => ({ sub, isHuman: true, client });

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
    // Same client so the denial isolates the NHI rule (not the client binding).
    const agent: Completer = { sub: 'user-1', isHuman: false, client: 'claude.ai' };
    m.answer('el-nhi', agent);
    expect(m.get('el-nhi')?.state).toBe('denied');
    expect(m.isGateReleased('el-nhi')).toBe(false);
  });

  it('F4: a self-declared NHI delegation is NOT trusted (denied without a resolver)', () => {
    const m = new ElicitationManager(); // no delegation resolver injected
    m.create(baseInput({ id: 'el-deleg', mode: 'consent' }));
    m.render('el-deleg');
    // The agent forges a delegatingHumanSub; with no trusted resolver this is denied.
    const forged: Completer = { sub: 'user-1', isHuman: false, delegatingHumanSub: 'human-7', client: 'claude.ai' };
    m.answer('el-deleg', forged);
    expect(m.get('el-deleg')?.state).toBe('denied');
    expect(m.isGateReleased('el-deleg')).toBe(false);
  });

  it('F4: an NHI delegation INDEPENDENTLY confirmed by the trusted resolver is accepted', () => {
    // The NHI acts AS the principal sub (isHuman:false); consent is sub-match, so
    // completer.sub must equal the initiator sub. The delegating human is separate.
    const resolver: DelegationResolver = {
      confirmDelegation: ({ agentSub, humanSub }) => agentSub === 'user-1' && humanSub === 'human-7',
    };
    const m = new ElicitationManager({ delegationResolver: resolver });
    m.create(baseInput({ id: 'el-ok', mode: 'consent' }));
    m.render('el-ok');
    const delegated: Completer = { sub: 'user-1', isHuman: false, delegatingHumanSub: 'human-7', client: 'claude.ai' };
    m.answer('el-ok', delegated);
    expect(m.get('el-ok')?.state).toBe('answered');
  });

  it('F4: the trusted resolver rejecting a delegation denies (no self-grant)', () => {
    const resolver: DelegationResolver = { confirmDelegation: () => false };
    const m = new ElicitationManager({ delegationResolver: resolver });
    m.create(baseInput({ id: 'el-rej', mode: 'consent' }));
    m.render('el-rej');
    const claimed: Completer = { sub: 'user-1', isHuman: false, delegatingHumanSub: 'human-7', client: 'claude.ai' };
    m.answer('el-rej', claimed);
    expect(m.get('el-rej')?.state).toBe('denied');
  });

  it('F3: a completer from a different MCP client is denied (client binding §5.2 a)', () => {
    const m = new ElicitationManager();
    m.create(baseInput({ id: 'el-cli', mode: 'confirm', actor: { sub: 'user-1', client: 'claude.ai' } }));
    m.render('el-cli');
    // Same sub & human, but a FOREIGN client → denied by the client binding.
    m.answer('el-cli', { sub: 'user-1', isHuman: true, client: 'codex' });
    expect(m.get('el-cli')?.state).toBe('denied');
    expect(m.isGateReleased('el-cli')).toBe(false);
  });

  it('F5: advance() cannot bypass §5.2 to release a gate', () => {
    const m = new ElicitationManager();
    m.create(baseInput({ id: 'el-adv', mode: 'consent' }));
    m.advance('el-adv'); // only requested -> rendered is performed
    expect(m.get('el-adv')?.state).toBe('rendered');
    // Every later hop is refused: advance can never reach answered/validated/resumed.
    m.advance('el-adv');
    m.advance('el-adv');
    m.advance('el-adv');
    expect(m.get('el-adv')?.state).toBe('rendered');
    expect(m.isGateReleased('el-adv')).toBe(false);
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
