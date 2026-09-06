import { describe, expect, it, vi } from 'vitest';
import type {
  VerifiedInvocationContext,
  VerifiedInvocationContextPort,
} from '../../contracts/src/index.js';

const context: VerifiedInvocationContext = {
  invocationId: 'invocation-1',
  correlationId: 'correlation-1',
  generationId: 'generation-1',
  principal: {
    principalId: 'workload-1',
    kind: 'workload',
    verifierId: 'verifier-1',
  },
  workspace: {
    bindingId: 'binding-1',
    workspaceId: 'workspace-1',
    revision: 'binding-revision-1',
  },
  scopes: ['session:read'],
  policyRevision: 'policy-revision-1',
  issuedAt: '2026-08-30T12:00:00.000Z',
};

describe('verified invocation context contract', () => {
  it('should resolve a secret-free context through an injected verifier', async () => {
    const verify = vi.fn(async () => context);
    const port: VerifiedInvocationContextPort = { verify };

    await expect(port.verify({
      invocationId: context.invocationId,
      correlationId: context.correlationId,
      generationId: context.generationId,
      method: 'GET',
      path: '/session',
      authorizationEvidenceRef: 'evidence-1',
    })).resolves.toEqual(context);

    expect(verify).toHaveBeenCalledOnce();
    expect(JSON.stringify(context)).not.toMatch(/secret|token|credential|privateKey/i);
  });
});
