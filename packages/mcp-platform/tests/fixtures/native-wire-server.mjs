import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { registerMcpWireTools } from '../../dist/transport/bridge.js';
import { compileMcpToolSchemas } from '../../dist/transport/tool-schemas.js';

export const limits = {
  maxSchemaBytes: 1e6, maxSchemaDepth: 64, maxRequestBytes: 1e6,
  maxArgumentBytes: 1e6, maxArgumentDepth: 64, maxResultBytes: 1e6, maxResultDepth: 64,
};
export const tools = [{
  name: 'probe', title: 'Probe', description: 'Native wire probe',
  inputSchema: { type: 'object', properties: {
    mode: { type: 'string' }, result: { type: 'object' },
  }, additionalProperties: false },
  execution: { taskSupport: 'forbidden' }, annotations: { readOnlyHint: true },
  _meta: { probe: true },
}];
export function register(server, formatFailure = () => ({
  content: [{ type: 'text', text: 'Safe failure' }], isError: true,
})) {
  registerMcpWireTools(server, tools, {
    async run(_name, args, extra) {
      if (Object.keys(extra).join() !== 'signal') throw new Error('Unsafe SDK extra');
      if (args.mode === 'protocol') throw new McpError(-32602, 'SECRET_SENTINEL', { secret: 'SECRET_SENTINEL' });
      if (args.mode === 'custom-code') throw new McpError(-32099, 'SECRET_SENTINEL');
      if (args.mode === 'ordinary') throw new Error('SECRET_SENTINEL');
      return args.result ?? { content: [] };
    },
  }, { schemas: compileMcpToolSchemas(tools, limits), limits, formatFailure });
}
if (process.argv[1]?.endsWith('native-wire-server.mjs')) {
  const server = new Server({ name: 'native-probe', version: '1' }, { capabilities: { tools: {} } });
  register(server);
  await server.connect(new StdioServerTransport());
}
