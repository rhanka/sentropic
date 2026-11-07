import {
  createEncryptedGitAppCustodian,
  createGitHubAppEnrollment,
  createGitHubAppRouter,
  GitAppError,
  type GitAppEnvelopeStore,
  type GitAppOwnerRepository,
  type GitCredentialInvalidation,
} from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { withConnectorRevocationKey } from '../secret-crypto';

/**
 * A-LIVE W1 (plan lot M2-S, G0 v3 §2.7) — SG0-app host composition.
 *
 * The cluster-mesh package already ships the enrollment, lifecycle, rotation
 * and custody core with its own contract tests. Everything here is the
 * SENTROPIC host half of the composition:
 *
 * - the frozen two-repo target registry and its fail-closed env resolver;
 * - `resolveOwner` from the owner session (admin_app role per plan M2-S);
 * - the durable ref→target mapping recorded by wrapping `service.begin`, so
 *   ref routes (prompt, callbacks, status, rotation, revoke, events) resolve
 *   their target without re-encoding scope/repo identity in URLs, and a lost
 *   mapping kills the route instead of guessing a target;
 * - `authenticateBroker` from a service identity (mcp-auth S2S middleware)
 *   bound server-side to exactly one { storageScopeId, repoId } tuple from
 *   the enrolled registry — caller-supplied locators or tuples are never
 *   accepted;
 * - custody through the host secret custodian key `secret-crypto:v1`;
 * - the credential-invalidation bus other lanes subscribe to.
 *
 * None of these routes log query, body or headers: the app logger fences
 * `isGitHubAppPath` paths (callback states, codes and installation ids are
 * credential-shaped). This module itself never logs at all.
 */

/** G0 v3 §2.7: the only repositories enrollable through this host, in order. */
export const GIT_APP_TARGET_REGISTRY = ['rhanka/radar-immobilier', 'rhanka/sentropic'] as const;
export type GitHubAppTargetLocator = (typeof GIT_APP_TARGET_REGISTRY)[number];

export interface GitHubAppTargetBinding {
  readonly locator: string;
  readonly storageScopeId: string;
  readonly repoId: string;
}

export interface GitHubAppBrokerBinding {
  readonly clientId: string;
  readonly storageScopeId: string;
  readonly repoId: string;
}

export interface GitHubAppHostConfig {
  /** https origin only; the cluster-mesh enrollment enforces the same shape. */
  readonly publicBaseUrl: string;
  /** Registry-approved targets in frozen registry order. */
  readonly targets: readonly GitHubAppTargetBinding[];
  /** Service identities allowed to hold leases, by exact tuple membership. */
  readonly brokers: readonly GitHubAppBrokerBinding[];
}

export type GitHubAppHostSettlement =
  | { readonly enabled: false; readonly disabledReason: 'not_configured' | 'invalid_config' }
  | { readonly enabled: true; readonly config: GitHubAppHostConfig };

export type GitHubAppForge = Parameters<typeof createGitHubAppEnrollment>[0]['github'];

/** The cluster-mesh custodian's store plus this host's durable ref→target map. */
export interface GitHubAppHostStore extends GitAppEnvelopeStore {
  record(ref: string, targetKey: string): Promise<void>;
  lookup(ref: string): Promise<string | null>;
}

/** Product session role allowed to run the owner enrollment gesture. */
export const GITHUB_APP_OWNER_ROLE = 'admin_app';
/** Scope a service client must hold to be accepted by the broker surface. */
export const GIT_APP_BROKER_SCOPE = 'github-app:broker';
/** Host secret custodian key reference (G0 v3 §2.7 custody contract). */
export const GIT_APP_CUSTODY_KEY_REF = 'secret-crypto:v1';

/** True exactly for the SG0-app host paths the app logger must never record. */
export const isGitHubAppPath = (path: string): boolean =>
  path === '/github-app' || path.startsWith('/github-app/');

const installationRefFromPath = (path: string): string | null =>
  /^\/github-app\/(enroll_[0-9a-fA-F-]{36})(?:\/|$)/.exec(path)?.[1] ?? null;

const targetKeyOf = (locator: string): string => locator.split('/')[1] ?? '';
const registryIndexOf = (locator: string): number => GIT_APP_TARGET_REGISTRY.indexOf(
  locator as GitHubAppTargetLocator,
);

const parseSafe = <T,>(text: string): T | null => {
  try { return JSON.parse(text) as T; } catch { return null; }
};

interface RawBindingJson {
  locator?: unknown;
  clientId?: unknown;
  storageScopeId?: unknown;
  repoId?: unknown;
}

const isRecord = (value: unknown): value is RawBindingJson =>
  typeof value === 'object' && value !== null;

const readTargetBindings = (source: string): GitHubAppTargetBinding[] | null => {
  const parsed = parseSafe<unknown[]>(source);
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const targets: GitHubAppTargetBinding[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) return null;
    const { locator, storageScopeId, repoId } = entry;
    if (typeof locator !== 'string' || typeof storageScopeId !== 'string' || typeof repoId !== 'string' ||
        !locator || !storageScopeId || !repoId) return null;
    if (registryIndexOf(locator) < 0) return null;
    if (targets.some((target) => target.locator === locator)) return null;
    targets.push({ locator, storageScopeId, repoId });
  }
  targets.sort((left, right) => registryIndexOf(left.locator) - registryIndexOf(right.locator));
  return targets;
};

const readBrokerBindings = (source: string, targets: readonly GitHubAppTargetBinding[]): GitHubAppBrokerBinding[] | null => {
  const parsed = parseSafe<unknown[]>(source);
  if (!Array.isArray(parsed)) return null;
  const brokers: GitHubAppBrokerBinding[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) return null;
    const { clientId, storageScopeId, repoId } = entry;
    if (typeof clientId !== 'string' || typeof storageScopeId !== 'string' || typeof repoId !== 'string' ||
        !clientId || !storageScopeId || !repoId) return null;
    if (brokers.some((broker) => broker.clientId === clientId)) return null;
    if (!targets.some((target) => target.storageScopeId === storageScopeId && target.repoId === repoId)) return null;
    brokers.push({ clientId, storageScopeId, repoId });
  }
  return brokers;
};

/**
 * Fail-closed env settlement: a composition is enabled only when the public
 * base URL is an https origin and every target tuple is inside the frozen
 * registry. A single illegal value disables the whole mount rather than
 * narrowing it: half-open enrollment surfaces are never acceptable.
 */
export const resolveGitHubAppHostConfig = (
  source: Readonly<Record<string, string | undefined>>,
): GitHubAppHostSettlement => {
  const publicBaseUrl = source.GITHUB_APP_PUBLIC_BASE_URL?.trim() ?? '';
  const targetsJson = source.GITHUB_APP_TARGETS_JSON?.trim() ?? '';
  if (!publicBaseUrl || !targetsJson) return { enabled: false, disabledReason: 'not_configured' };

  const invalid = (): GitHubAppHostSettlement => ({ enabled: false, disabledReason: 'invalid_config' });
  let origin: URL;
  try { origin = new URL(publicBaseUrl); } catch { return invalid(); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
    return invalid();
  }
  const targets = readTargetBindings(targetsJson);
  if (!targets) return invalid();
  const brokersJson = source.GITHUB_APP_BROKER_BINDINGS_JSON?.trim() ?? '';
  let brokers: GitHubAppBrokerBinding[] | null = [];
  if (brokersJson) {
    brokers = readBrokerBindings(brokersJson, targets);
    if (!brokers) return invalid();
  }
  return { enabled: true, config: { publicBaseUrl: origin.origin, targets, brokers } };
};

export type GitInvalidationSubscriber = (event: GitCredentialInvalidation) => Promise<void>;

/** Module-level subscriber registry: no-op at M2; later lanes subscribe here. */
const gitInvalidationSubscribers: GitInvalidationSubscriber[] = [];

export const registerGitInvalidationSubscriber = (subscriber: GitInvalidationSubscriber): (() => void) => {
  gitInvalidationSubscribers.push(subscriber);
  return () => {
    const index = gitInvalidationSubscribers.indexOf(subscriber);
    if (index >= 0) gitInvalidationSubscribers.splice(index, 1);
  };
};

/**
 * Sequential collector: a failing subscriber fails the event, so the record's
 * `invalidationPending` fence stays up and the invalidation is retried on the
 * next acquisition instead of being silently dropped.
 */
export const createGitInvalidationBus = (): GitInvalidationSubscriber => async (event) => {
  for (const subscriber of [...gitInvalidationSubscribers]) await subscriber(event);
};

export interface GitHubAppPrincipal {
  readonly ownerId: string;
  readonly role: string;
}

export interface GitHubAppHostRouterDeps {
  readonly config: GitHubAppHostConfig;
  readonly store: GitHubAppHostStore;
  readonly github: GitHubAppForge;
  readonly resolvePrincipal: (request: Request) => Promise<GitHubAppPrincipal | null>;
  readonly brokerMiddleware: MiddlewareHandler;
  readonly onCredentialsChanged: GitInvalidationSubscriber;
  readonly now?: () => number;
}

/**
 * Composes the cluster-mesh SG0-app router with this host's adapters and
 * returns a mountable Hono app serving the absolute `/github-app/*` routes.
 */
export const createGitHubAppHostRouter = (deps: GitHubAppHostRouterDeps): Hono => {
  const custody = withConnectorRevocationKey(GIT_APP_CUSTODY_KEY_REF, (key) =>
    createEncryptedGitAppCustodian({ store: deps.store, key }));
  const service = createGitHubAppEnrollment({
    publicBaseUrl: deps.config.publicBaseUrl,
    custody,
    github: deps.github,
    onCredentialsChanged: deps.onCredentialsChanged,
    ...(deps.now ? { now: deps.now } : {}),
  });

  const begin = async (target: GitAppOwnerRepository) => {
    const started = await service.begin(target);
    // The mapping is what ref routes resolve from. Recording it before the
    // redirect keeps the enrolled target authoritative; a lost record must
    // kill the ref routes, never re-guess the target.
    await deps.store.record(started.installationRef, targetKeyOf(target.locator));
    return started;
  };

  const resolveTarget = async (request: Request): Promise<GitHubAppTargetBinding | null> => {
    const url = new URL(request.url);
    const ref = installationRefFromPath(url.pathname);
    if (ref) {
      // Ref routes carry their target durably, never through a query string.
      const recordedKey = await deps.store.lookup(ref);
      if (!recordedKey) return null;
      return deps.config.targets.find((target) => targetKeyOf(target.locator) === recordedKey) ?? null;
    }
    const requestedKey = url.searchParams.get('target');
    if (requestedKey) {
      return deps.config.targets.find((target) => targetKeyOf(target.locator) === requestedKey) ?? null;
    }
    // Gesture default: the first frozen-registry target, as chosen in the plan.
    return deps.config.targets[0] ?? null;
  };

  const resolveOwner = async (request: Request): Promise<GitAppOwnerRepository | null> => {
    const principal = await deps.resolvePrincipal(request);
    if (!principal || principal.role !== GITHUB_APP_OWNER_ROLE) return null;
    const target = await resolveTarget(request);
    if (!target) return null;
    return {
      ownerId: principal.ownerId,
      storageScopeId: target.storageScopeId,
      repoId: target.repoId,
      locator: target.locator,
    };
  };

  // The service-auth middleware stores its verified client on the hono
  // context; the cluster-mesh router hands over the raw Request, so the
  // binding travels keyed by that same Request object, per call.
  const principalsByRequest = new WeakMap<Request, GitHubAppBrokerBinding>();
  const authenticateBroker = async (request: Request): Promise<{ storageScopeId: string; repoId: string } | null> => {
    const binding = principalsByRequest.get(request);
    return binding ? { storageScopeId: binding.storageScopeId, repoId: binding.repoId } : null;
  };

  const app = new Hono();
  app.use('/github-app/broker/*', async (c, next) => {
    // Run the real S2S guard; its refusal leaves no service context, so the
    // cluster-mesh route answers with the sanitized access_denied refusal.
    await deps.brokerMiddleware(c, async () => undefined);
    const client: { clientId: string; scopes: string[]; jkt: string | null } | undefined = c.get('serviceClient');
    if (client && client.scopes?.includes(GIT_APP_BROKER_SCOPE)) {
      const binding = deps.config.brokers.find((broker) => broker.clientId === client.clientId);
      if (binding) principalsByRequest.set(c.req.raw, binding);
    }
    return next();
  });
  app.onError((error, c) => {
    const code = error instanceof GitAppError ? error.code : 'capability_unavailable';
    return c.json({ error: code }, code === 'access_denied' ? 403 : code === 'invalid_request' ? 400 : 503);
  });
  app.route('/', createGitHubAppRouter({
    service: { ...service, begin },
    publicBaseUrl: deps.config.publicBaseUrl,
    resolveOwner,
    authenticateBroker,
  }));
  return app;
};
