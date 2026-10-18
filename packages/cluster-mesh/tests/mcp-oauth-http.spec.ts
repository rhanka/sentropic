import { describe, expect, it } from 'vitest';
import { runHttpScenario } from './packaging/fixtures/mcp-oauth/scenario.js';

describe('MCP OAuth real HTTP interoperability', () => {
  it('should retain verified exchange, assurance and the same client after a listener restart', async () => {
    expect(await runHttpScenario()).toEqual({ mints: 2, apiCalls: 2, tools: 12, assurance: 'enforced' });
  });
});
