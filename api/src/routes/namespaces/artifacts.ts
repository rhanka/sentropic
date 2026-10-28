import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ArtifactHostIdentity } from '../../services/artifacts/authorization';
import type { ArtifactTransport } from '../../services/artifacts/transport';
import type { ArtifactReaderTarget, createArtifactReaderActivation } from '../../services/artifacts/reader-activation';

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
}

const readerTarget = z.object({ artifactId: z.uuid(), releaseId: z.uuid(),
  channel: z.enum(['stable', 'pinned']), targetOrigin: z.string().max(256),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/) }).strict();

/** APP-P1 dispatch and a separate host reader port; activation is never a public tool. */
export function createArtifactHttpRouter(ports: ArtifactHttpPorts): Hono {
  const router = new Hono();
  router.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  router.post('/reader-activation', bodyLimit({ maxSize: 4096 }), async context => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    if ((ports.enabled && !ports.enabled()) || !ports.reader?.enabled()) return context.json({ error: 'not_found' }, 404);
    if (context.req.header('origin') !== ports.reader.controlOrigin) return context.json({ error: 'access_denied' }, 403);
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
