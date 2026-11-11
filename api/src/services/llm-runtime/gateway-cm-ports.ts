/**
 * CMP-L1 pool/authResolver/dispatch wiring (GD-14), code only, flag-gated.
 *
 * Disabled (default): refused stubs identical to the product gateway today.
 * Enabled without seat custody (CMP-L2 owner act): fails closed with an
 * explicit seat message, never traffic, never secrets. No state move.
 */
import type {
  AuthResolver, GatewayDispatchPort, PoolStatePort,
} from '@sentropic/llm-gateway';
import { isCmAppWorkloadEnabled } from './gateway-cm-app-workload';

const SEAT_MSG = 'seat custody not moved (CMP-L2 owner act)';

const refused = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} is not available on the product gateway`);
};
const seatClosed = (what: string) => async (): Promise<never> => {
  throw new Error(`${what}: ${SEAT_MSG}`);
};

export const createCmPoolPort = (): PoolStatePort => {
  if (!isCmAppWorkloadEnabled()) {
    return {
      listEligibleAccounts: refused('pool'),
      select: refused('pool'),
      snapshotModels: refused('pool'),
    };
  }
  return {
    listEligibleAccounts: async () => [],
    select: seatClosed('pool.select'),
    snapshotModels: async () => [],
  };
};

export const createCmAuthResolver = (): AuthResolver => {
  if (!isCmAppWorkloadEnabled()) return { resolve: refused('native auth resolver') };
  return { resolve: seatClosed('authResolver.resolve') };
};

export const createCmDispatchPort = (): GatewayDispatchPort => ({
  dispatch: isCmAppWorkloadEnabled()
    ? seatClosed('dispatch.dispatch')
    : refused('native dispatch'),
  dispatchStream: () => {
    throw new Error(isCmAppWorkloadEnabled()
      ? `dispatchStream: ${SEAT_MSG}`
      : 'native dispatch is not available on the product gateway');
  },
});
