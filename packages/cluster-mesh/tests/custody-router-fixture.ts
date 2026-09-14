import type { VerifiedInvocationContext } from '../../contracts/src/index.js';
import { vi } from 'vitest';
import {
  BoundedLocalCustodySource,
  InMemoryCustodyStateStore,
  createClusterMeshRuntime,
  createCustodyInvocationVerifier,
  createRegistrationGate,
  createSessionNamespaceModule,
  encodeCustodyToken,
  type ClusterMeshRegistration,
  type CustodyBinding,
  type CustodyStateConsumption,
  type CustodyStateInspection,
  type CustodyStateStatus,
  type CustodyStateStorePort,
  type CustodyTokenVerifierPort,
} from '../src/index.js';

export const custodyRegistration: ClusterMeshRegistration = {
  registrationId: 'registration-1', generationId: 'generation-1',
  principalId: 'holder-1', workspaceId: 'workspace-1',
  custodyHolderPrincipalId: 'holder-1', custodyEpoch: 1,
  actuatorRef: 'pty:session-1', status: 'active',
  expiresAt: '2026-09-13T14:00:00.000Z', leaseExpiresAt: '2026-09-13T14:00:00.000Z',
};

const binding: CustodyBinding = {
  registrationId: custodyRegistration.registrationId, custodyId: 'custody-1',
  holderPrincipalId: 'holder-1', epoch: 1, meshDomain: 'mesh.example.test',
  status: 'active', expiresAt: '2026-09-13T14:00:00.000Z',
};

export class FailingConsumeCustodyState implements CustodyStateStorePort {
  readonly #delegate = new InMemoryCustodyStateStore();
  failConsume = false;

  revoke = this.#delegate.revoke.bind(this.#delegate);
  inspect(input: CustodyStateInspection): Promise<CustodyStateStatus> {
    return this.#delegate.inspect(input);
  }
  consume(input: CustodyStateConsumption): Promise<CustodyStateStatus> {
    if (this.failConsume) return Promise.reject(new Error('custody store unavailable'));
    return this.#delegate.consume(input);
  }
}

const verifiedContext = (invocationId: string, legacyCustody = false): VerifiedInvocationContext => ({
  invocationId, correlationId: invocationId, generationId: custodyRegistration.generationId,
  principal: { principalId: 'holder-1', kind: 'workload', verifierId: 'test' },
  workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '1' },
  scopes: ['session:drive'], policyRevision: '1', issuedAt: '2026-09-13T12:00:00.000Z',
  registration: {
    registrationId: custodyRegistration.registrationId,
    generationId: custodyRegistration.generationId,
    workspaceId: custodyRegistration.workspaceId,
    actuatorRef: custodyRegistration.actuatorRef,
    custodyEpoch: custodyRegistration.custodyEpoch,
    expiresAt: custodyRegistration.expiresAt,
  },
  ...(legacyCustody ? {
    custody: { custodyId: binding.custodyId, holderPrincipalId: binding.holderPrincipalId, epoch: binding.epoch },
  } : {}),
});

export function createCustodyRouterFixture(input: {
  readonly state?: CustodyStateStorePort;
  readonly legacyCustody?: boolean;
  readonly outcome?: 'acted' | 'deferred';
} = {}) {
  const events: string[] = [];
  const source = new BoundedLocalCustodySource({
    issuerId: 'custody-source-1',
    registrations: { async find() { events.push('registration'); return custodyRegistration; } },
    bindings: [binding], maximumTtlSeconds: 60,
    state: input.state, now: () => new Date('2026-09-13T12:00:00.000Z'),
  });
  const custodyTokens: CustodyTokenVerifierPort = {
    verify: (token, expected) => source.verify(token, expected),
    async consume(token, expected) {
      events.push('consume:start');
      const result = await source.consume(token, expected);
      events.push('consume:end');
      return result;
    },
  };
  const context = createCustodyInvocationVerifier({
    context: {
      async verify(request) {
        events.push('context');
        return verifiedContext(request.invocationId, input.legacyCustody);
      },
    },
    custodyTokens,
  });
  const pty = {
    kind: 'pty' as const,
    isAvailable: vi.fn(async () => { events.push('available'); return true; }),
    probeState: vi.fn(async () => 'alive' as const),
    actuate: vi.fn(async () => {
      events.push('actuate');
      return { effectRef: 'effect-1', outcome: input.outcome ?? 'acted' };
    }),
  };
  const gateFind = vi.fn(async () => custodyRegistration);
  const runtime = createClusterMeshRuntime({
    generationId: 'generation-1', config: { capacity: { poolSize: 4 } }, context,
    registration: createRegistrationGate({
      generationId: 'generation-1', registrations: { find: gateFind },
      pty, custodyTokens, now: () => new Date('2026-09-13T12:00:00.000Z'),
    }),
    receipts: { async append(receipt) { events.push(`receipt:${receipt.stage}`); } },
    now: () => new Date('2026-09-13T12:00:00.000Z'),
  });
  const store = {
    enqueueCommand: vi.fn(async () => { events.push('enqueue'); return true; }),
    updateCommand: vi.fn(async (_id: string, update: { status: string }) => {
      events.push(`store:${update.status}`); return true;
    }),
    markRegistrationLost: vi.fn(async () => true),
  };
  const ok = (c: { json(value: unknown): Response }) => c.json({ ok: true });
  const module = createSessionNamespaceModule({
    handlers: { current: ok, refresh: ok, extensionToken: ok, logout: ok, logoutAll: ok, list: ok },
    devices: { issue: ok, poll: ok, approve: ok },
    projection: { session: '/', device: '/device', control: '/control' },
    control: {
      runtime, store, targets: { async inspect() { return 'alive'; } },
      instructions: { async resolve() { events.push('resolve'); return { kind: 'signed-instruction' }; } },
      author: { async ensureAuthor() { return { ok: true }; } },
    },
  });
  return {
    app: module.createRouter({ context, receipts: runtime.receiptPort }),
    events, gateFind, pty, source, store,
    async token(invocationId: string) {
      const token = await source.issue({
        registrationId: custodyRegistration.registrationId, action: 'drive',
        holderPrincipalId: 'holder-1', invocationId,
      });
      return encodeCustodyToken(token!);
    },
  };
}

export const custodyCommand = (invocationId: string, custodyToken?: string) => ({
  commandRef: invocationId, targetRegistrationId: custodyRegistration.registrationId,
  idempotencyKey: `key-${invocationId}`, custodyToken,
});
