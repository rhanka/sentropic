import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as Y from 'yjs';
import { Server } from '@hocuspocus/server';
import { H3_DEPENDENCY_CLOSURE, assertHarnessForDsWitness8, runOfflineHarness } from '../../src/services/canvas-live/harness';
import type { FieldBindingIdentity } from '../../src/services/canvas-live/contracts';
import { admissionRecord, docOf, registryFixture } from '../helpers/canvas-live-h3';

const require = createRequire(import.meta.url);

function installedVersion(specifier: string): string {
  let dir: string;
  try {
    dir = dirname(require.resolve(specifier));
  } catch {
    // Exports-only packages (y-protocols) expose no main; their manifest is the stable subpath.
    dir = dirname(require.resolve(`${specifier}/package.json`));
  }
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string') return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package manifest not found for ${specifier}`);
    dir = parent;
  }
}

function checkpointedServer(existing?: Map<string, Uint8Array>) {
  const checkpoints = existing ?? new Map<string, Uint8Array>();
  const server = new Server({
    port: 0,
    onLoadDocument: async ({ document, documentName }) => {
      const bytes = checkpoints.get(documentName);
      if (bytes) Y.applyUpdate(document, bytes);
    },
    onStoreDocument: async ({ document, documentName }) => {
      checkpoints.set(documentName, Y.encodeStateAsUpdate(document));
    },
  });
  return { server, checkpoints };
}

describe('canvas live offline harness', () => {
  it('should record the dependency closure installed in the workspace', () => {
    for (const [name, expected] of Object.entries(H3_DEPENDENCY_CLOSURE())) {
      expect(installedVersion(name)).toBe(expected);
    }
  });

  it('should complete DS witness 8 against the in-memory double', async () => {
    const record = admissionRecord();
    const { registry } = registryFixture();
    const result = await runOfflineHarness({
      provider: 'in-memory-double',
      registry,
      record,
      applyRemoteText: (identity, text) => {
        (registry.resolveBinding(record, identity).text as Y.Text).insert(0, text);
      },
      readText: (identity) => (registry.resolveBinding(record, identity).text as Y.Text).toString(),
    });
    expect(result.provider).toBe('in-memory-double');
    assertHarnessForDsWitness8(result);
  });

  it('should complete DS witness 8 against the real in-process Hocuspocus server', async () => {
    const record = admissionRecord();
    const { registry } = registryFixture();
    const { server, checkpoints } = checkpointedServer();
    await server.listen();
    const docName = (identity: FieldBindingIdentity) =>
      `${identity.documentId}:${identity.sessionId}:${identity.fieldKey}`;
    const result = await runOfflineHarness({
      provider: 'hocuspocus',
      registry,
      record,
      applyRemoteText: async (identity, text) => {
        const name = docName(identity);
        const connection = await server.hocuspocus.openDirectConnection(name);
        const client = new Y.Doc({ gc: false });
        Y.applyUpdate(client, Y.encodeStateAsUpdate(connection.document!));
        const before = Y.encodeStateVector(client);
        client.getText(`field:${identity.fieldKey}`).insert(0, text);
        await connection.transact((d) => {
          Y.applyUpdate(d, Y.encodeStateAsUpdate(client, before));
        });
        server.hocuspocus.flushPendingStores();
        const authoritativeBytes = Y.encodeStateAsUpdate(connection.document!);
        await connection.disconnect();
        Y.applyUpdate(docOf(registry, record, identity.fieldKey), authoritativeBytes);
      },
      readText: (identity) => docOf(registry, record, identity.fieldKey).getText(`field:${identity.fieldKey}`).toString(),
    });
    expect(result.provider).toBe('hocuspocus');
    assertHarnessForDsWitness8(result);
    expect(checkpoints.size).toBeGreaterThan(0);
    await server.destroy();
  });

  it('should reproduce a checkpointed document after a real server kill and restart', async () => {
    const record = admissionRecord(['description']);
    const name = `${record.documentId}:${record.sessionId}:description`;
    const first = checkpointedServer();
    await first.server.listen();
    const writer = await first.server.hocuspocus.openDirectConnection(name);
    await writer.transact((d) => {
      d.getText('field:description').insert(0, 'kill-restart-proof');
    });
    first.server.hocuspocus.flushPendingStores();
    await writer.disconnect();
    expect(first.checkpoints.get(name)).toBeDefined();
    await first.server.destroy();
    const second = checkpointedServer(first.checkpoints);
    await second.server.listen();
    const reader = await second.server.hocuspocus.openDirectConnection(name);
    const reproduction = new Y.Doc({ gc: false });
    Y.applyUpdate(reproduction, Y.encodeStateAsUpdate(reader.document!));
    expect(reproduction.getText('field:description').toString()).toBe('kill-restart-proof');
    const replay = Y.encodeStateAsUpdate(reproduction);
    await reader.transact((d) => {
      Y.applyUpdate(d, replay);
    });
    expect(reproduction.getText('field:description').toString()).toBe('kill-restart-proof');
    await reader.disconnect();
    await second.server.destroy();
  });
});
