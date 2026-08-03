import { describe, expect, it } from 'vitest';

import { createCoworkGeneralBrokerFactory } from '../../src/services/cowork/general-broker-service';
import { decideFoundationAuthority, type HumanSelectedTarget, type ImmutableActionDescriptor } from '../../src/services/cowork/general-action-safety';

const target: HumanSelectedTarget = { deviceId: 'device-a', selectedAt: new Date(), source: 'human-controller', isolatedVmTarget: true, egressPolicyRef: 'egress-a' };
const descriptor = (actionClass: ImmutableActionDescriptor['actionClass']): ImmutableActionDescriptor => ({ id: 'action-a', version: '1', actionClass, argumentDigest: 'digest-a' });

describe('General Cowork foundation authority', () => {
  it('quarantines a model low-risk label so it cannot authorize a sensitive action', async () => {
    const factory = createCoworkGeneralBrokerFactory({ descriptorFor: () => descriptor('enter'), selectedTargetFor: () => target, nodeEnv: 'test' });
    const closure = await factory.open({ toolCallId: 'call-a', principalSub: 'user-a', tenantRef: 'tenant-a', workspaceRef: 'workspace-a', targetDeviceId: 'device-a', selectedBy: 'human-controller' });

    await expect(closure!.invoke({ riskLabel: 'low-risk', targetDeviceId: 'device-other', receipt: 'forged' }))
      .resolves.toEqual({ outcome: 'PAS-FAIT', reason: 'human_receipt_required' });
  });

  it('requires a human target, D5 receipt, signed PEP, and containment independently', () => {
    expect(decideFoundationAuthority({ descriptor: descriptor('unknown'), target: null, freshHumanReceiptId: 'r', signedPepDistributionVerified: true, nodeEnv: 'test' }))
      .toEqual({ outcome: 'PAS-FAIT', reason: 'human_target_required' });
    expect(decideFoundationAuthority({ descriptor: descriptor('enter'), target, freshHumanReceiptId: null, signedPepDistributionVerified: true, nodeEnv: 'test' }))
      .toEqual({ outcome: 'PAS-FAIT', reason: 'human_receipt_required' });
    expect(decideFoundationAuthority({ descriptor: descriptor('navigation'), target, freshHumanReceiptId: 'r', signedPepDistributionVerified: false, nodeEnv: 'test' }))
      .toEqual({ outcome: 'PAS-FAIT', reason: 'signed_pep_required' });
    expect(decideFoundationAuthority({ descriptor: descriptor('navigation'), target, freshHumanReceiptId: 'r', signedPepDistributionVerified: true, nodeEnv: 'production' }))
      .toEqual({ outcome: 'PAS-FAIT', reason: 'containment_required' });
  });

  it('keys C1 closures by trusted principal/tenant/workspace/toolCall and rejects conflicting reuse', async () => {
    const factory = createCoworkGeneralBrokerFactory({ descriptorFor: () => descriptor('navigation'), selectedTargetFor: () => target, nodeEnv: 'test' });
    const first = await factory.open({ toolCallId: 'same', principalSub: 'user-a', tenantRef: 'tenant-a', workspaceRef: 'workspace-a', targetDeviceId: 'device-a', selectedBy: 'human-controller' });
    const retry = await factory.open({ toolCallId: 'same', principalSub: 'user-a', tenantRef: 'tenant-a', workspaceRef: 'workspace-a', targetDeviceId: 'device-a', selectedBy: 'human-controller' });
    const conflict = await factory.open({ toolCallId: 'same', principalSub: 'user-a', tenantRef: 'tenant-a', workspaceRef: 'workspace-a', targetDeviceId: 'device-b', selectedBy: 'human-controller' });
    const sibling = await factory.open({ toolCallId: 'same', principalSub: 'user-a', tenantRef: 'tenant-b', workspaceRef: 'workspace-b', targetDeviceId: 'device-b', selectedBy: 'human-controller' });

    expect(retry).toBe(first);
    expect(conflict).toBeNull();
    expect(sibling).not.toBe(first);
  });
});
