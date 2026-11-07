import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { GitCredentialInvalidation } from '@sentropic/cluster-mesh';

import { env } from '../../../../src/config/env';
import {
  GITHUB_APP_PUBLIC_ROOT,
  GIT_APP_TARGET_REGISTRY,
  createGitHubAppHostRouter,
  isGitHubAppPath,
  resolveGitHubAppHostConfig,
  type GitHubAppForge,
  type GitHubAppHostConfig,
} from '../../../../src/services/cluster-mesh/github-app-host';

/**
 * A-LIVE W1 / plan lot M2-S — SG0-app host composition contract tests.
 *
 * The cluster-mesh SG0-app core (enrollment, lifecycle, rotation, custody and
 * its forged GitHub adapter) ships with its own package tests. This suite
 * proves the SENTROPIC HOST composition of that core: the fail-closed custody
 * key gate, resolveOwner from the owner session, the frozen target registry
 * with an explicit enroll target, the public `/api/v1/github-app` mount over
 * the package root, authenticateBroker from bound service identities, the
 * durable ref-to-target mapping, and the plan's contract acceptance
 * (callback/replay/scope, single-repo lease, forbidden permissions refused,
 * revocation).
 */

const ROOT = '/api/v1/github-app';
const CUSTODY_KEY = 'unit-test-github-app-custody-key';
const DEV_SEED = 'dev-secret-key-change-in-production-please';
const GITHUB_FORM_ACTION = "form-action https://github.com 'self'";

let savedCustodyKey: string | undefined;
beforeAll(() => {
  savedCustodyKey = env.SECRET_ENCRYPTION_KEY;
  env.SECRET_ENCRYPTION_KEY = CUSTODY_KEY;
});
afterAll(() => {
  env.SECRET_ENCRYPTION_KEY = savedCustodyKey;
});

const pem = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }).toString();
const PERMISSIONS = { contents: 'write', metadata: 'read' } as const;

const repositoryIdOf = (locator: string): string => {
  if (locator === 'rhanka/radar-immobilier') return '101';
  if (locator === 'rhanka/sentropic') return '202';
  throw new Error(`unmapped locator ${locator}`);
};

/** Minimal in-memory store with the envelope-store + ref-target mapping shape. */
const memoryStore = () => {
  const envelopes = new Map<string, string>();
  const targets = new Map<string, string>();
  return {
    transaction: async <T,>(ref: string, action: (sealed: string | null) => Promise<{ sealed: string; result: T }>) => {
      const outcome = await action(envelopes.get(ref) ?? null);
      envelopes.set(ref, outcome.sealed);
      return outcome.result;
    },
    record: async (ref: string, targetKey: string) => { targets.set(ref, targetKey); },
    lookup: async (ref: string) => targets.get(ref) ?? null,
  };
};

/** Recorded fake of the forge API, shaped like the package tests' fixture. */
const fakeForge = () => {
  let time = Date.parse('2026-01-05T12:00:00Z');
  const appKey = pem();
  const minted: string[] = [];
  const revoked: string[] = [];
  const granted: Record<string, string> = { ...PERMISSIONS };
  let tokenPermissions: Record<string, string> = { ...PERMISSIONS };
  const github: GitHubAppForge = {
    exchange: async () => ({ appId: '42', slug: `test-app-${randomUUID().slice(0, 6)}`, privateKey: appKey, webhookSecret: 'fake-webhook-secret' }),
    inspectInstallation: async () => ({ permissions: granted, suspended: false }),
    resolveRepository: async (_app, _installationId, locator) => repositoryIdOf(locator),
    verifyKey: async () => undefined,
    updateWebhookSecret: async () => undefined,
    revokeToken: async (token: string) => { revoked.push(token); },
    mint: async (_app, installationId, repositoryId, requested) => {
      expect(requested).toEqual(PERMISSIONS);
      minted.push(`${installationId}:${repositoryId}`);
      const token = `fake-token-${minted.length}`;
      return { token, expiresAt: new Date(time + 3_600_000).toISOString(),
        permissions: tokenPermissions, repositoryIds: [repositoryId] };
    },
  };
  return {
    github,
    advance: (ms: number) => { time += ms; },
    tokenGrants: (value: Record<string, string>) => { tokenPermissions = value; },
    minted,
    revoked,
    now: () => time,
  };
};

const config: GitHubAppHostConfig = {
  publicBaseUrl: 'https://api.sentropic.example',
  targets: [
    { locator: 'rhanka/radar-immobilier', storageScopeId: 'scope-immo', repoId: 'repo-immo' },
    { locator: 'rhanka/sentropic', storageScopeId: 'scope-app', repoId: 'repo-app' },
  ],
  brokers: [{ clientId: 'immo-host-broker', storageScopeId: 'scope-immo', repoId: 'repo-immo' }],
};
const BASE = config.publicBaseUrl;

type Principal = { ownerId: string; role: string } | null;

/** Session-shaped principal resolver: the production one maps the CM session the same way. */
const OWNERS: Record<string, Principal> = {
  'owner-1': { ownerId: 'owner-1', role: 'admin_app' },
  'owner-2': { ownerId: 'owner-2', role: 'admin_app' },
  'member-1': { ownerId: 'member-1', role: 'member' },
};
const sessionPrincipal = (request: Request): Promise<Principal> =>
  Promise.resolve(OWNERS[request.headers.get('authorization') ?? ''] ?? null);

const brokerMiddlewareOf = (clientId?: string): MiddlewareHandler => async (c, next) => {
  if (clientId) c.set('serviceClient', { clientId, scopes: ['github-app:broker'], jkt: null });
  await next();
};

interface Harness {
  request(path: string, init?: RequestInit): Promise<Response>;
  forge: ReturnType<typeof fakeForge>;
  invalidations: GitCredentialInvalidation[];
}

const createHarness = (brokerClientId?: string): Harness => {
  const forge = fakeForge();
  const invalidations: GitCredentialInvalidation[] = [];
  const router = createGitHubAppHostRouter({
    config,
    store: memoryStore(),
    github: forge.github,
    resolvePrincipal: sessionPrincipal,
    brokerMiddleware: brokerMiddlewareOf(brokerClientId),
    onCredentialsChanged: async (event) => { invalidations.push(event); },
    now: forge.now,
  });
  return { request: async (path, init) => router.request(path, init), forge, invalidations };
};

const sessionHeaders = (owner = 'owner-1'): Record<string, string> => ({ authorization: owner });
const enrollPostHeaders = (owner?: string): Record<string, string> =>
  ({ ...sessionHeaders(owner), origin: BASE });

type TargetKey = 'radar-immobilier' | 'sentropic';

const refOf = (begin: Response): string =>
  new URL(begin.headers.get('location')!, BASE).pathname.replace(/^\/api\/v1\/github-app\//, '');

const beginEnroll = (harness: Harness, target: TargetKey = 'radar-immobilier', owner?: string) =>
  harness.request(`${ROOT}/enroll?target=${target}`, { method: 'POST', headers: enrollPostHeaders(owner) });

interface EnrollOutcome {
  ref: string;
  status: Response;
  begin: Response;
  installed: Response;
}

/** Owner gesture flow: landing → enroll → prompt → manifest → installation → status. */
const enroll = async (harness: Harness, target: TargetKey = 'radar-immobilier', owner = 'owner-1'): Promise<EnrollOutcome> => {
  const landing = await harness.request(`${ROOT}?target=${target}`, { headers: sessionHeaders(owner) });
  expect(landing.status).toBe(200);
  expect(await landing.text()).toContain(`Enroll ${target === 'sentropic' ? 'rhanka/sentropic' : 'rhanka/radar-immobilier'}`);
  const begin = await beginEnroll(harness, target, owner);
  expect(begin.status).toBe(303);
  const ref = refOf(begin);
  const prompt = await harness.request(`${ROOT}/${ref}`, { headers: sessionHeaders(owner) });
  expect(prompt.status).toBe(200);
  const manifestState = /state=([0-9a-f-]{36})/.exec(await prompt.text())![1];
  const converted = await harness.request(`${ROOT}/${ref}/manifest?state=${manifestState}&code=fake-manifest-code`,
    { headers: sessionHeaders(owner) });
  expect(converted.status).toBe(303);
  const installState = new URL(converted.headers.get('location')!).searchParams.get('state')!;
  const installed = await harness.request(`${ROOT}/${ref}/installation?state=${installState}&installation_id=500`,
    { headers: sessionHeaders(owner) });
  expect(installed.status).toBe(303);
  const status = await harness.request(`${ROOT}/${ref}/status`, { headers: sessionHeaders(owner) });
  return { ref, status, begin, installed };
};

const leaseBody = (ref: string) =>
  JSON.stringify({ storageScopeId: 'scope-immo', repoId: 'repo-immo', installationRef: ref });
const leaseRequest = (ref: string): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: leaseBody(ref),
});

describe('SG0-app host config resolution', () => {
  const configured = (extra: Record<string, string | undefined> = {}) => ({
    GITHUB_APP_PUBLIC_BASE_URL: 'https://api.sentropic.example',
    GITHUB_APP_TARGETS_JSON: JSON.stringify([{ locator: 'rhanka/sentropic', storageScopeId: 's', repoId: 'r' }]),
    SECRET_ENCRYPTION_KEY: CUSTODY_KEY,
    ...extra,
  });

  it('should keep the frozen target registry to the two plan repositories in plan order', () => {
    expect(GIT_APP_TARGET_REGISTRY).toEqual(['rhanka/radar-immobilier', 'rhanka/sentropic']);
  });

  it('should refuse the mount without a provisioned custody key, including the committed dev seed', () => {
    const refused = { enabled: false, disabledReason: 'custody_key_unavailable' };
    expect(resolveGitHubAppHostConfig(configured({ SECRET_ENCRYPTION_KEY: undefined }))).toEqual(refused);
    expect(resolveGitHubAppHostConfig(configured({ SECRET_ENCRYPTION_KEY: '' }))).toEqual(refused);
    expect(resolveGitHubAppHostConfig(configured({ SECRET_ENCRYPTION_KEY: '   ' }))).toEqual(refused);
    expect(resolveGitHubAppHostConfig(configured({ SECRET_ENCRYPTION_KEY: DEV_SEED }))).toEqual(refused);
    expect(resolveGitHubAppHostConfig(configured({ SECRET_ENCRYPTION_KEY: ` ${DEV_SEED} ` }))).toEqual(refused);
    expect(resolveGitHubAppHostConfig(configured())).toMatchObject({ enabled: true });
  });

  it('should refuse to compose the router when the process custody key is absent or the dev seed', () => {
    try {
      env.SECRET_ENCRYPTION_KEY = undefined;
      expect(() => createHarness()).toThrow('capability_unavailable');
      env.SECRET_ENCRYPTION_KEY = DEV_SEED;
      expect(() => createHarness()).toThrow('capability_unavailable');
    } finally {
      env.SECRET_ENCRYPTION_KEY = CUSTODY_KEY;
    }
    expect(() => createHarness()).not.toThrow();
  });

  it('should disable the composition when public base URL or targets are missing or not https', () => {
    expect(resolveGitHubAppHostConfig({})).toEqual({ enabled: false, disabledReason: 'not_configured' });
    expect(resolveGitHubAppHostConfig(configured({ GITHUB_APP_PUBLIC_BASE_URL: 'http://api.sentropic.example' })))
      .toEqual({ enabled: false, disabledReason: 'invalid_config' });
    expect(resolveGitHubAppHostConfig(configured({ GITHUB_APP_PUBLIC_BASE_URL: 'https://api.sentropic.example/v1' })))
      .toEqual({ enabled: false, disabledReason: 'invalid_config' });
  });

  it('should reject target and broker bindings outside the registry or outside enrolled tuples', () => {
    expect(resolveGitHubAppHostConfig(configured({ GITHUB_APP_TARGETS_JSON: JSON.stringify([
      { locator: 'rhanka/radar-immobilier', storageScopeId: 's', repoId: 'r' },
      { locator: 'octocat/hello', storageScopeId: 's2', repoId: 'r2' },
    ]) }))).toEqual({ enabled: false, disabledReason: 'invalid_config' });
    expect(resolveGitHubAppHostConfig(configured({
      GITHUB_APP_TARGETS_JSON: JSON.stringify([{ locator: 'rhanka/radar-immobilier', storageScopeId: 's', repoId: 'r' }]),
      GITHUB_APP_BROKER_BINDINGS_JSON: JSON.stringify([{ clientId: 'immo-host-broker', storageScopeId: 'other-scope', repoId: 'other-repo' }]),
    }))).toEqual({ enabled: false, disabledReason: 'invalid_config' });
  });

  it('should resolve configured bindings in frozen registry order regardless of the input order', () => {
    const settled = resolveGitHubAppHostConfig(configured({
      GITHUB_APP_TARGETS_JSON: JSON.stringify([
        { locator: 'rhanka/sentropic', storageScopeId: 'scope-app', repoId: 'repo-app' },
        { locator: 'rhanka/radar-immobilier', storageScopeId: 'scope-immo', repoId: 'repo-immo' },
      ]),
      GITHUB_APP_BROKER_BINDINGS_JSON: JSON.stringify([
        { clientId: 'immo-host-broker', storageScopeId: 'scope-immo', repoId: 'repo-immo' },
      ]),
    }));
    expect(settled).toMatchObject({ enabled: true });
    if (!settled.enabled) return;
    expect(settled.config.targets.map((target) => target.locator))
      .toEqual(['rhanka/radar-immobilier', 'rhanka/sentropic']);
    expect(settled.config.brokers).toEqual([{ clientId: 'immo-host-broker', storageScopeId: 'scope-immo', repoId: 'repo-immo' }]);
  });
});

describe('SG0-app host routes: owner gesture', () => {
  it('should refuse non-owner sessions and unknown target keys without disclosing locators', async () => {
    const harness = createHarness();
    const refusedMember = await harness.request(ROOT, { headers: sessionHeaders('member-1') });
    expect(refusedMember.status).toBe(403);
    expect(await refusedMember.json()).toEqual({ error: 'access_denied' });
    const refusedTarget = await harness.request(`${ROOT}?target=octocat%2Fhello`, { headers: sessionHeaders() });
    expect(refusedTarget.status).toBe(403);
    expect(await refusedTarget.text()).not.toContain('radar-immobilier');
  });

  it('should list every registry target on the landing page with its target in the form action', async () => {
    const harness = createHarness();
    const landing = await harness.request(ROOT, { headers: sessionHeaders() });
    expect(landing.status).toBe(200);
    expect(landing.headers.get('content-security-policy')).toContain(GITHUB_FORM_ACTION);
    expect(landing.headers.get('referrer-policy')).toBe('no-referrer');
    expect(landing.headers.get('cache-control')).toBe('no-store');
    const html = await landing.text();
    expect(html).toContain(`action="${ROOT}/enroll?target=radar-immobilier"`);
    expect(html).toContain(`action="${ROOT}/enroll?target=sentropic"`);
    expect(html).toContain('Enroll rhanka/radar-immobilier');
    expect(html).toContain('Enroll rhanka/sentropic');
    const narrowed = await (await harness.request(`${ROOT}?target=sentropic`, { headers: sessionHeaders() })).text();
    expect(narrowed).toContain('Enroll rhanka/sentropic');
    expect(narrowed).not.toContain('radar-immobilier');
  });

  it('should refuse an enroll POST whose target is absent or unknown instead of defaulting', async () => {
    const harness = createHarness();
    for (const path of [`${ROOT}/enroll`, `${ROOT}/enroll?target=`, `${ROOT}/enroll?target=octocat`]) {
      const refused = await harness.request(path, { method: 'POST', headers: enrollPostHeaders() });
      expect(refused.status).toBe(403);
      expect(refused.headers.get('location')).toBeNull();
      expect(await refused.json()).toEqual({ error: 'access_denied' });
    }
  });

  it.each([
    ['radar-immobilier', 'repo-immo', 'scope-immo'],
    ['sentropic', 'repo-app', 'scope-app'],
  ] as const)('should enroll %s through single-use callbacks on the public mount', async (target, repoId, storageScopeId) => {
    const harness = createHarness();
    const outcome = await enroll(harness, target);
    expect(outcome.ref).toMatch(/^enroll_[0-9a-f-]{36}$/);
    expect(outcome.begin.headers.get('location')).toBe(`${BASE}${ROOT}/${outcome.ref}`);
    expect(outcome.installed.headers.get('location')).toBe(`${ROOT}/${outcome.ref}/status`);
    expect(outcome.status.status).toBe(200);
    expect(await outcome.status.json()).toMatchObject({ state: 'ready', repoId, storageScopeId });
    // Ref routes resolve their target durably, without any query.
    const reRead = await harness.request(`${ROOT}/${outcome.ref}/status`, { headers: sessionHeaders() });
    expect(await reRead.json()).toMatchObject({ state: 'ready', repoId });
  });

  it('should publish the GitHub callback URLs and the manifest form headers on the public mount', async () => {
    const harness = createHarness();
    const ref = refOf(await beginEnroll(harness, 'sentropic'));
    const prompt = await harness.request(`${ROOT}/${ref}`, { headers: sessionHeaders() });
    expect(prompt.status).toBe(200);
    expect(prompt.headers.get('content-security-policy')).toContain(GITHUB_FORM_ACTION);
    expect(prompt.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await prompt.text();
    expect(html).toContain('action="https://github.com/settings/apps/new?state=');
    for (const callback of ['manifest', 'installation', 'events']) {
      expect(html).toContain(`${BASE}${ROOT}/${ref}/${callback}`);
    }
    expect(html).not.toContain(`${BASE}/github-app/`);
  });

  it('should republish the rotation form actions on the public mount and never serve the package root', async () => {
    const harness = createHarness();
    const outcome = await enroll(harness);
    const rotation = await harness.request(`${ROOT}/${outcome.ref}/rotation`, { headers: sessionHeaders() });
    expect(rotation.status).toBe(200);
    const html = await rotation.text();
    for (const action of ['key', 'webhook-stage', 'webhook-switch', 'webhook-retire', 'revoke']) {
      expect(html).toContain(`action="${ROOT}/${outcome.ref}/${action}"`);
    }
    expect(html).not.toContain('action="/github-app/');
    expect((await harness.request('/github-app', { headers: sessionHeaders() })).status).toBe(404);
    expect((await harness.request(`/github-app/${outcome.ref}/status`, { headers: sessionHeaders() })).status).toBe(404);
  });

  it('should refuse replayed, expired and cross-owner callbacks before the forge is called', async () => {
    const harness = createHarness();
    const begin = await beginEnroll(harness);
    expect(begin.status).toBe(303);
    const ref = refOf(begin);
    const prompt = await harness.request(`${ROOT}/${ref}`, { headers: sessionHeaders() });
    const manifestState = /state=([0-9a-f-]{36})/.exec(await prompt.text())![1];
    const convert = () => harness.request(`${ROOT}/${ref}/manifest?state=${manifestState}&code=fake-manifest-code`,
      { headers: sessionHeaders() });
    expect((await convert()).status).toBe(303);
    const replay = await convert();
    expect(replay.status).toBe(403);
    expect(await replay.json()).toEqual({ error: 'access_denied' });

    const freshRef = refOf(await beginEnroll(harness));
    const freshPrompt = await harness.request(`${ROOT}/${freshRef}`, { headers: sessionHeaders() });
    const freshState = /state=([0-9a-f-]{36})/.exec(await freshPrompt.text())![1];
    harness.forge.advance(700_000);
    const expired = await harness.request(`${ROOT}/${freshRef}/manifest?state=${freshState}&code=fake-manifest-code`,
      { headers: sessionHeaders() });
    expect(expired.status).toBe(403);
    expect(await expired.json()).toEqual({ error: 'access_denied' });

    const foreignOwner = await harness.request(`${ROOT}/${freshRef}`, { headers: sessionHeaders('owner-2') });
    expect(foreignOwner.status).toBe(403);
    expect(await foreignOwner.json()).toEqual({ error: 'access_denied' });
  });

  it('should refuse cross-origin owner mutations and forged webhook deliveries', async () => {
    const harness = createHarness();
    const begin = await harness.request(`${ROOT}/enroll?target=radar-immobilier`, { method: 'POST',
      headers: { ...sessionHeaders(), origin: 'https://evil.example' } });
    expect(begin.status).toBe(403);
    expect(await begin.json()).toEqual({ error: 'access_denied' });
    const installed = await enroll(harness);
    const forged = await harness.request(`${ROOT}/${installed.ref}/events`, {
      method: 'POST', headers: { 'x-github-delivery': randomUUID(), 'x-github-event': 'installation' },
      body: JSON.stringify({ action: 'deleted', installation: { id: 500 } }),
    });
    expect(forged.status).toBe(403);
    expect(await forged.json()).toEqual({ error: 'access_denied' });
  });
});

describe('SG0-app host routes: broker leases', () => {
  it('should mint a lease only for the bound service identity and repository', async () => {
    const harness = createHarness('immo-host-broker');
    const outcome = await enroll(harness);
    if (!(await isEnrollOutcome(outcome))) throw new Error('owner flow failed');
    const lease = await harness.request('/github-app/broker/lease', leaseRequest(outcome.ref));
    expect(lease.status).toBe(200);
    expect(await lease.json()).toMatchObject({ repositoryId: '101', permissions: { contents: 'write', metadata: 'read' } });
    expect(harness.forge.minted).toEqual(['500:101']);
  });

  it('should refuse unauthenticated brokers, tuple substitution and unknown enrollments', async () => {
    const harness = createHarness('immo-host-broker');
    const outcome = await enroll(harness);
    if (!(await isEnrollOutcome(outcome))) throw new Error('owner flow failed');

    const anonymous = createHarness();
    const refusedAnonymous = await anonymous.request('/github-app/broker/lease', leaseRequest(outcome.ref));
    expect(refusedAnonymous.status).toBe(403);
    expect(await refusedAnonymous.json()).toEqual({ error: 'access_denied' });

    const substituted = await harness.request('/github-app/broker/lease', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageScopeId: 'scope-app', repoId: 'repo-app', installationRef: outcome.ref }),
    });
    expect(substituted.status).toBe(403);
    expect(await substituted.json()).toEqual({ error: 'access_denied' });

    const malformed = await harness.request('/github-app/broker/lease', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageScopeId: 'scope-immo' }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_request' });

    const unknownRef = await harness.request('/github-app/broker/lease', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageScopeId: 'scope-immo', repoId: 'repo-immo', installationRef: `enroll_${randomUUID()}` }),
    });
    expect(unknownRef.status).toBe(503);
    expect(await unknownRef.json()).toEqual({ error: 'capability_unavailable' });
  });

  it('should refuse a lease on the other repository and close forging on forbidden permissions', async () => {
    const harness = createHarness('immo-host-broker');
    const sentropic = await enroll(harness, 'sentropic');
    if (!(await isEnrollOutcome(sentropic))) throw new Error('owner flow failed');
    const otherRepo = await harness.request('/github-app/broker/lease', leaseRequest(sentropic.ref));
    expect(otherRepo.status).toBe(403);
    expect(await otherRepo.json()).toEqual({ error: 'access_denied' });

    const immo = await enroll(harness);
    if (!(await isEnrollOutcome(immo))) throw new Error('owner flow failed');
    harness.forge.tokenGrants({ contents: 'write', metadata: 'read', workflows: 'write' });
    const overbroad = await harness.request('/github-app/broker/lease', leaseRequest(immo.ref));
    expect(overbroad.status).toBe(503);
    expect(await overbroad.json()).toEqual({ error: 'capability_unavailable' });
    expect(harness.forge.revoked).toEqual(['fake-token-1']);
    const status = await harness.request(`/github-app/${immo.ref}/status`, { headers: sessionHeaders() });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ state: 'revoked' });
    expect(harness.invalidations).toMatchObject([{ storageScopeId: 'scope-immo', repoId: 'repo-immo' }]);
  });
});

describe('SG0-app host routes: revocation', () => {
  it('should revoke on the owner request, close leases, and refuse later leases', async () => {
    const harness = createHarness('immo-host-broker');
    const outcome = await enroll(harness);
    if (!(await isEnrollOutcome(outcome))) throw new Error('owner flow failed');
    const lease = await harness.request('/github-app/broker/lease', leaseRequest(outcome.ref));
    expect(lease.status).toBe(200);
    const revoke = await harness.request(`/github-app/${outcome.ref}/revoke`,
      { method: 'POST', headers: enrollPostHeaders() });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ state: 'revoked', installationRef: outcome.ref });
    const afterRevoke = await harness.request('/github-app/broker/lease', leaseRequest(outcome.ref));
    expect(afterRevoke.status).toBe(503);
    expect(await afterRevoke.json()).toEqual({ error: 'capability_unavailable' });
    expect(harness.forge.revoked).toContain('fake-token-1');
    // The fence stays up while dependents confirm: a post-revoke acquisition
    // re-fires the invalidation (same ref and credential epoch).
    expect(harness.invalidations.length).toBeGreaterThanOrEqual(1);
    expect(harness.invalidations[0]).toMatchObject({
      installationRef: outcome.ref, credentialVersion: expect.any(String),
    });
    expect(harness.invalidations.every((event) =>
      event.installationRef === outcome.ref)).toBe(true);
  });

  it('should accept a signed installation removal event and close the enrollment', async () => {
    const harness = createHarness('immo-host-broker');
    const outcome = await enroll(harness);
    if (!(await isEnrollOutcome(outcome))) throw new Error('owner flow failed');
    const payload = Buffer.from(JSON.stringify({ action: 'deleted', installation: { id: 500 } }));
    const signature = `sha256=${createHmac('sha256', 'fake-webhook-secret').update(payload).digest('hex')}`;
    const events = await harness.request(`/github-app/${outcome.ref}/events`, {
      method: 'POST',
      headers: { 'x-github-delivery': randomUUID(), 'x-github-event': 'installation', 'x-hub-signature-256': signature },
      body: payload,
    });
    expect(events.status).toBe(200);
    const status = await harness.request(`/github-app/${outcome.ref}/status`, { headers: sessionHeaders() });
    expect(await status.json()).toMatchObject({ state: 'revoked' });
    expect(harness.invalidations.length).toBe(1);
  });
});

describe('SG0-app http path fence', () => {
  it('should fence exactly github-app paths for log suppression', () => {
    expect(isGitHubAppPath('/github-app')).toBe(true);
    expect(isGitHubAppPath('/github-app/enroll_xyz/key')).toBe(true);
    expect(isGitHubAppPath('/api/v1/github-app')).toBe(false);
    expect(isGitHubAppPath('/github-applications')).toBe(false);
    expect(isGitHubAppPath('/')).toBe(false);
  });
});
