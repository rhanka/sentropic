import '../modules/topology-guard.js';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import type { Hono } from 'hono';
import type { ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';
import type { ClusterMeshModules } from '../modules/contracts.js';
import { loadGateway } from '../loaders/gateway/index.js';
import { loadGatewayAuth } from '../loaders/gateway/auth.js';
import { loadGatewayAuthHono } from '../loaders/gateway/auth-hono.js';
import { disabledNamespaceModule } from './disabled.js';

/**
 * `service` selects `@sentropic/llm-gateway/auth` (mcp-auth + jose peers), `session`
 * selects `@sentropic/llm-gateway/auth-hono` (auth-hono peer), and `host` means the
 * host injects its own `CallerAuthPort` and selects no gateway auth peer.
 */
export type GatewayAuthMode = 'service' | 'session' | 'host';

export interface GatewayRouterInput {
  readonly gateway: typeof import('@sentropic/llm-gateway');
  readonly serviceAuth?: typeof import('@sentropic/llm-gateway/auth');
  readonly sessionAuth?: typeof import('@sentropic/llm-gateway/auth-hono');
  readonly context: VerifiedInvocationContextPort;
  readonly receipts: InvocationReceiptPort;
}

export interface GatewayNamespaceOptions {
  readonly enabled: boolean;
  readonly authMode: GatewayAuthMode;
  /** Host router wiring, typically around the gateway's own `createGatewayRouter`. */
  readonly createRouter: (input: GatewayRouterInput) => Hono;
}

/**
 * Prepare the `/gw` namespace at composition startup. A selected auth mode is
 * preflighted (its gateway-relative peer graph evaluated) before this resolves, so
 * a missing or incompatible peer fails startup before any listener binds.
 */
export async function createGatewayNamespaceModule(
  modules: ClusterMeshModules,
  options: GatewayNamespaceOptions,
): Promise<ClusterMeshHonoNamespaceModule> {
  if (!options.enabled) return disabledNamespaceModule('/gw');
  const gateway = await loadGateway(modules);
  const serviceAuth = options.authMode === 'service' ? await loadGatewayAuth(modules) : undefined;
  const sessionAuth = options.authMode === 'session' ? await loadGatewayAuthHono(modules) : undefined;
  return {
    namespace: '/gw',
    enabled: true,
    createRouter: ({ context, receipts }) => options.createRouter({
      gateway,
      ...(serviceAuth ? { serviceAuth } : {}),
      ...(sessionAuth ? { sessionAuth } : {}),
      context,
      receipts,
    }),
  };
}
