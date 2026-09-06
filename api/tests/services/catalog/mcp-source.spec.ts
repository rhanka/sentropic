/**
 * McpCatalogSource — integration tests (BR-42b Lot 5)
 *
 * Uses the MCP SDK's in-memory transport pair (`InMemoryTransport.createLinkedPair()`)
 * to connect a stub MCP server and client within the same process.
 * NO real network or child-process is involved.
 *
 * Coverage:
 *   §1  refresh() connects + tools/list → tool-kind entries with sanitized names
 *   §2  snapshot() returns the cached set synchronously (never triggers connect)
 *   §3  public-id ↔ rawName map: ToolEntry.rawName carries the original MCP name
 *   §4  call dispatch: seam dispatch invokes the MCP server's handler via rawName
 *   §5  refresh() repopulates after the server's tool list changes
 *   §6  name-sanitization coverage: invalid chars → kebab/underscore public ids
 *   §7  allow/deny filter
 *   §8  default-off: with no MCP source wired, default tool set is unchanged
 *   §9  health() reflects initialized state
 */

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  McpCatalogSource,
  sanitizeMcpToolName,
} from '../../../src/services/catalog/sources/mcp-source';
import type { ToolEntry } from '../../../src/services/catalog/types';
import { CatalogExecutionSeam } from '../../../src/services/catalog/execution-seam';
import { CompositeCatalogRegistry } from '../../../src/services/catalog/composite-registry';

// ---------------------------------------------------------------------------
// Stub MCP server factory
// ---------------------------------------------------------------------------

/**
 * Creates a stub MCP server with a fixed `tools/list` response + a `call`
 * handler that echoes the tool name and arguments back.
 *
 * Accepts a `toolsOverride` for testing tools/list changes (§5).
 */
function createStubServer(
  toolsOverride?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>,
): McpServer {
  const server = new McpServer(
    { name: 'stub-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const defaultTools = [
    {
      name: 'greet_user',
      description: 'Greet a user by name.',
      inputSchema: {
        type: 'object',
        properties: {
          user_name: { type: 'string', description: 'The name to greet.' },
        },
        required: ['user_name'],
      },
    },
    {
      name: 'mcp:my-server/echo',
      description: 'Echo the input back.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to echo.' },
        },
        required: ['message'],
      },
    },
  ];

  const tools = toolsOverride ?? defaultTools;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? `Tool: ${t.name}`,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            calledWith: req.params.name,
            arguments: req.params.arguments,
          }),
        },
      ],
    };
  });

  return server;
}

/**
 * Create a transport pair and connect the server-side.
 * Returns a `transportFactory` suitable for `McpCatalogSource`.
 *
 * The server-side transport is connected eagerly; the client-side transport
 * is returned as the factory result so `McpCatalogSource` can connect.
 */
function createTransportFactory(server: McpServer): () => InMemoryTransport {
  return () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Connect the server to this transport pair eagerly.
    server.connect(serverTransport).catch(() => {
      // Errors are expected when the client closes early in tests.
    });
    return clientTransport;
  };
}

// ---------------------------------------------------------------------------
// § 1  refresh() → tool-kind entries with sanitized names
// ---------------------------------------------------------------------------

describe('McpCatalogSource — refresh() populates snapshot', () => {
  it('refresh() connects + tools/list → tool-kind entries', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'stub' },
      createTransportFactory(server),
    );

    expect(source.snapshot()).toHaveLength(0);
    expect(source.initialized).toBe(false);

    await source.refresh();

    expect(source.initialized).toBe(true);
    expect(source.snapshot()).toHaveLength(2);

    const entries = source.snapshot() as ToolEntry[];
    expect(entries.every((e) => e.kind === 'tool')).toBe(true);
    expect(entries.every((e) => e.sourceId === 'mcp:stub')).toBe(true);
  });

  it('each entry has a sanitized provider-safe public name', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'stub' },
      createTransportFactory(server),
    );

    await source.refresh();

    const entries = source.snapshot() as ToolEntry[];
    const names = entries.map((e) => e.metadata.name);

    // 'greet_user' → already valid
    expect(names).toContain('greet_user');
    // 'mcp:my-server/echo' → 'mcp_my-server_echo' (`:` and `/` → `_`)
    expect(names).toContain('mcp_my-server_echo');
  });

  it('source id is "mcp:<serverName>"', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'my-server' },
      createTransportFactory(server),
    );
    expect(source.id).toBe('mcp:my-server');
    expect(source.kind).toBe('mcp');
  });
});

// ---------------------------------------------------------------------------
// § 2  snapshot() — synchronous, never triggers I/O
// ---------------------------------------------------------------------------

describe('McpCatalogSource.snapshot — synchronous, hot-path safe', () => {
  it('snapshot() returns a plain array (not a Promise)', () => {
    const source = new McpCatalogSource(
      { serverName: 'sync-test' },
      () => { throw new Error('should not be called on snapshot()'); },
    );
    const result = source.snapshot();
    expect(result).toBeInstanceOf(Array);
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('snapshot() returns [] before the first refresh()', () => {
    const source = new McpCatalogSource(
      { serverName: 'empty-test' },
      () => { throw new Error('should not be called on snapshot()'); },
    );
    expect(source.snapshot()).toHaveLength(0);
  });

  it('snapshot() does NOT invoke the transportFactory', () => {
    const factory = vi.fn(() => { throw new Error('must not be called'); });
    const source = new McpCatalogSource({ serverName: 'no-io' }, factory);

    // Multiple snapshot() calls must NOT invoke the factory.
    source.snapshot();
    source.snapshot();
    source.snapshot();

    expect(factory).not.toHaveBeenCalled();
  });

  it('composite discovery consumes a refreshed snapshot without reconnecting', async () => {
    const server = createStubServer();
    const factory = vi.fn(createTransportFactory(server));
    const source = new McpCatalogSource({ serverName: 'discovery' }, factory);
    await source.refresh();
    const registry = new CompositeCatalogRegistry().addSource(source);

    registry.list();
    registry.get('greet_user');
    registry.search('greet user');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// § 3  public-id ↔ rawName map
// ---------------------------------------------------------------------------

describe('McpCatalogSource — public-id ↔ rawName map', () => {
  it('ToolEntry.rawName carries the original MCP tool name', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'rawname-test' },
      createTransportFactory(server),
    );

    await source.refresh();

    const entries = source.snapshot() as ToolEntry[];

    // 'greet_user' → public name is same; rawName should still be set
    const greetEntry = entries.find((e) => e.metadata.name === 'greet_user');
    expect(greetEntry).toBeDefined();
    expect(greetEntry!.rawName).toBe('greet_user');

    // 'mcp:my-server/echo' → sanitized public name, raw MCP name preserved
    const echoEntry = entries.find((e) => e.metadata.name === 'mcp_my-server_echo');
    expect(echoEntry).toBeDefined();
    expect(echoEntry!.rawName).toBe('mcp:my-server/echo');
  });

  it('public metadata.name is provider-safe (no : or /)', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'provider-safe-test' },
      createTransportFactory(server),
    );

    await source.refresh();

    const entries = source.snapshot() as ToolEntry[];
    for (const entry of entries) {
      expect(entry.metadata.name).toMatch(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
    }
  });

  it('ToolEntry.tool.name equals the sanitized public name', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'tool-name-test' },
      createTransportFactory(server),
    );

    await source.refresh();

    const entries = source.snapshot() as ToolEntry[];
    for (const entry of entries) {
      // The SkillTool descriptor's name must match the public metadata.name
      expect(entry.tool.name).toBe(entry.metadata.name);
    }
  });
});

// ---------------------------------------------------------------------------
// § 4  call dispatch via execution seam
// ---------------------------------------------------------------------------

describe('McpCatalogSource — call dispatch via execution seam', () => {
  it('a call for an MCP tool dispatches via the seam and returns a result', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'dispatch-test' },
      createTransportFactory(server),
    );

    await source.refresh();

    // Wire a composite registry + seam with the MCP source.
    const registry = new CompositeCatalogRegistry();
    registry.addSource(source);
    const seam = new CatalogExecutionSeam(registry, [source]);

    // Call the sanitized public name 'greet_user' → must dispatch to MCP.
    const result = await seam.execute('greet_user', { user_name: 'Alice' });

    expect(result.handled).toBe(true);
    expect(result.result).toBeDefined();

    // The stub server echoes back the original (raw) tool name + args.
    const body = (result.result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(body) as { calledWith: string; arguments: Record<string, unknown> };
    expect(parsed.calledWith).toBe('greet_user'); // MCP server called with raw name
    expect(parsed.arguments).toEqual({ user_name: 'Alice' });
  });

  it('seam dispatch uses rawName for the MCP call (not the public name)', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'rawname-dispatch' },
      createTransportFactory(server),
    );

    await source.refresh();

    const registry = new CompositeCatalogRegistry();
    registry.addSource(source);
    const seam = new CatalogExecutionSeam(registry, [source]);

    // The public name is 'mcp_my-server_echo'; the raw MCP name is 'mcp:my-server/echo'.
    const result = await seam.execute('mcp_my-server_echo', { message: 'hello' });

    expect(result.handled).toBe(true);
    const body = (result.result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(body) as { calledWith: string; arguments: Record<string, unknown> };
    // The MCP server was called with the raw name, not the public sanitized name.
    expect(parsed.calledWith).toBe('mcp:my-server/echo');
    expect(parsed.arguments).toEqual({ message: 'hello' });
  });

  it('seam returns handled:false for names not in the MCP source', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'miss-test' },
      createTransportFactory(server),
    );

    await source.refresh();

    const registry = new CompositeCatalogRegistry();
    registry.addSource(source);
    const seam = new CatalogExecutionSeam(registry, [source]);

    const result = await seam.execute('nonexistent_tool', {});
    expect(result.handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 5  refresh() repopulates after tool list changes
// ---------------------------------------------------------------------------

describe('McpCatalogSource — refresh() repopulates snapshot', () => {
  it('second refresh() with different tools replaces the snapshot', async () => {
    // Start with a 2-tool server.
    const serverV1 = createStubServer();
    let currentServer = serverV1;

    // Factory always connects to `currentServer` (simulates reconnect).
    const source = new McpCatalogSource(
      { serverName: 'reload-test' },
      () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        currentServer.connect(serverTransport).catch(() => {});
        return clientTransport;
      },
    );

    await source.refresh();
    expect(source.snapshot()).toHaveLength(2);
    const firstNames = source.snapshot().map((e) => e.metadata.name);
    expect(firstNames).toContain('greet_user');

    // Now swap to a new server with a different tool set.
    currentServer = createStubServer([
      {
        name: 'new_tool_v2',
        description: 'A new tool added in v2.',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);

    await source.refresh();
    expect(source.snapshot()).toHaveLength(1);
    const secondNames = source.snapshot().map((e) => e.metadata.name);
    expect(secondNames).toContain('new_tool_v2');
    expect(secondNames).not.toContain('greet_user'); // removed
  });
});

// ---------------------------------------------------------------------------
// § 6  name-sanitization coverage
// ---------------------------------------------------------------------------

describe('sanitizeMcpToolName — provider-safe public id generation', () => {
  it('valid names pass through unchanged', () => {
    expect(sanitizeMcpToolName('greet_user')).toBe('greet_user');
    expect(sanitizeMcpToolName('web-search')).toBe('web-search');
    expect(sanitizeMcpToolName('tool123')).toBe('tool123');
  });

  it('colon and slash in MCP names are replaced with underscores (hyphens preserved)', () => {
    // ':' and '/' are invalid → '_'; existing '-' is VALID and preserved.
    expect(sanitizeMcpToolName('mcp:my-server/greet_user')).toBe('mcp_my-server_greet_user');
    expect(sanitizeMcpToolName('mcp:server/tool')).toBe('mcp_server_tool');
    // All-invalid run collapses to single '_'
    expect(sanitizeMcpToolName('mcp:://tool')).toBe('mcp_tool');
  });

  it('uppercase letters are lowercased', () => {
    expect(sanitizeMcpToolName('MyTool')).toBe('mytool');
    expect(sanitizeMcpToolName('MyServer/MyTool')).toBe('myserver_mytool');
  });

  it('multiple consecutive invalid chars collapse to a single underscore', () => {
    expect(sanitizeMcpToolName('tool::name')).toBe('tool_name');
    expect(sanitizeMcpToolName('mcp:///tool')).toBe('mcp_tool');
  });

  it('leading/trailing separators are stripped', () => {
    expect(sanitizeMcpToolName('_tool_')).toBe('tool');
    expect(sanitizeMcpToolName('-tool-')).toBe('tool');
  });

  it('result matches KEBAB_PATTERN /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/', () => {
    const inputs = [
      'mcp:my-server/greet_user',
      'mcp:another-server/complex.tool_name',
      'MyServer/MyTool',
      'tool--name',
      'tool::version/sub',
    ];
    for (const input of inputs) {
      const result = sanitizeMcpToolName(input);
      expect(result).toMatch(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
    }
  });

  it('collision handling: duplicate sanitized names get _N suffix', async () => {
    // Two tools that sanitize to the same name.
    const server = createStubServer([
      { name: 'tool:one', description: 'First tool.' },
      { name: 'tool/one', description: 'Second tool (same sanitized name).' },
    ]);

    const source = new McpCatalogSource(
      { serverName: 'collision-test' },
      createTransportFactory(server),
    );

    await source.refresh();

    const entries = source.snapshot() as ToolEntry[];
    expect(entries).toHaveLength(2);
    const names = entries.map((e) => e.metadata.name);
    // First should be 'tool_one', second 'tool_one_2'.
    expect(names[0]).toBe('tool_one');
    expect(names[1]).toBe('tool_one_2');
  });
});

// ---------------------------------------------------------------------------
// § 7  allow/deny filter
// ---------------------------------------------------------------------------

describe('McpCatalogSource — allow/deny filter', () => {
  it('allowedTools filters to only the specified raw tool names', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'allow-test', allowedTools: ['greet_user'] },
      createTransportFactory(server),
    );

    await source.refresh();

    const entries = source.snapshot() as ToolEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.name).toBe('greet_user');
  });

  it('deniedTools excludes the specified raw tool names', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'deny-test', deniedTools: ['greet_user'] },
      createTransportFactory(server),
    );

    await source.refresh();

    const entries = source.snapshot() as ToolEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.name).toBe('mcp_my-server_echo');
  });

  it('empty allowedTools list results in zero entries', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'empty-allow-test', allowedTools: [] },
      createTransportFactory(server),
    );

    await source.refresh();
    expect(source.snapshot()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// § 8  default-off: no MCP tools in default chat tool set
// ---------------------------------------------------------------------------

describe('McpCatalogSource — default-off (0-regression)', () => {
  it('a fresh McpCatalogSource with no refresh has zero entries', () => {
    const source = new McpCatalogSource(
      { serverName: 'default-off-test' },
      () => { throw new Error('should not connect'); },
    );

    expect(source.snapshot()).toHaveLength(0);
    expect(source.size).toBe(0);
    expect(source.initialized).toBe(false);
  });

  it('snapshot() before refresh() never triggers a connection', async () => {
    const factory = vi.fn(() => InMemoryTransport.createLinkedPair()[0]);
    const source = new McpCatalogSource({ serverName: 'no-connect-test' }, factory);

    // Call snapshot() multiple times — no connection should be made.
    source.snapshot();
    source.snapshot();

    expect(factory).not.toHaveBeenCalled();
  });

  it('getHandler() returns undefined for all names before refresh()', () => {
    const source = new McpCatalogSource(
      { serverName: 'pre-refresh-handler' },
      () => InMemoryTransport.createLinkedPair()[0],
    );
    expect(source.getHandler('greet_user')).toBeUndefined();
    expect(source.getHandler('any_name')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// § 9  health()
// ---------------------------------------------------------------------------

describe('McpCatalogSource.health', () => {
  it('health() returns ok:false before the first refresh()', async () => {
    const source = new McpCatalogSource(
      { serverName: 'health-test' },
      () => InMemoryTransport.createLinkedPair()[0],
    );
    const result = await source.health();
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/not yet refreshed/);
  });

  it('health() returns ok:true after a successful refresh()', async () => {
    const server = createStubServer();
    const source = new McpCatalogSource(
      { serverName: 'health-post-refresh' },
      createTransportFactory(server),
    );

    await source.refresh();

    const result = await source.health();
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/tools loaded/);
  });
});
