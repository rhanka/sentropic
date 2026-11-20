import type { GatewayConfig } from '../config.js';
import type { CostContext } from '../ports/cost-context.js';
import type { CallerAuthRequestContext } from '../ports/caller-auth.js';
import type { CallerContext } from '../session-service.js';
import type { CreateGatewayRouterOptions } from '../router/index.js';
import type { KeyringReader } from './gateway-state-store.js';
import type { RouteMeteringSink } from '../route-flow-core.js';
import type { RouteAffinityStore, RoutePlanner } from '@sentropic/llm-mesh';
import type { CaptureRetention } from '../ports/capture-vault.js';
import type { GuardPort } from '../ports/guards.js';
import type { StageRewriteEngine } from '../rewrite/stage-rewrite.js';

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
  /** Default OFF (`false`). When true, enables HMAC-proofed loopback HTTP `POST /v1/session`. */
  readonly enableLoopbackHttpSessionMint?: boolean;
  /** Ephemeral 256-bit launch secret required when `enableLoopbackHttpSessionMint` is true. */
  readonly bootstrapSecret?: string;
  readonly bootstrapNow?: () => number;
  readonly bootstrapMaxNonces?: number;
  /** Default OFF (`false`). Enables encrypted local turn capture vault on Stage 1. */
  readonly captureEnabled?: boolean;
  readonly captureRetention?: CaptureRetention;
  readonly captureQuotaBytes?: number;
  readonly stageId?: string;
  readonly stageRewrite?: StageRewriteEngine;
  readonly guard?: GuardPort;
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
