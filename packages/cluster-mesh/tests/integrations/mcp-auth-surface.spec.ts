import { describe, expect, it } from 'vitest';
import * as provider from '@sentropic/mcp-auth';
import * as adapter from '@sentropic/mcp-auth/hono';
import * as auth from '../../src/mcp/auth.js';
import * as hono from '../../src/mcp/auth/hono.js';
import { createClusterMeshModules } from '../../src/index.js';
import { loadMcpAuth, loadMcpAuthHono } from '../../src/loaders/mcp/index.js';

describe('MCP auth provider identity', () => {
  it('should preserve every provider export and error constructor through static leaves', () => {
    for (const [name, value] of Object.entries(provider)) expect(Reflect.get(auth, name)).toBe(value);
    for (const [name, value] of Object.entries(adapter)) expect(Reflect.get(hono, name)).toBe(value);
    expect(new auth.McpAuthError(401, 'invalid_token', 'refused')).toBeInstanceOf(provider.McpAuthError);
  });

  it('should return the installed provider functions from typed loaders', async () => {
    const modules = createClusterMeshModules();
    expect((await loadMcpAuth(modules)).createMcpAuth).toBe(provider.createMcpAuth);
    expect((await loadMcpAuthHono(modules)).mcpAuthRoutes).toBe(adapter.mcpAuthRoutes);
  });
});
