// Compile-only fixture: every measured h2a M/G symbol through the static leaves,
// both gateway auth subpaths, and the typed loaders returning original namespaces.
import {
  CloudCodeRuntimeClient,
  CodexRuntimeClient,
  createLlmMesh,
  createProviderRegistry,
  DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
  DEFAULT_ROUTE_POLICY,
  GeminiAdapter,
  InMemoryRoutePlanner,
  InMemoryRoutePolicyProfiles,
  modelProfiles,
  MuseAdapter,
  MuseRuntimeClient,
  OpenAIAdapter,
  RoutePlanError,
  validateEquivalenceCouncil,
  validateRoutePolicy,
  type AccountDirectoryPort,
  type EligibleAccountDescriptor,
  type ModelEquivalenceCouncil,
  type PreparedRouteAttempt,
  type RouteDiagnostic,
  type RoutePlan,
  type RoutePlanInput,
  type RoutePlanner,
  type RoutePolicy,
  type RoutePolicyProfile,
  type RouteSelector,
  type StreamEvent,
  type StreamRequest,
  type VerifiedRoutingSubject,
} from '../../../src/integrations/llm-mesh/index.js';
import * as meshProvider from '@sentropic/llm-mesh';
import {
  createLlmMeshFacade,
  type ConfigResolver,
  type LlmMeshAdministrativeFacade,
  type LlmMeshFacade,
} from '../../../src/integrations/llm-mesh/facade.js';
import * as facadeProvider from '@sentropic/llm-mesh/facade';
import type { AccountPublic } from '../../../src/integrations/llm-mesh/enrollment.js';
import type { AccountPublic as ProviderAccountPublic } from '@sentropic/llm-mesh/enrollment';
import { InMemoryKeyring } from '../../../src/integrations/llm-mesh/node.js';
import { CloudCodeProviderAdapter } from '../../../src/integrations/llm-mesh/transport/cloud-code.js';
import {
  createGatewayRouter,
  stubGatewayConfig,
  type CallerAuthPort,
  type RouteMeteringSink,
  type RouteRequestSettlement,
} from '../../../src/integrations/gateway/index.js';
import * as gatewayProvider from '@sentropic/llm-gateway';
import { ServiceAuthVerifyToken, type ServiceAuthVerifyTokenOptions } from '../../../src/integrations/gateway/auth.js';
import { AuthHonoVerifyToken, type AuthHonoVerifyTokenOptions } from '../../../src/integrations/gateway/auth-hono.js';
import { loadLlmMesh } from '../../../src/loaders/llm-mesh/index.js';
import { loadGatewayAuth } from '../../../src/loaders/gateway/auth.js';
import { loadGatewayAuthHono } from '../../../src/loaders/gateway/auth-hono.js';
import type { ClusterMeshModules } from '../../../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;

export type Checks = [
  Assert<Equal<typeof createLlmMesh, typeof meshProvider.createLlmMesh>>,
  Assert<Equal<typeof createLlmMeshFacade, typeof facadeProvider.createLlmMeshFacade>>,
  Assert<Equal<typeof createGatewayRouter, typeof gatewayProvider.createGatewayRouter>>,
  Assert<Equal<AccountPublic, ProviderAccountPublic>>,
  Assert<Equal<IsAny<typeof createLlmMesh>, false>>,
  Assert<Equal<IsAny<CallerAuthPort>, false>>,
  Assert<Equal<IsAny<ServiceAuthVerifyTokenOptions>, false>>,
  Assert<Equal<IsAny<AuthHonoVerifyTokenOptions>, false>>,
  Assert<Equal<Awaited<ReturnType<typeof loadLlmMesh>>, typeof meshProvider>>,
];

export const values = [
  CloudCodeRuntimeClient, CodexRuntimeClient, createProviderRegistry, DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
  DEFAULT_ROUTE_POLICY, GeminiAdapter, InMemoryRoutePlanner, InMemoryRoutePolicyProfiles, modelProfiles,
  MuseAdapter, MuseRuntimeClient, OpenAIAdapter, RoutePlanError, validateEquivalenceCouncil, validateRoutePolicy,
  InMemoryKeyring, CloudCodeProviderAdapter, stubGatewayConfig, ServiceAuthVerifyToken, AuthHonoVerifyToken,
];

export type Types = [
  AccountDirectoryPort, EligibleAccountDescriptor, ModelEquivalenceCouncil, PreparedRouteAttempt, RouteDiagnostic,
  RoutePlan, RoutePlanInput, RoutePlanner, RoutePolicy, RoutePolicyProfile, RouteSelector, StreamEvent, StreamRequest,
  VerifiedRoutingSubject, ConfigResolver, LlmMeshAdministrativeFacade, LlmMeshFacade, RouteMeteringSink,
  RouteRequestSettlement,
];

export async function preflight(modules: ClusterMeshModules): Promise<void> {
  const service = await loadGatewayAuth(modules);
  const session = await loadGatewayAuthHono(modules);
  const verifier: typeof ServiceAuthVerifyToken = service.ServiceAuthVerifyToken;
  const sessionVerifier: typeof AuthHonoVerifyToken = session.AuthHonoVerifyToken;
  void verifier;
  void sessionVerifier;
}
