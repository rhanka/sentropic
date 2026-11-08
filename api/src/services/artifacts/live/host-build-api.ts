import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LiveError, type LiveKey } from './records';
import type { BuildJobRecord, BuildJobs } from './build-jobs';

/** Host build API served by Sentropic as `sentropic-app` (the only controller identity, A-LIVE §9.1).
 * The scope comes from the authenticated host service identity, never from the body; a job is named by id, never by
 * SHA, and the builder resolves it against the host's pending job (`publication.job`). Building is asynchronous. */
export interface HostIdentity { hostId: string; storageScopeId: string }
const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Context of the host build API: the identity resolved by `authenticate`. */
export type HostBuildEnv = { Variables: { identity: HostIdentity } };
/** S2S host gate of the builder mount: the bound host identity, or 403 host_not_bound before the body is read. */
export const hostGate = (authenticate: (c: Context) => HostIdentity | null): MiddlewareHandler<HostBuildEnv> => async (c, next) => {
  let identity: HostIdentity | null = null;
  try { identity = authenticate(c); } catch { /* host_not_bound below */ }
  if (!identity || !ID.test(identity.storageScopeId)) return c.json({ error: 'host_not_bound' }, 403);
  c.set('identity', identity); await next();
};
const view = (record: BuildJobRecord) => ({ jobId: record.jobId, state: record.state,
  ...(record.code ? { code: record.code } : {}), ...(record.reason ? { reason: record.reason } : {}),
  ...(record.receipt ? { releaseId: record.receipt.releaseId } : {}) });

export function createHostBuildApi(options: {
  /** Host identity of the verified service client (`hostAuthenticator`); null refuses before the body is read. */
  authenticate(c: Context): HostIdentity | null;
  jobs: BuildJobs;
  /** Runs one explicit clean build to publication (controller.buildOnly). */
  build(key: LiveKey, jobId: string): Promise<void>;
  /** Background executor owned by the composition; nothing starts on import. */
  schedule(work: () => Promise<void>): void;
}) {
  const app = new Hono<HostBuildEnv>();
  app.use('*', hostGate(options.authenticate));
  const key = (c: Context<HostBuildEnv>, artifactId: string): LiveKey => ({ storageScopeId: c.get('identity').storageScopeId, artifactId });
  async function run(k: LiveKey, jobId: string, token: string) {
    try {
      await options.build(k, jobId);
      if ((await options.jobs.read(k, jobId))?.state !== 'published') await options.jobs.fail(k, jobId, token, 'git_live_conflict', 'superseded');
    } catch (error) {
      await options.jobs.fail(k, jobId, token, error instanceof LiveError ? error.code : 'builder_unavailable',
        error instanceof LiveError ? error.reason : undefined);
    }
  }
  app.post('/v1/builds', bodyLimit({ maxSize: 2048, onError: c => c.json({ error: 'payload_too_large' }, 413) }), async c => {
    // An over-limit body fails this read inside bodyLimit (413); only the JSON parse is caught.
    const raw = await c.req.text(); let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* invalid_request below */ }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join() !== 'artifactId,jobId'
      || typeof body.artifactId !== 'string' || !ID.test(body.artifactId) || typeof body.jobId !== 'string' || !ID.test(body.jobId)) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const k = key(c, body.artifactId); const jobId = body.jobId;
    const { record, run: start } = await options.jobs.admit(k, jobId);
    if (start) options.schedule(() => run(k, jobId, record.token));
    return c.json(view(record), record.state === 'published' ? 200 : 202);
  });
  app.get('/v1/builds/:artifactId/:jobId', async c => {
    const { artifactId, jobId } = c.req.param();
    if (!ID.test(artifactId) || !ID.test(jobId)) return c.json({ error: 'invalid_request' }, 400);
    const record = await options.jobs.read(key(c, artifactId), jobId);
    return record ? c.json(view(record)) : c.json({ error: 'not_found' }, 404);
  });
  return app;
}
