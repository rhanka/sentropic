import { resolveOrCreateFederatedUser, type AuthHonoDeviceInfo,
  type AuthHonoSessionTokens, type AuthHonoUserRecord, type AuthHonoUserPort,
  type AuthHonoAccountPolicyPort, type FederationResolveDeps } from '@sentropic/auth-hono';
import { createFederationBroker as createBroker } from '../../src/services/auth/federation/broker';
import type { FederationBrokerDeps as BrokerDeps } from '../../src/services/auth/federation/types';

/** Explicit in-memory completion adapter for pure protocol tests; never a production fallback. */
export type FederationBrokerDeps = Omit<BrokerDeps, 'complete' | 'federation'> &
  Omit<FederationResolveDeps, 'autoLinkProviders' | 'users' | 'accountPolicy'> & {
    users: Pick<AuthHonoUserPort, 'create' | 'findByEmail' | 'findById'>;
    accountPolicy: FederationResolveDeps['accountPolicy'] & Pick<AuthHonoAccountPolicyPort, 'resolveSessionRole'>;
    mintSession(input: { user: AuthHonoUserRecord; deviceInfo?: AuthHonoDeviceInfo }): Promise<AuthHonoSessionTokens>;
  };

export const createFederationBroker = (deps: FederationBrokerDeps) => createBroker({
  ...deps,
  complete: operation => operation({
    now: deps.clock.now(), audit: deps.audit, federation: deps.federation,
    resolveFederatedUser: input => resolveOrCreateFederatedUser({ ...deps,
      autoLinkProviders: deps.config.autoLinkProviders }, input),
    async authenticate(userId, deviceInfo) {
      const user = await deps.users.findById(userId);
      if (!user) throw new Error('Test fixture user missing');
      const role = await deps.accountPolicy.resolveSessionRole(user, deps.clock.now());
      return deps.mintSession({ user: { ...user, role }, deviceInfo });
    },
    async requireLinkActor() {},
    async verifyEmailProof() {},
    async consumeEmailProof() {},
  }),
});
