/**
 * Gateway configuration. v0 = personal-passthrough only. The cross-user pool
 * is gated behind a KILL SWITCH that DEFAULTS OFF (spec §7 OWNER D0): it MUST
 * NOT activate without explicit owner ToS-acceptance. This lot wires the flag
 * (default OFF) but NOT the cross-user path — selection that would require a
 * cross-user authorization grant is rejected while the switch is OFF.
 */

import type { CallerAuthPort } from './ports/caller-auth.js';
import type { GatewayDispatchPort } from './ports/dispatch.js';
import type { AuthResolver, PoolStatePort } from './ports/pool.js';

export type GatewayMode = 'personal-passthrough' | 'cross-user-pool';

export interface GatewayConfig {
  /**
   * v0 = `personal-passthrough` (caller == provider, ToS-conforming). The
   * `cross-user-pool` mode is gated behind `crossUserPoolEnabled`.
   */
  readonly mode: GatewayMode;
  /**
   * KILL SWITCH for cross-user pooling (spec §7 D0). DEFAULT OFF. Must NOT be
   * true without explicit owner ToS-acceptance. Not wired this lot.
   */
  readonly crossUserPoolEnabled: boolean;
  /** Caller-auth verifier (spec §2). */
  readonly callerAuth: CallerAuthPort;
  /** Gateway-owned pool state (spec §4). */
  readonly pool: PoolStatePort;
  /** Gateway-owned secret resolver / refresh-under-lock (spec §4). */
  readonly authResolver: AuthResolver;
  /** llm-mesh-backed dispatch seam (spec §1/§6). */
  readonly dispatch: GatewayDispatchPort;
}

export const DEFAULT_GATEWAY_MODE: GatewayMode = 'personal-passthrough';
export const DEFAULT_CROSS_USER_POOL_ENABLED = false;
