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
import { testCatalogContext } from './test-context';

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
