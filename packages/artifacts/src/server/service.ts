/**
 * L-5a — artifact service (spec-v8 §9).
 *
 * One service for both HTTP and MCP: it composes authorization, idempotent
 * execution and stable bindings in a fixed order. Authorization runs first
 * so a forged actor creates nothing — no binding, no idempotency record.
 * Storage and UUIDs come from injected ServerPorts only; there is no
 * implicit default store (fail-closed construction).
 */
import { assertArtifactAccess } from './authorization.js';
import { createBindingService } from './bindings.js';
import { createIdempotencyStore } from './idempotency.js';
import type { ServerPorts } from './ports.js';
import { manifestDigest } from '../codecs.js';

export interface EnsurePrivateViewInput {
  actorUserId: string;
  ownerId: string;
  storageScopeId: string;
  bindingName: string;
  idempotencyKey: string;
  /** @deprecated Ignored; the service computes its own hash. */
  paramsHash?: string;
  /** Validated provider parameters supplied by the application layer. */
  parameters?: Record<string, string | number | boolean | null>;
}

export interface EnsurePrivateViewResult {
  artifactId: string;
  created: boolean;
  replayed: boolean;
}

export interface ArtifactService {
  ensurePrivateView(input: EnsurePrivateViewInput): Promise<EnsurePrivateViewResult>;
}

/** Create the artifact service over explicit injected ports (no defaults). */
export function createArtifactService(ports: ServerPorts): ArtifactService {
  const bindings = createBindingService(ports.kv, ports.uuid);
  const idempotent = createIdempotencyStore(ports.kv);
  return {
    async ensurePrivateView(input: EnsurePrivateViewInput): Promise<EnsurePrivateViewResult> {
      assertArtifactAccess({
        actorUserId: input.actorUserId,
        artifactOwnerId: input.ownerId,
        action: 'mutate',
      });
      const { result, replayed } = await idempotent.execute(
        JSON.stringify(['ensure', input.actorUserId, input.idempotencyKey]),
        manifestDigest({
          schemaVersion: 'artifacts/v1', ownerId: input.ownerId,
          storageScopeId: input.storageScopeId, bindingName: input.bindingName,
          parameters: input.parameters ?? {},
        }),
        () =>
          bindings.ensure({
            ownerId: input.ownerId,
            storageScopeId: input.storageScopeId,
            bindingName: input.bindingName,
          }),
      );
      return { artifactId: result.artifactId, created: result.created, replayed };
    },
  };
}
