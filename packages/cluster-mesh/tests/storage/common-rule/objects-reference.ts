// Independent test oracle; never imports a production encoder or blob store.
import { createHash } from 'node:crypto';
import { validateCommonManifestBody } from '../../../src/storage/common-contract.js';
import type { CommonManifestBody, EncodedManifest, ObjectClient, ObjectFixture, ObjectRef } from './kit.js';

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const encodeManifest = (body: CommonManifestBody): EncodedManifest => {
  if (body.commonContract !== '1' || body.manifestVersion !== '1') throw new Error('unsupported version');
  if (!validateCommonManifestBody(body).ok) throw new Error('incomplete manifest');
  const { commonContract, manifestVersion, module, scope, surface, incarnation, publicationId,
    predecessorRoot, sourceBoundary, schemaVersion, descriptorVersion, encodingVersion, units, objects, terminal } = body;
  const kinds = { transactional: 'journal-head', analytical: 'batch-snapshot', 'live-graph': 'projection-generation' };
  if (sourceBoundary.kind !== kinds[surface]) throw new Error('wrong source boundary');
  const bytes = Buffer.from(JSON.stringify({ commonContract, manifestVersion, module,
    scope: { tenantId: scope.tenantId, workspaceId: scope.workspaceId }, surface, incarnation, publicationId,
    predecessorRoot, sourceBoundary: { kind: sourceBoundary.kind, ref: sourceBoundary.ref },
    schemaVersion, descriptorVersion, encodingVersion,
    units: units.map(({ unitId, roots }) => ({ unitId, roots: [...roots] })),
    objects: [...objects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(({ id, locator, byteLength, sha256 }) => ({ id, locator, byteLength, sha256 })),
    terminal: { count: terminal.count, complete: terminal.complete } }), 'utf8');
  return { bytes, sha256: sha256(bytes) };
};

type Stored = { ref: ObjectRef; bytes: Uint8Array };
const key = (ref: ObjectRef): string => JSON.stringify([ref.scope, ref.id]);
export const createObjectReference = (store = new Map<string, Stored>()): ObjectFixture => {
  const counters = { io: 0, encodes: 0, verifiedBytes: 0 };
  const client = (scope: string): ObjectClient => {
    const entry = (ref: ObjectRef): void => {
      if (ref.scope !== scope) throw new Error('denied');
      if (ref.version !== '1') throw new Error('unsupported version');
    };
    return {
      preparer: { async create(ref, input) {
        entry(ref);
        const bytes = Uint8Array.from(input);
        const owned = { ...ref };
        await Promise.resolve(); // Contenders interleave before the atomic map decision.
        counters.io++;
        if (sha256(bytes) !== owned.sha256 || bytes.byteLength !== owned.byteLength ||
          (owned.id.startsWith('sha256:') && owned.id !== `sha256:${owned.sha256}`)) throw new Error('corrupt');
        const previous = store.get(key(owned));
        if (previous && (previous.ref.sha256 !== owned.sha256 || previous.ref.locator !== owned.locator ||
          !Buffer.from(previous.bytes).equals(bytes))) throw new Error('conflict');
        if (!previous) store.set(key(owned), { ref: owned, bytes });
        return { ...(previous?.ref ?? owned) };
      } },
      reader: { async read(ref, budget) {
        entry(ref);
        if (!Number.isSafeInteger(budget.maxBytes) || budget.maxBytes < ref.byteLength ||
          !Number.isSafeInteger(budget.maxObjects) || budget.maxObjects < 1) throw new Error('limit');
        counters.io++;
        const stored = store.get(key(ref));
        if (!stored) throw new Error('unavailable');
        if (stored.ref.scope !== ref.scope || stored.ref.version !== ref.version ||
          stored.ref.locator !== ref.locator || stored.bytes.byteLength !== ref.byteLength ||
          sha256(stored.bytes) !== ref.sha256) throw new Error('corrupt');
        counters.verifiedBytes += stored.bytes.byteLength;
        return Uint8Array.from(stored.bytes);
      } },
    };
  };
  const fixture: ObjectFixture = {
    clients: [client('workspace-a'), client('workspace-a')], client, counters,
    reopen: () => createObjectReference(store),
    encode(body) {
      if (body.commonContract !== '1' || body.manifestVersion !== '1') throw new Error('unsupported version');
      counters.encodes++;
      return encodeManifest(body);
    },
    async verify(body, digest, budget) {
      let bytesLeft = budget.maxBytes, objectsLeft = budget.maxObjects;
      if (!Number.isSafeInteger(bytesLeft) || bytesLeft < 1 ||
        !Number.isSafeInteger(objectsLeft) || objectsLeft < 1) throw new Error('limit');
      const walk = async (page: CommonManifestBody, expected: string): Promise<void> => {
        const encoded = fixture.encode(page);
        if (encoded.sha256 !== expected) throw new Error('manifest commitment');
        if (page.module !== 'comments' || page.incarnation !== 'store-1' ||
          page.scope.tenantId !== 'tenant-a' || page.scope.workspaceId !== 'workspace-a') throw new Error('denied');
        bytesLeft -= encoded.bytes.byteLength;
        if (bytesLeft < 0) throw new Error('limit');
        page = JSON.parse(Buffer.from(encoded.bytes).toString('utf8')) as CommonManifestBody;
        for (const object of page.objects) {
          if (--objectsLeft < 0) throw new Error('limit');
          const ref = { ...object, scope: page.scope.workspaceId, version: '1' };
          const bytes = await fixture.client(page.scope.workspaceId).reader.read(ref, { maxBytes: bytesLeft, maxObjects: 1 });
          bytesLeft -= bytes.byteLength;
          // This fixture reserves manifest/ locators for transitively committed pages.
          if (object.locator.startsWith('manifest/')) await walk(JSON.parse(Buffer.from(bytes).toString('utf8')), object.sha256);
        }
      };
      await walk(body, digest);
    },
    inspect: (ref) => Uint8Array.from(store.get(key(ref))?.bytes ?? []),
    fault(ref, change) {
      const stored = store.get(key(ref));
      if (!stored) throw new Error('missing fault target');
      if (change === 'delete') store.delete(key(ref));
      else if (change === 'truncate') stored.bytes = stored.bytes.slice(0, -1);
      else if (change === 'corrupt') stored.bytes[0] ^= 1;
      else stored.ref = { ...stored.ref, [change]: 'foreign' };
    },
  };
  return fixture;
};
