/**
 * Minimal v0 stubs so the router can be constructed/tested. These are NOT the
 * production implementations — they throw `not-implemented` on the dispatch
 * path. The concrete personal-passthrough wiring (caller-auth via auth-hono,
 * DB-backed pool, KMS resolver, llm-mesh dispatch) lands in Lot 2.
 */

import type { CallerAuthPort, CallerAuthResult } from './ports/caller-auth.js';
import type {
  GatewayDispatchPort,
  GatewayDispatchRequest,
  GatewayDispatchResponse,
  GatewayDispatchStream,
} from './ports/dispatch.js';
import type { AuthResolver, PoolSelection, PoolStatePort } from './ports/pool.js';
import type { GatewayConfig } from './config.js';
import { DEFAULT_CROSS_USER_POOL_ENABLED, DEFAULT_GATEWAY_MODE } from './config.js';

const notImplemented = (path: string): never => {
  throw new Error(`@sentropic/llm-gateway v0 scaffold: ${path} not implemented`);
};

export const stubCallerAuth: CallerAuthPort = {
  async verify(): Promise<CallerAuthResult> {
    return { ok: false, reason: 'caller-auth not implemented in v0 scaffold' };
  },
};

export const stubPool: PoolStatePort = {
  async listEligibleAccounts() {
    return [];
  },
  async select(): Promise<PoolSelection> {
    return notImplemented('pool.select');
  },
  async snapshotModels() {
    return [];
  },
};

export const stubAuthResolver: AuthResolver = {
  async resolve() {
    return notImplemented('authResolver.resolve');
  },
};

export const stubDispatch: GatewayDispatchPort = {
  async dispatch(_request: GatewayDispatchRequest): Promise<GatewayDispatchResponse> {
    return notImplemented('dispatch');
  },
  dispatchStream(_request: GatewayDispatchRequest): GatewayDispatchStream {
    return notImplemented('dispatchStream');
  },
};

/**
 * A fully-stubbed v0 config (personal-passthrough, kill switch OFF). Lets the
 * router be constructed for the scaffold unit test.
 */
export const stubGatewayConfig: GatewayConfig = {
  mode: DEFAULT_GATEWAY_MODE,
  crossUserPoolEnabled: DEFAULT_CROSS_USER_POOL_ENABLED,
  callerAuth: stubCallerAuth,
  pool: stubPool,
  authResolver: stubAuthResolver,
  dispatch: stubDispatch,
};
