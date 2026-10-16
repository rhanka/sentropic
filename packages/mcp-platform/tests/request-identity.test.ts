/**
 * Lot 5 — request identity: the identity extracted at the transport boundary
 * (headers for HTTP, environment for stdio) reaches the runner on every
 * call, so authorization can refuse before any tool effect. Absent identity
 * arrives as `undefined`, never as a forged value.
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  registerBridgeTools,
  type BridgeRunner,
  type RequestIdentity,
} from '../src/transport/streamable-http.js';
import type { AppToolResult } from '../src/runtime.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
};

const IDENTITY: RequestIdentity = {
  clientId: 'codex',
  tenantRef: 't-1',
  scopes: ['probe:use'],
  hasBearer: true,
};

async function linkedClient(runner: BridgeRunner, identity?: RequestIdentity) {
  const server = new Server({ name: 'probe', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerBridgeTools(
    server,
    [{ name: 'immo.price.estimate', description: 'Estimate a price', schema: SCHEMA }],
    { run: runner },
    identity === undefined ? {} : { identity },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'probe-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('request identity propagation', () => {
  it('delivers the boundary identity to the runner on every call', async () => {
    const seen: Array<RequestIdentity | undefined> = [];
    const runner: BridgeRunner = async (_tool, _args, identity) => {
      seen.push(identity);
      return { ok: true, output: {}, auditId: 'a', redactionClass: 'low' };
    };
    const client = await linkedClient(runner, IDENTITY);
    await client.callTool({ name: 'immo.price.estimate', arguments: { surface: 80 } });
    await client.callTool({ name: 'immo.price.estimate', arguments: { surface: 81 } });
    expect(seen).toEqual([IDENTITY, IDENTITY]);
    await client.close();
  });

  it('delivers undefined when the boundary provides no identity', async () => {
    const seen: Array<RequestIdentity | undefined> = [];
    const runner: BridgeRunner = async (_tool, _args, identity) => {
      seen.push(identity);
      return { ok: true, output: {}, auditId: 'a', redactionClass: 'low' };
    };
    const client = await linkedClient(runner);
    await client.callTool({ name: 'immo.price.estimate', arguments: { surface: 80 } });
    expect(seen).toEqual([undefined]);
    await client.close();
  });

  it('lets the runner refuse on identity before any tool effect', async () => {
    let effects = 0;
    const runner: BridgeRunner = async (_tool, _args, identity) => {
      if (identity?.tenantRef === undefined) {
        return {
          ok: false,
          auditId: 'a',
          redactionClass: 'low',
          error: { code: 'missing_tenant', message: 'tenant required', retriable: false },
        } satisfies AppToolResult;
      }
      effects += 1;
      return { ok: true, output: {}, auditId: 'a', redactionClass: 'low' };
    };
    const client = await linkedClient(runner, { scopes: [], hasBearer: false });
    const result = await client.callTool({
      name: 'immo.price.estimate',
      arguments: { surface: 80 },
    });
    expect(result.isError).toBe(true);
    expect(effects).toBe(0);
    await client.close();
  });
});
