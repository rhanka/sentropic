import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomBytes } from 'node:crypto';
import { GitAppError } from './contracts.js';
import type { GitAppOwnerRepository } from './contracts.js';
import type { GitHubAppEnrollment } from './enrollment.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

/** Mount inside cluster-mesh. Both authenticators are mandatory host adapters. */
export const createGitHubAppRouter = (input: {
  service: GitHubAppEnrollment;
  publicBaseUrl: string;
  resolveOwner(request: Request): Promise<GitAppOwnerRepository | null>;
  authenticateBroker(request: Request): Promise<{ storageScopeId: string; repoId: string } | null>;
}) => {
  const app = new Hono();
  const owner = async (request: Request) => {
    const target = await input.resolveOwner(request);
    if (!target) throw new GitAppError('access_denied');
    return target;
  };
  const csrf = (request: Request) => {
    if (request.headers.get('origin') !== new URL(input.publicBaseUrl).origin) throw new GitAppError('access_denied');
  };
  app.use('*', async (c, next) => {
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    c.header('x-content-type-options', 'nosniff');
    c.header('content-security-policy', "default-src 'none'; form-action https://github.com 'self'; base-uri 'none'; frame-ancestors 'none'");
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'invalid_request' }, 413) }));
  app.onError((error, c) => {
    const code = error instanceof GitAppError ? error.code : 'capability_unavailable';
    return c.json({ error: code }, code === 'access_denied' ? 403 : code === 'invalid_request' ? 400 : 503);
  });
  app.get('/github-app', async (c) => {
    const target = await owner(c.req.raw);
    return c.html(`<html><body><form method="post" action="/github-app/enroll"><button>Enroll ${escapeHtml(target.locator)}</button></form></body></html>`);
  });
  app.post('/github-app/enroll', async (c) => {
    csrf(c.req.raw);
    const started = await input.service.begin(await owner(c.req.raw));
    return c.redirect(started.promptUrl, 303);
  });
  app.get('/github-app/:ref', async (c) => {
    const prompt = await input.service.prompt(await owner(c.req.raw), c.req.param('ref'));
    return c.html(`<html><body><form method="post" action="${escapeHtml(prompt.manifestUrl)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(prompt.manifest))}"><button>Enroll ${escapeHtml(prompt.locator)}</button></form></body></html>`);
  });
  app.get('/github-app/:ref/manifest', async (c) => {
    const result = await input.service.convert(await owner(c.req.raw), c.req.param('ref'), {
      state: c.req.query('state') ?? '', code: c.req.query('code') ?? '',
    });
    return c.redirect(result.installationUrl, 303);
  });
  app.get('/github-app/:ref/installation', async (c) => {
    await input.service.install(await owner(c.req.raw), c.req.param('ref'), {
      state: c.req.query('state') ?? '', installationId: c.req.query('installation_id') ?? '',
    });
    // Drop the sensitive GitHub query string immediately.
    return c.redirect(`/github-app/${c.req.param('ref')}/status`, 303);
  });
  app.get('/github-app/:ref/status', async (c) =>
    c.json(await input.service.status(await owner(c.req.raw), c.req.param('ref'))));
  app.get('/github-app/:ref/rotation', async (c) => {
    const status = await input.service.status(await owner(c.req.raw), c.req.param('ref'));
    const path = `/github-app/${escapeHtml(status.installationRef)}`;
    return c.html(`<html><body><form method="post" action="${path}/key" enctype="multipart/form-data"><input type="file" name="privateKey" accept=".pem" required><button>Verify and switch App key</button></form><form method="post" action="${path}/webhook-stage"><button>Stage webhook secret (10 minute overlap)</button></form><form method="post" action="${path}/webhook-switch"><button>Switch GitHub webhook sender</button></form><form method="post" action="${path}/revoke"><button>Revoke enrollment</button></form></body></html>`);
  });
  app.post('/github-app/:ref/key', async (c) => {
    csrf(c.req.raw);
    const target = await owner(c.req.raw);
    const body = await c.req.parseBody();
    if (!(body.privateKey instanceof File) || body.privateKey.size > 32768) throw new GitAppError('invalid_request');
    return c.json(await input.service.rotateAppKey(target, c.req.param('ref'), await body.privateKey.text()));
  });
  app.post('/github-app/:ref/webhook-stage', async (c) => {
    csrf(c.req.raw);
    return c.json(await input.service.rotateWebhook(await owner(c.req.raw), c.req.param('ref'), randomBytes(32).toString('hex'), 600000));
  });
  app.post('/github-app/:ref/webhook-switch', async (c) => {
    csrf(c.req.raw);
    return c.json(await input.service.switchWebhookSender(await owner(c.req.raw), c.req.param('ref')));
  });
  app.post('/github-app/:ref/revoke', async (c) => {
    csrf(c.req.raw);
    return c.json(await input.service.revoke(await owner(c.req.raw), c.req.param('ref'), 'owner_revoked'));
  });
  app.post('/github-app/:ref/events', async (c) => {
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    if (!c.req.header('x-github-delivery')) throw new GitAppError('invalid_request');
    return c.json(await input.service.installationEvent(c.req.param('ref'), rawBody,
      c.req.header('x-hub-signature-256') ?? '', c.req.header('x-github-event') ?? ''));
  });
  app.post('/github-app/broker/lease', async (c) => {
    const principal = await input.authenticateBroker(c.req.raw);
    if (!principal) throw new GitAppError('access_denied');
    const body = await c.req.json();
    if (!body || Object.keys(body).sort().join(',') !== 'installationRef,repoId,storageScopeId' ||
        Object.values(body).some((value) => typeof value !== 'string' || !value)) throw new GitAppError('invalid_request');
    if (body.repoId !== principal.repoId || body.storageScopeId !== principal.storageScopeId) throw new GitAppError('access_denied');
    return c.json(await input.service.acquire(body));
  });
  app.post('/github-app/broker/verify', async (c) => {
    const principal = await input.authenticateBroker(c.req.raw);
    if (!principal) throw new GitAppError('access_denied');
    const body = await c.req.json();
    if (!body || Object.keys(body).sort().join(',') !== 'deliveryId,rawBody,repoId,signature,storageScopeId,webhookSecretRef' ||
        Object.values(body).some((value) => typeof value !== 'string')) throw new GitAppError('invalid_request');
    if (body.repoId !== principal.repoId || body.storageScopeId !== principal.storageScopeId) throw new GitAppError('access_denied');
    const rawBody = Buffer.from(body.rawBody, 'base64');
    if (rawBody.toString('base64') !== body.rawBody) throw new GitAppError('invalid_request');
    return c.json(await input.service.verify({ ...body, rawBody }));
  });
  return app;
};
