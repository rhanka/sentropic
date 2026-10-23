/**
 * L-5a — artifact service wiring: one service for HTTP and MCP.
 *
 * The service composes the tested modules in a fixed order: authorization
 * first (a forged actor creates nothing, not even a binding or an
 * idempotency record), then idempotent execution of the binding ensure.
 * Storage and UUIDs come from injected ports only; there is no implicit
 * in-memory default (callers pass explicit ports, fail-closed).
 */
import { describe, expect, it } from 'vitest';
import { createArtifactService } from '../src/server/service.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';

function makeService() {
  return createArtifactService({ kv: createMemoryKv(), uuid: createCryptoUuid() });
}

const VIEW = {
  ownerId: 'owner-1',
  storageScopeId: 'scope-1',
  bindingName: 'site',
};

describe('artifact service', () => {
  it('creates one private view and replays it', async () => {
    const service = makeService();
    const first = await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-1',
      paramsHash: 'h-1',
      ...VIEW,
    });
    expect(first.created).toBe(true);
    expect(first.replayed).toBe(false);
    const second = await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-1',
      paramsHash: 'h-1',
      ...VIEW,
    });
    expect(second.artifactId).toBe(first.artifactId);
    expect(second.replayed).toBe(true);
  });

  it('creates nothing for a forged actor', async () => {
    const service = makeService();
    await expect(
      service.ensurePrivateView({
        actorUserId: 'owner-2',
        idempotencyKey: 'k-evil',
        paramsHash: 'h-1',
        ...VIEW,
      }),
    ).rejects.toThrow(/access denied/);
    const legit = await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-legit',
      paramsHash: 'h-1',
      ...VIEW,
    });
    expect(legit.created).toBe(true);
  });

  it('surfaces idempotency conflicts', async () => {
    const service = makeService();
    await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-1',
      paramsHash: 'h-1',
      ...VIEW,
    });
    await expect(
      service.ensurePrivateView({
        actorUserId: 'owner-1',
        idempotencyKey: 'k-1',
        paramsHash: 'h-1',
        ...VIEW,
        bindingName: 'other',
      }),
    ).rejects.toThrow(/idempotency conflict/);
  });

  it('should isolate identical keys between principals', async () => {
    const service = makeService();
    const ensure = (ownerId: string) => service.ensurePrivateView({
      ...VIEW, ownerId, actorUserId: ownerId, idempotencyKey: 'shared', paramsHash: 'forged',
    });
    const first = await ensure('alice');
    const second = await ensure('bob');
    expect(second.artifactId).not.toBe(first.artifactId);
    expect(second.replayed).toBe(false);
  });

  it('should ignore caller hashes and bind validated parameters', async () => {
    const service = makeService();
    const input = { ...VIEW, actorUserId: VIEW.ownerId, idempotencyKey: 'same', paramsHash: 'a' };
    const first = await service.ensurePrivateView(input);
    expect(await service.ensurePrivateView({ ...input, paramsHash: 'b' }))
      .toMatchObject({ artifactId: first.artifactId, replayed: true });
  });
});
