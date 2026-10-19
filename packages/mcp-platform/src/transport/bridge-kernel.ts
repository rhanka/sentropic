import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema, McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface BridgeKernel {
  readonly tools: readonly Tool[];
  call(name: string, args: unknown, signal: AbortSignal): Promise<CallToolResult>;
}

const publicMessages = new Map([
  [-32700, 'Parse error'], [-32600, 'Invalid Request'], [-32601, 'Method not found'],
  [-32602, 'Invalid params'], [-32603, 'Internal error'],
]);

/** Only the native runner's explicit SDK protocol channel crosses this boundary. */
export function safeMcpProtocolError(error: McpError): McpError {
  const code = publicMessages.has(error.code) ? error.code : -32603;
  const safe = new McpError(code, publicMessages.get(code)!);
  safe.message = publicMessages.get(code)!;
  return safe;
}

/** One public SDK handler-installation/dispatch seam for explicit result contracts. */
export function registerBridgeKernel(server: Server, kernel: BridgeKernel): void {
  const names = new Set(kernel.tools.map(tool => tool.name));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...kernel.tools] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!names.has(request.params.name)) throw safeMcpProtocolError(new McpError(-32601, ''));
    return kernel.call(request.params.name, request.params.arguments ?? {}, extra.signal);
  });
}
