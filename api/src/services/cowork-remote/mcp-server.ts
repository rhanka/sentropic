// Stateless Cowork MCP transport (BR-41d, Lot 1). Per-request McpServer over
// WebStandardStreamableHTTPServerTransport: no session, JSON responses, empty
// tool catalog until Lot 2. Config/admission ride the seam for later tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import type { CoworkAdmission } from './admission';
import type { CoworkRemoteConfig } from './config';

export const handleCoworkMcpRequest = async (
  req: Request,
  parsedBody: unknown,
  _config: CoworkRemoteConfig,
  _admission: CoworkAdmission,
): Promise<Response> => {
  const server = new McpServer({ name: 'sentropic-cowork-mcp', version: '0.1.0' });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req, { parsedBody });
  } finally {
    await server.close();
  }
};
