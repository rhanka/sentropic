import { describe, expect, it, vi } from 'vitest';
import {
  resolveRemoteCall,
  type RemoteBoundDefinition,
  type RemoteClientPortV1,
} from '../src/registry-remote-binding.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
};

const DEFINITION: RemoteBoundDefinition = {
  kind: 'remote-bound',
  providerId: 'immo-remote',
  version: '1.0.0',
  toolNames: ['immo.price.estimate'],
  clientPort: 'registry.remoteClient/v1',
};

function clientPort(): RemoteClientPortV1 & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    version: 'v1',
    calls,
    forward: vi.fn(async (canonicalText: string) => {
      calls.push([canonicalText]);
      return { ok: true };
    }),
  };
}

describe('remote-bound seam (pure, zero side-effects on invalid candidates)', () => {
  it('forwards the canonical request through the injected versioned port', async () => {
    const client = clientPort();
    const result = await resolveRemoteCall(
      [DEFINITION],
      ['immo-remote'],
      { [DEFINITION.clientPort]: client },
      SCHEMA,
      { tool: 'immo.price.estimate', args: { surface: 80 } },
    );
    expect(result).toEqual({ ok: true });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.[0]).toBe(
      '{"args":{"surface":80},"tool":"immo.price.estimate"}',
    );
  });

  it('rejects unknown tool names without acquiring any resource', async () => {
    const client = clientPort();
    await expect(
      resolveRemoteCall([DEFINITION], ['immo-remote'], { [DEFINITION.clientPort]: client }, SCHEMA, {
        tool: 'nope.tool',
        args: {},
      }),
    ).rejects.toThrow(/Unknown tool/);
    expect(client.calls).toHaveLength(0);
  });

  it('rejects unselected providers without acquiring any resource', async () => {
    const client = clientPort();
    await expect(
      resolveRemoteCall([DEFINITION], ['other-provider'], { [DEFINITION.clientPort]: client }, SCHEMA, {
        tool: 'immo.price.estimate',
        args: { surface: 80 },
      }),
    ).rejects.toThrow(/not selected/);
    expect(client.calls).toHaveLength(0);
  });

  it('rejects schema mismatches before forwarding', async () => {
    const client = clientPort();
    await expect(
      resolveRemoteCall([DEFINITION], ['immo-remote'], { [DEFINITION.clientPort]: client }, SCHEMA, {
        tool: 'immo.price.estimate',
        args: { surface: 1 },
      }),
    ).rejects.toThrow(/out of bounds/);
    expect(client.calls).toHaveLength(0);
  });

  it('refuses a missing or mis-versioned client port without forwarding', async () => {
    await expect(
      resolveRemoteCall([DEFINITION], ['immo-remote'], {}, SCHEMA, {
        tool: 'immo.price.estimate',
        args: { surface: 80 },
      }),
    ).rejects.toThrow(/client port/);
    await expect(
      resolveRemoteCall([DEFINITION], ['immo-remote'], { [DEFINITION.clientPort]: { version: 'v9' } }, SCHEMA, {
        tool: 'immo.price.estimate',
        args: { surface: 80 },
      }),
    ).rejects.toThrow(/version/);
  });
});
