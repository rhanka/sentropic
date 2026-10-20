import type { GatewayConfig } from '../config.js';
import type { CostContext } from '../ports/cost-context.js';
import type { CallerAuthRequestContext } from '../ports/caller-auth.js';
import type { CallerContext } from '../session-service.js';
import type { CreateGatewayRouterOptions } from '../router/index.js';
import type { KeyringReader } from './gateway-state-store.js';
import type { RouteMeteringSink } from '../route-flow-core.js';
import type { RouteAffinityStore, RoutePlanner } from '@sentropic/llm-mesh';

export interface MeshBinding {
  readonly ownerScopeRef: string;
  readonly keyring: KeyringReader;
  unlockKeyring(): Promise<void>;
  createRoutePlanner(options: { affinityStore?: RouteAffinityStore }): RoutePlanner;
  resolveOwner(caller: CallerContext, context: CallerAuthRequestContext): CostContext | Promise<CostContext>;
  readonly gateway: Omit<CreateGatewayRouterOptions, 'config' | 'readiness' | 'requestAudit' | 'routePlanner'> & {
    readonly config: Omit<GatewayConfig, 'callerAuth'>;
    readonly routeMetering: RouteMeteringSink;
  };
}
export interface StartGatewayHostOptions {
  readonly stateDir: string;
  readonly controlSocket?: string;
  readonly mesh: MeshBinding;
  readonly listen: { host: string; port: number };
}
export interface HostReadiness {
  readonly ready: boolean;
  readonly checks: { readonly keyring: boolean; readonly state: boolean; readonly control: boolean; readonly dataPlane: boolean };
}
export interface GatewayHostHandle {
  readonly endpoint: string;
  readonly controlSocket: string;
  readiness(): Promise<HostReadiness>;
  drain(): Promise<void>;
  stop(): Promise<void>;
}
