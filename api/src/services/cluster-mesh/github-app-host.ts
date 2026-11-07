import { randomUUID } from 'node:crypto';
import {
  createEncryptedGitAppCustodian,
  createGitHubAppEnrollment,
  createGitHubAppRouter,
  GitAppError,
  type GitAppEnvelopeStore,
  type GitAppOwnerRepository,
  type GitCredentialInvalidation,
} from '@sentropic/cluster-mesh';
import { Hono, type Context, type MiddlewareHandler } from 'hono';

import { env } from '../../config/env';
import { isProvisionedSecretEncryptionKey, withConnectorRevocationKey } from '../secret-crypto';

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
 * - custody through the host secret custodian key `secret-crypto:v1`, refused
 *   (fail-closed) unless `SECRET_ENCRYPTION_KEY` is provisioned;
 * - the public mount `/api/v1/github-app/*` (reached through the ui nginx
 *   `/api/v1/` proxy), translated onto the frozen package root `/github-app`;
 * - the credential-invalidation bus other lanes subscribe to.
 *
 * None of these routes log query, body or headers: the app logger and the ui
 * nginx fence `isGitHubAppPath` paths (callback states, codes and
 * installation ids are credential-shaped). This module itself never logs.
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
  | {
    readonly enabled: false;
    readonly disabledReason: 'not_configured' | 'custody_key_unavailable' | 'invalid_config';
  }
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

/** Absolute root the frozen cluster-mesh router serves (internal only). */
const PACKAGE_ROOT = '/github-app';
/** Product prefix the ui nginx proxies to the API (no ingress change). */
const PUBLIC_PREFIX = '/api/v1';
/** Public SG0-app root on the product origin. */
export const GITHUB_APP_PUBLIC_ROOT = `${PUBLIC_PREFIX}${PACKAGE_ROOT}`;

/**
 * Header set of every SG0-app response. Mirrors the package router: the
 * manifest form posts to github.com, and no referrer leaks a ref or state.
 */
export const GITHUB_APP_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; form-action https://github.com 'self'; base-uri 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
};

/** Internal broker-identity header; any caller-supplied value is stripped. */
const BROKER_TOKEN_HEADER = 'x-sentropic-github-app-broker';

/**
 * True exactly for the public SG0-app paths: the app logger never records
 * them and the product-wide secure headers never overwrite their headers.
 */
export const isGitHubAppPath = (path: string): boolean =>
  path === GITHUB_APP_PUBLIC_ROOT || path.startsWith(`${GITHUB_APP_PUBLIC_ROOT}/`);

const installationRefFromPath = (path: string): string | null =>
  /^\/github-app\/(enroll_[0-9a-fA-F-]{36})(?:\/|$)/.exec(path)?.[1] ?? null;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

const onPackageRoot = (path: string): boolean => path === PACKAGE_ROOT || path.startsWith(`${PACKAGE_ROOT}/`);

/** Publishes a package-root URL (relative or on `base`) under the public mount. */
const toPublicUrl = (value: string, base: string): string => {
  if (value.startsWith('/')) return onPackageRoot(value) ? `${PUBLIC_PREFIX}${value}` : value;
  if (value.startsWith(`${base}/`) && onPackageRoot(value.slice(base.length))) {
    return `${base}${PUBLIC_PREFIX}${value.slice(base.length)}`;
  }
  return value;
};

/**
 * Package responses use absolute package-root paths in redirects and in
 * same-origin form actions; the host republishes both on the public mount.
 */
const toPublicResponse = async (response: Response, base: string): Promise<Response> => {
  const headers = new Headers(response.headers);
  const location = headers.get('location');
  if (location) headers.set('location', toPublicUrl(location, base));
  if (!headers.get('content-type')?.startsWith('text/html')) {
    return new Response(response.body, { status: response.status, headers });
  }
  const html = (await response.text())
    .replaceAll(`action="${PACKAGE_ROOT}/`, `action="${GITHUB_APP_PUBLIC_ROOT}/`);
  headers.delete('content-length');
  return new Response(html, { status: response.status, headers });
};

/** Sets the SG0-app header set on host-rendered responses; package headers win. */
const applySecurityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(GITHUB_APP_SECURITY_HEADERS)) {
    if (!c.res.headers.has(name)) c.res.headers.set(name, value);
  }
};

const readServiceClient = (c: Context): { clientId?: unknown; scopes?: unknown } | undefined =>
  c.get('serviceClient');

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
 * Fail-closed env settlement: a composition is enabled only when the custody
 * key is provisioned, the public base URL is an https origin and every target
 * tuple is inside the frozen registry. A single illegal value disables the
 * whole mount rather than narrowing it: half-open enrollment surfaces are
 * never acceptable.
 */
export const resolveGitHubAppHostConfig = (
  source: Readonly<Record<string, string | undefined>>,
): GitHubAppHostSettlement => {
  const publicBaseUrl = source.GITHUB_APP_PUBLIC_BASE_URL?.trim() ?? '';
  const targetsJson = source.GITHUB_APP_TARGETS_JSON?.trim() ?? '';
  if (!publicBaseUrl || !targetsJson) return { enabled: false, disabledReason: 'not_configured' };
  // The App PEM, webhook secret and tokens are never sealed under the
  // committed development seed: no provisioned key, no mount.
  if (!isProvisionedSecretEncryptionKey(source.SECRET_ENCRYPTION_KEY)) {
    return { enabled: false, disabledReason: 'custody_key_unavailable' };
  }

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
 * returns a mountable Hono app serving the public `/api/v1/github-app/*`
 * routes. The frozen package router keeps its own `/github-app/*` root and is
 * only reached through the translating dispatcher below, never mounted.
 */
export const createGitHubAppHostRouter = (deps: GitHubAppHostRouterDeps): Hono => {
  // Defence in depth for direct callers: the mount gate already refused.
  if (!isProvisionedSecretEncryptionKey(env.SECRET_ENCRYPTION_KEY)) throw new GitAppError('capability_unavailable');
  const base = deps.config.publicBaseUrl;
  const custody = withConnectorRevocationKey(GIT_APP_CUSTODY_KEY_REF, (key) =>
    createEncryptedGitAppCustodian({ store: deps.store, key }));
  const service = createGitHubAppEnrollment({
    publicBaseUrl: base,
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
    return { ...started, promptUrl: toPublicUrl(started.promptUrl, base) };
  };

  // GitHub calls back on the manifest URLs: publish them on the public mount.
  const prompt: typeof service.prompt = async (target, ref) => {
    const issued = await service.prompt(target, ref);
    const { manifest } = issued;
    return {
      ...issued,
      manifest: {
        ...manifest,
        redirect_url: toPublicUrl(manifest.redirect_url, base),
        setup_url: toPublicUrl(manifest.setup_url, base),
        hook_attributes: { ...manifest.hook_attributes, url: toPublicUrl(manifest.hook_attributes.url, base) },
      },
    };
  };

  const targetByKey = (key: string): GitHubAppTargetBinding | null =>
    deps.config.targets.find((target) => targetKeyOf(target.locator) === key) ?? null;

  const resolveTarget = async (request: Request): Promise<GitHubAppTargetBinding | null> => {
    const url = new URL(request.url);
    const ref = installationRefFromPath(url.pathname);
    if (ref) {
      // Ref routes carry their target durably, never through a query string.
      const recordedKey = await deps.store.lookup(ref);
      return recordedKey ? targetByKey(recordedKey) : null;
    }
    // The enroll gesture names its registry target explicitly: no default.
    const requestedKey = url.searchParams.get('target');
    return requestedKey ? targetByKey(requestedKey) : null;
  };

  const ownerPrincipal = async (request: Request): Promise<GitHubAppPrincipal | null> => {
    const principal = await deps.resolvePrincipal(request);
    return principal && principal.role === GITHUB_APP_OWNER_ROLE ? principal : null;
  };

  const resolveOwner = async (request: Request): Promise<GitAppOwnerRepository | null> => {
    const principal = await ownerPrincipal(request);
    if (!principal) return null;
    const target = await resolveTarget(request);
    if (!target) return null;
    return {
      ownerId: principal.ownerId,
      storageScopeId: target.storageScopeId,
      repoId: target.repoId,
      locator: target.locator,
    };
  };

  // The S2S guard runs on the public request; its verified binding reaches
  // the package router through a per-request random token header (stripped
  // from every caller request), which survives request re-wrapping such as
  // the package bodyLimit on chunked bodies.
  const brokerTokens = new Map<string, GitHubAppBrokerBinding>();
  const authenticateBroker = async (request: Request): Promise<{ storageScopeId: string; repoId: string } | null> => {
    const token = request.headers.get(BROKER_TOKEN_HEADER);
    const binding = token ? brokerTokens.get(token) : undefined;
    return binding ? { storageScopeId: binding.storageScopeId, repoId: binding.repoId } : null;
  };

  const packageRouter = createGitHubAppRouter({
    service: { ...service, begin, prompt },
    publicBaseUrl: base,
    resolveOwner,
    authenticateBroker,
  });

  const app = new Hono();
  app.use(GITHUB_APP_PUBLIC_ROOT, applySecurityHeaders);
  app.use(`${GITHUB_APP_PUBLIC_ROOT}/*`, applySecurityHeaders);
  app.onError((error, c) => {
    const code = error instanceof GitAppError ? error.code : 'capability_unavailable';
    return c.json({ error: code }, code === 'access_denied' ? 403 : code === 'invalid_request' ? 400 : 503);
  });

  // Owner landing: one form per registry target, each carrying its target in
  // the form action (optionally narrowed by `?target=`).
  app.get(GITHUB_APP_PUBLIC_ROOT, async (c) => {
    if (!(await ownerPrincipal(c.req.raw))) throw new GitAppError('access_denied');
    const requested = c.req.query('target');
    const targets = requested === undefined
      ? deps.config.targets
      : deps.config.targets.filter((target) => targetKeyOf(target.locator) === requested);
    if (!targets.length) throw new GitAppError('access_denied');
    const forms = targets.map((target) => {
      const action = `${GITHUB_APP_PUBLIC_ROOT}/enroll?target=${encodeURIComponent(targetKeyOf(target.locator))}`;
      return `<form method="post" action="${escapeHtml(action)}"><button>Enroll ${escapeHtml(target.locator)}</button></form>`;
    });
    return c.html(`<html><body>${forms.join('')}</body></html>`);
  });

  app.all(`${GITHUB_APP_PUBLIC_ROOT}/*`, async (c) => {
    const publicUrl = new URL(c.req.url);
    const packageUrl = new URL(`${publicUrl.pathname.slice(PUBLIC_PREFIX.length)}${publicUrl.search}`, publicUrl.origin);
    const headers = new Headers(c.req.raw.headers);
    headers.delete(BROKER_TOKEN_HEADER);
    let token: string | null = null;
    if (packageUrl.pathname.startsWith(`${PACKAGE_ROOT}/broker/`)) {
      // Run the real S2S guard; its refusal leaves no service context, so the
      // package route answers with the sanitized access_denied refusal.
      await deps.brokerMiddleware(c, async () => undefined);
      const client = readServiceClient(c) ?? {};
      const clientId = typeof client.clientId === 'string' ? client.clientId : null;
      const scopes: unknown[] = Array.isArray(client.scopes) ? client.scopes : [];
      const binding = clientId && scopes.includes(GIT_APP_BROKER_SCOPE)
        ? deps.config.brokers.find((broker) => broker.clientId === clientId)
        : undefined;
      if (binding) {
        token = randomUUID();
        brokerTokens.set(token, binding);
        headers.set(BROKER_TOKEN_HEADER, token);
      }
    }
    try {
      const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';
      const response = await packageRouter.fetch(new Request(packageUrl, {
        method: c.req.method,
        headers,
        ...(hasBody ? { body: c.req.raw.body, duplex: 'half' } : {}),
      } as RequestInit));
      return await toPublicResponse(response, base);
    } finally {
      if (token) brokerTokens.delete(token);
    }
  });
  return app;
};
