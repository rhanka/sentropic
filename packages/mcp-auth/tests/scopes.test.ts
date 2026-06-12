import { describe, expect, it } from 'vitest';

import { MCP_SCOPES, ALL_MCP_SCOPES, isMcpScope } from '../src/scopes.js';

describe('MCP scope grammar', () => {
  it('declares the discover/read/invoke verbs', () => {
    expect(MCP_SCOPES.DISCOVER).toBe('mcp:discover');
    expect(MCP_SCOPES.RESOURCES_READ).toBe('mcp:resources:read');
    expect(MCP_SCOPES.TOOLS_INVOKE).toBe('mcp:tools:invoke');
  });

  it('enumerates all scopes', () => {
    expect([...ALL_MCP_SCOPES].sort()).toEqual(
      ['mcp:discover', 'mcp:resources:read', 'mcp:tools:invoke'].sort(),
    );
  });

  it('recognizes known MCP scopes', () => {
    expect(isMcpScope('mcp:tools:invoke')).toBe(true);
    expect(isMcpScope('openid')).toBe(false);
  });
});
