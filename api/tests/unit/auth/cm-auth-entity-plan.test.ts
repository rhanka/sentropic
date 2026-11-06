import { describe, expect, it } from 'vitest';
import { createCmAuthEntityPlan, plannedCmAuthWorkspaceId, withCmAuthEntityPlan } from '../../../src/services/identity/cm-auth-entity-plan';
import { expectCustodyCode } from '../../utils/cm-custody-assertions';

describe('A4 prospective auth entity planning', () => {
  it('should preserve only opaque entity hints across retry attempts and isolate different operations', async () => {
    const plan = createCmAuthEntityPlan(), first = plan.attemptUuid(), retry = plan.attemptUuid();
    const accountId = first(), sessionId = first();
    expect(retry()).toBe(accountId);
    expect(retry()).toBe(sessionId);
    expect(accountId).not.toBe(sessionId);
    expect(createCmAuthEntityPlan().workspaceId).not.toBe(plan.workspaceId);
    await expectCustodyCode(() => plannedCmAuthWorkspaceId(), 'identity_transaction_unbound');
  });

  it('should retain the correct workspace hint across interleaved asynchronous attempts', async () => {
    const first = createCmAuthEntityPlan(), second = createCmAuthEntityPlan();
    const resolved = await Promise.all([first, second].map(plan => withCmAuthEntityPlan(plan, async () => {
      await Promise.resolve();
      return plannedCmAuthWorkspaceId();
    })));
    expect(resolved).toEqual([first.workspaceId, second.workspaceId]);
  });
});
