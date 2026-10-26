import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPostgresArtifactStore, createPostgresLegacyArtifactRecords } from '@sentropic/artifacts/adapters/postgres';
import { createPostgresCommitExecutor } from '@sentropic/artifacts/adapters/postgres-commit';
import { createArtifactCommitCoordinator, type ArtifactInvocationContext } from '@sentropic/artifacts/server/commit-contract';
import { createHttpArtifactApp, type ArtifactApp, type HttpRequest } from '@sentropic/artifacts/http';
import { compileArtifactsProfile, createArtifactsToolExecutor, createRadarKeyDerivation,
  ArtifactProfileInputError, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp-core';
import { ArtifactOperationError, classifyArtifactFailure, projectArtifactHttpOutcome } from '@sentropic/artifacts/server/outcome-contract';
import { createLifecycleService } from '@sentropic/artifacts/server/lifecycle';
import { createPostgresClaimGuardedRefs } from '@sentropic/artifacts/server/gc';
import { createPostgresPublicationUnitWriter, type PublicationBlobStore } from '@sentropic/artifacts/server/publication';
import { createArtifactHostKv } from './host-storage';
import { createArtifactAuthorization, type ArtifactHostIdentity, type CurrentArtifactIdentity } from './authorization';

export interface ArtifactHostOptions {
  pool: Pool;
  blobs: PublicationBlobStore;
  /** Initial cumulative publication-byte budget for a newly mapped workspace. */
  quotaBytes: number;
  currentIdentity: CurrentArtifactIdentity;
}

/** No listeners, migrations, memory defaults, maintenance jobs or activation here. */
export function createArtifactHost(options: ArtifactHostOptions) {
  if (typeof options.currentIdentity !== 'function' || !Number.isSafeInteger(options.quotaBytes) || options.quotaBytes < 0) {
    throw new Error('Artifact host requires current credential authority and an explicit quota');
  }
  // APP-P1 is the explicit W0-close.d input; public extensions need upstream qualification.
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const { pool, blobs } = options;
  const store = createPostgresArtifactStore(pool);
  const scopes = createArtifactHostKv(pool, 'app-artifact-scopes/v1');
  async function bind(verified: ArtifactHostIdentity, workspaceId: string) {
    if (!verified || Object.values(verified).some((value) => typeof value !== 'string' || !value) ||
      !verified.subject || !verified.tenantId || !verified.clientId || !verified.credentialId ||
      verified.subject.includes('|') || !workspaceId) throw new ArtifactOperationError('access_denied');
    // APP-P1's frozen delimiter-based key codec requires a subject domain without '|'.
    const identity = Object.freeze({ ...verified });
    const authority = (storageScopeId: string) => createArtifactAuthorization({ ...options, identity, workspaceId, storageScopeId });
    if (!(await authority('').current()).readable) throw new ArtifactOperationError('access_denied');
    const key = JSON.stringify([identity.tenantId, workspaceId]);
    await scopes.putIfAbsent(key, randomUUID());
    const storageScopeId = await scopes.get(key);
    if (!storageScopeId || !/^[0-9a-f-]{36}$/.test(storageScopeId)) throw new Error('Invalid artifact scope mapping');
    await pool.query('INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [storageScopeId, identity.tenantId]);
    const scope = await pool.query('SELECT org_id FROM artifacts.storage_scopes WHERE id = $1', [storageScopeId]);
    if (scope.rows[0]?.org_id !== identity.tenantId) throw new Error('Artifact scope authority mismatch');
    await createArtifactHostKv(pool, storageScopeId).putIfAbsent('quota/v1',
      JSON.stringify({ maxBytes: options.quotaBytes, usedBytes: 0 }));
    const authorization = authority(storageScopeId);
    const invocation: ArtifactInvocationContext = Object.freeze({ invocationId: randomUUID(),
      actorId: identity.subject, storageScopeId, authorizeCommit: authorization.guard });
    const coordinator = createArtifactCommitCoordinator({ executor: createPostgresCommitExecutor(pool), policy: authorization.policy });
    const application = (artifactId?: string) => createHttpArtifactApp({ profile, coordinator, legacyRecords: createPostgresLegacyArtifactRecords(pool),
      derivation: createRadarKeyDerivation({ storageScopeId, actorIds: [identity.subject] }),
      acls: store, lifecycle: createLifecycleService(store),
      ensureHost: {
        async lockBinding(client, input) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [JSON.stringify([input.storageScopeId, input.ownerId, input.bindingName])]);
        },
        resolveBinding: (client, input) => createPostgresArtifactStore(client as unknown as Pool)
          .ensureArtifact({ ...input, profile: {} }),
        // Ensure's binding is wholly transactional: denial rolls it back, with no external preparation.
        async abandonAttempt() {},
        readPolicyRevision: async () => (await authorization.current()).revision,
      },
      publication: { blobs, intents: store, refs: createPostgresClaimGuardedRefs(store, createPostgresCommitExecutor(pool)),
        createUnitWriter: createPostgresPublicationUnitWriter,
        locks: { 'artifact-lifecycle': [async (client) => {
          await client.query('SELECT id FROM artifacts.artifacts WHERE id = $1 AND storage_scope_id = $2 FOR UPDATE',
            [artifactId, storageScopeId]);
        }] },
        async getCurrent(artifactId) {
          const id = await store.getCurrentReleaseId(artifactId);
          return id === undefined ? undefined : store.getRelease(id);
        },
      },
    });
    const app: ArtifactApp = { selectedCapabilities: profile.selectedCapabilities, profileDigest: profile.profileDigest,
      async execute(request, supplied) {
        const capability = profile.capabilityForRoute(request.method, request.path);
        try {
          if (supplied !== invocation) throw new ArtifactOperationError('access_denied');
          if (capability) {
            // Public app bodies follow the closed profile, including host-only scope fields.
            if (request.method === 'POST') profile.validate(capability, request.body ?? {}, request.idempotencyKey);
            const current = await authorization.current();
            if (!current.readable || (['artifacts_ensure', 'artifacts_publish'].includes(capability) && !current.writable)) {
              throw new ArtifactOperationError('access_denied');
            }
          }
          const body = request.body as { artifactId?: unknown } | undefined;
          const artifactId = capability === 'artifacts_publish' && typeof body?.artifactId === 'string' ? body.artifactId : undefined;
          // Each call captures its own lock target; concurrent calls cannot exchange object authority.
          const outcome = await application(artifactId).execute(request, { ...invocation, invocationId: randomUUID() });
          if (outcome.ok && ['artifacts_list', 'artifacts_get'].includes(capability ?? '') && !(await authorization.current()).readable) {
            throw new ArtifactOperationError('access_denied');
          }
          return outcome;
        } catch (cause) {
          return { ok: false, failure: classifyArtifactFailure(cause, { invocationId: invocation.invocationId,
            operation: capability ?? 'unsupported', phase: 'host_authority', commitState: 'not_committed' },
          (error) => error instanceof ArtifactProfileInputError ? new ArtifactOperationError(error.category) : undefined) };
        }
      },
      async handle(request, supplied) { return projectArtifactHttpOutcome(await app.execute(request, supplied)); },
    };
    Object.freeze(app);
    const executor = createArtifactsToolExecutor({ app, profile });
    return { profile, invocation, app,
      http: (request: Omit<HttpRequest, 'actorId' | 'storageScopeId'>) => app.handle({ ...request,
        actorId: invocation.actorId, storageScopeId }, invocation),
      mcp: (input: Omit<Parameters<typeof executor.invoke>[0], 'invocation'>) => executor.invoke({ ...input, invocation }),
    };
  }
  return { bind, profile, store, blobs };
}
