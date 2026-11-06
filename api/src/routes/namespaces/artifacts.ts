import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { isAdmin } from '../../middleware/rbac';
import type { ArtifactHostIdentity } from '../../services/artifacts/authorization';
import type { ArtifactTransport } from '../../services/artifacts/transport';
import type { ArtifactReaderTarget, createArtifactReaderActivation } from '../../services/artifacts/reader-activation';
import type { ReaderConsentService } from '../../services/artifacts/reader-consent';
import { renderConsentScreen } from '../../services/artifacts/reader-consent-screen';

export const ARTIFACT_HTTP_PATH = '/resources/artifacts/*';
export interface ArtifactHttpPorts {
  transport(): Promise<ArtifactTransport>;
  identity(context: Context): Promise<{ identity: ArtifactHostIdentity; workspaceId: string } | null>;
  enabled?(): boolean;
  reader?: {
    enabled(): boolean;
    controlOrigin: string;
    issue(bound: { identity: ArtifactHostIdentity; workspaceId: string }, target: ArtifactReaderTarget):
      ReturnType<ReturnType<typeof createArtifactReaderActivation>['issue']>;
  };
  readerConsent?: {
    enabled(): boolean;
    controlOrigin: string;
    /** Host-declared consent scopes with current versions (J1.3b, generic grant contract). */
    declaredScopes: readonly { scopeId: string; scopeVersion: string }[];
    /** Neutral screen parameters (J1.3b, generic grant contract). */
    consentScreen: { brand: string; title: string; supportUrl?: string };
    service(bound: { identity: ArtifactHostIdentity; workspaceId: string }, admin: boolean):
      Promise<ReaderConsentService>;
  };
}

const readerTarget = z.object({ artifactId: z.uuid(), releaseId: z.uuid(),
  channel: z.enum(['stable', 'pinned']), targetOrigin: z.string().max(256),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/) }).strict();
const consentScope = z.string().min(1).max(128);
const consentRevokeBody = z.object({ artifactId: z.uuid(), scopeId: consentScope.optional() }).strict();
const consentAllBody = z.object({ artifactId: z.uuid() }).strict();
const consentAdminBody = z.object({ readerAccountId: z.string().min(1).max(256),
  artifactId: z.uuid(), scopeId: consentScope.optional() }).strict();
const consentGateQuery = z.object({ artifactId: z.uuid(), scopeId: consentScope }).strict();
const consentGrantBody = z.object({ artifactId: z.uuid(), scopeId: consentScope, scopeVersion: consentScope }).strict();

/** APP-P1 dispatch and a separate host reader port; activation is never a public tool. */
export function createArtifactHttpRouter(ports: ArtifactHttpPorts): Hono {
  const router = new Hono();
  router.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  router.post('/reader-activation', bodyLimit({ maxSize: 4096 }), async context => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    if ((ports.enabled && !ports.enabled()) || !ports.reader?.enabled()) return context.json({ error: 'not_found' }, 404);
    let controlOrigin: string;
    try { controlOrigin = ports.reader.controlOrigin; }
    catch { return context.json({ error: 'not_found' }, 404); }
    if (context.req.header('origin') !== controlOrigin) return context.json({ error: 'access_denied' }, 403);
    let target: ArtifactReaderTarget;
    try {
      if (!context.req.header('content-type')?.startsWith('application/json')) throw new Error('JSON required');
      target = readerTarget.parse(await context.req.json());
    } catch { return context.json({ error: 'invalid_request' }, 400); }
    try {
      const bound = await ports.identity(context);
      if (!bound) return context.json({ error: 'authentication_required' }, 401);
      const { flow } = await ports.reader.issue(bound, target);
      return context.json({ flowId: flow.flowId, ticketId: flow.ticketId,
        expiresAt: flow.expiresAt, targetOrigin: flow.targetOrigin }, 201);
    } catch { return context.json({ error: 'artifact_reader_refused' }, 403); }
  });
  /**
   * Lot 1a — first-party consent surfaces (never a model tool): the reader id
   * always comes from the verified session, never from a body field. Writes
   * additionally require the control origin; reads ride the session alone.
   */
  const consentPorts = async (context: Context) => {
    if ((ports.enabled && !ports.enabled()) || !ports.readerConsent?.enabled()) return undefined;
    let controlOrigin: string;
    try { controlOrigin = ports.readerConsent.controlOrigin; }
    catch { return undefined; }
    const bound = await ports.identity(context);
    if (!bound || context.get('user')?.userId !== bound.identity.subject) return undefined;
    return { controlOrigin, bound };
  };
  const consentService = async (context: Context, admin: boolean) => {
    const resolved = await consentPorts(context);
    if (!resolved) return undefined;
    if (context.req.method === 'POST' && context.req.header('origin') !== resolved.controlOrigin) return undefined;
    return ports.readerConsent!.service(resolved.bound, admin || isAdmin(context.get('user')));
  };
  router.get('/reader-consents', async context => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    const service = await consentService(context, false);
    if (!service) return context.json({ error: 'not_found' }, 404);
    const user = context.get('user');
    return context.json(await service.listOwnConsents(user.userId));
  });
  router.post('/reader-consents/revoke', bodyLimit({ maxSize: 4096 }), async context => {
    context.header('Cache-Control', 'no-store');
    const service = await consentService(context, false);
    if (!service) return context.json({ error: 'not_found' }, 404);
    try {
      const body = consentRevokeBody.parse(await context.req.json());
      return context.json(await service.revokeOwnConsent({ readerAccountId: context.get('user').userId, ...body }));
    } catch (error) {
      return context.json({ error: error instanceof Error && error.message === 'not_found'
        ? 'not_found' : 'invalid_request' }, error instanceof Error && error.message === 'not_found' ? 404 : 400);
    }
  });
  router.post('/reader-consents/revoke-all', bodyLimit({ maxSize: 4096 }), async context => {
    context.header('Cache-Control', 'no-store');
    const service = await consentService(context, false);
    if (!service) return context.json({ error: 'not_found' }, 404);
    try {
      const body = consentAllBody.parse(await context.req.json());
      return context.json(await service.revokeAllOwnConsents({ readerAccountId: context.get('user').userId, ...body }));
    } catch (error) {
      return context.json({ error: error instanceof Error && error.message === 'not_found'
        ? 'not_found' : 'invalid_request' }, error instanceof Error && error.message === 'not_found' ? 404 : 400);
    }
  });
  router.post('/reader-consents/admin-revoke', bodyLimit({ maxSize: 4096 }), async context => {
    context.header('Cache-Control', 'no-store');
    const service = await consentService(context, true);
    if (!service) return context.json({ error: 'not_found' }, 404);
    try {
      const body = consentAdminBody.parse(await context.req.json());
      return context.json(await service.adminRevokeConsent(body, context.get('user').userId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const status = message === 'not_found' ? 404 : message === 'access_denied' ? 403 : 400;
      return context.json({ error: message === 'not_found' ? 'not_found'
        : message === 'access_denied' ? 'access_denied' : 'invalid_request' }, status as 400);
    }
  });
  /**
   * J1.3b — generic grant contract (first-party, host-declared scopes and
   * versions). The gate answers the typed 403; the single prescribed
   * navigation from it is the sibling screen; the grant posts once and the
   * gate opens with no loop. An unreadable artifact never oracles consent.
   */
  const gatePorts = async (context: Context) => {
    const service = await consentService(context, false);
    if (!service || !ports.readerConsent) return undefined;
    const resolved = await consentPorts(context);
    if (!resolved) return undefined;
    return { service, bound: resolved.bound };
  };
  const declaredScope = (scopeId: string) =>
    ports.readerConsent!.declaredScopes.find((entry) => entry.scopeId === scopeId);
  router.get('/reader-gate', async context => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    const resolved = await gatePorts(context);
    if (!resolved) return context.json({ error: 'not_found' }, 404);
    let query: { artifactId: string; scopeId: string };
    try {
      query = consentGateQuery.parse({ artifactId: context.req.query('artifactId'),
        scopeId: context.req.query('scopeId') });
    } catch { return context.json({ error: 'invalid_request' }, 400); }
    const declared = declaredScope(query.scopeId);
    if (!declared) return context.json({ error: 'not_found' }, 404);
    let rights: 'ok' | 'gone' = 'gone';
    try {
      const probe = await (await ports.transport()).http(resolved.bound.identity,
        resolved.bound.workspaceId, { method: 'GET', path: `/meta/${query.artifactId}`, body: undefined });
      rights = probe.status === 200 ? 'ok' : 'gone';
    } catch { rights = 'gone'; }
    const decision = await resolved.service.evaluateGate({ readerAccountId: context.get('user').userId,
      artifactId: query.artifactId, scopeId: query.scopeId,
      scopeVersion: declared.scopeVersion, rights });
    if (decision.allowed) {
      return context.json({ allowed: true, artifactId: query.artifactId,
        scopeId: query.scopeId, scopeVersion: declared.scopeVersion });
    }
    if (decision.refusal === 'reader_consent_required') {
      return context.json({ code: 'reader_consent_required',
        scopeId: query.scopeId, retryable: false }, 403);
    }
    return context.json({ error: decision.status === 401 ? 'access_denied' : 'not_found' },
      decision.status as 400);
  });
  router.get('/reader-consents/screen', async context => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    const resolved = await gatePorts(context);
    if (!resolved) return context.json({ error: 'not_found' }, 404);
    let query: { artifactId: string; scopeId: string };
    try {
      query = consentGateQuery.parse({ artifactId: context.req.query('artifactId'),
        scopeId: context.req.query('scopeId') });
    } catch { return context.json({ error: 'invalid_request' }, 400); }
    const declared = declaredScope(query.scopeId);
    if (!declared) return context.json({ error: 'not_found' }, 404);
    return context.html(renderConsentScreen({ ...ports.readerConsent!.consentScreen,
      artifactId: query.artifactId, scopeId: query.scopeId, scopeVersion: declared.scopeVersion }));
  });
  router.post('/reader-consents/grant', bodyLimit({ maxSize: 4096 }), async context => {
    context.header('Cache-Control', 'no-store');
    const resolved = await gatePorts(context);
    if (!resolved) return context.json({ error: 'not_found' }, 404);
    try {
      const contentType = context.req.header('content-type') ?? '';
      const raw = contentType.startsWith('application/json') ? await context.req.json() :
        Object.fromEntries(Object.entries(await context.req.parseBody())
          .map(([key, value]) => [key, typeof value === 'string' ? value : '']));
      const body = consentGrantBody.parse(raw);
      const declared = declaredScope(body.scopeId);
      if (!declared) return context.json({ error: 'not_found' }, 404);
      if (body.scopeVersion !== declared.scopeVersion) return context.json({ error: 'invalid_request' }, 400);
      const readerAccountId = context.get('user').userId;
      const granted = await resolved.service.grantWithFreshRights({ readerAccountId,
        artifactId: body.artifactId, scopeId: body.scopeId, scopeVersion: body.scopeVersion },
        () => resolved.service.checkReaderFreshRights({ readerAccountId, artifactId: body.artifactId }));
      return context.json({ granted: true, artifactId: body.artifactId,
        scopeId: body.scopeId, scopeVersion: body.scopeVersion, grantedAt: granted.grantedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return context.json({ error: message === 'access_denied' ? 'access_denied' : 'invalid_request' },
        (message === 'access_denied' ? 403 : 400) as 400);
    }
  });
  const handle = async (context: Context) => {
    if (ports.enabled && !ports.enabled()) return context.json({ error: 'not_found' }, 404);
    let body: unknown;
    if (context.req.method === 'POST') {
      if (!context.req.header('content-type')?.startsWith('application/json')) {
        return context.json({ error: 'invalid_request' }, 400);
      }
      try { body = await context.req.json(); } catch { return context.json({ error: 'invalid_request' }, 400); }
    }
    try {
      const bound = await ports.identity(context);
      if (!bound) return context.json({ error: 'authentication_required' }, 401);
      const path = context.req.method === 'GET' ? `/meta/${context.req.param('artifactId')}`
        : `/${context.req.path.split('/').pop()}`;
      const result = await (await ports.transport()).http(bound.identity, bound.workspaceId, {
        method: context.req.method, path, body, idempotencyKey: context.req.header('idempotency-key'),
      });
      context.header('Cache-Control', 'no-store');
      return context.newResponse(JSON.stringify(result.body), result.status as 200, { 'Content-Type': 'application/json' });
    } catch { return context.json({ error: 'artifact_request_refused' }, 403); }
  };
  for (const path of ['/ensure', '/publish', '/list']) router.post(path, handle);
  router.get('/meta/:artifactId', handle);
  return router;
}
