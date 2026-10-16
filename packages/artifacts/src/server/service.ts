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

export interface EnsurePrivateViewInput {
  actorUserId: string;
  ownerId: string;
  storageScopeId: string;
  bindingName: string;
  idempotencyKey: string;
  paramsHash: string;
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
        input.idempotencyKey,
        input.paramsHash,
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
