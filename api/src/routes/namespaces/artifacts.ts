import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ArtifactHostIdentity } from '../../services/artifacts/authorization';
import type { ArtifactTransport } from '../../services/artifacts/transport';

export const ARTIFACT_HTTP_PATH = '/resources/artifacts/*';
export interface ArtifactHttpPorts {
  transport(): Promise<ArtifactTransport>;
  identity(context: Context): Promise<{ identity: ArtifactHostIdentity; workspaceId: string } | null>;
  enabled?(): boolean;
}

/** Only APP-P1 HTTP; W3 supplies the distinct trusted activation seam. */
export function createArtifactHttpRouter(ports: ArtifactHttpPorts): Hono {
  const router = new Hono();
  router.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024 }));
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
