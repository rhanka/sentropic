import { generateKeyPair, SignJWT } from 'jose';
import { createMcpAuth } from '@sentropic/mcp-auth';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InitializeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const resource = 'https://preprod.immo.sent-tech.ca/mcp';
export const issuer = 'https://issuer.example.test';
const keys = await generateKeyPair('RS256');

export function hostAuth() {
  const auth = createMcpAuth({
    resource, authorizationServers: [issuer], scopesSupported: ['immo:read', 'immo:search', 'immo:documents:read'],
    keySource: { resolveKey: async () => keys.publicKey },
  });
  const token = (claims = {}) => new SignJWT({
    sub: 'owner', azp: 'client', scope: 'immo:read immo:search immo:documents:read',
    roles: ['viewer'], workspaces: ['default'], ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(issuer)
    .setAudience(claims.aud ?? resource).setIssuedAt().setExpirationTime(claims.exp ?? '1h').sign(keys.privateKey);
  return { auth, token };
}

export function verifiedAuthority(verified, signal) {
  return {
    principal: {
      issuer: verified.claims.iss, sub: verified.sub,
      clientId: verified.claims.azp ?? verified.claims.client_id,
      ...(verified.tid ? { tid: verified.tid } : {}),
      scopes: verified.scopes,
      claims: verified.claims.roles?.includes('admin') ? ['admin'] : [],
      attributes: { roles: verified.claims.roles ?? ['viewer'],
        workspaces: verified.claims.workspaces ?? ['default'],
        ...(verified.claims.org_id ? { org_id: verified.claims.org_id } : {}) },
    },
    resource, correlationId: crypto.randomUUID(), signal,
  };
}

/** Host adapter reads the entire bounded body before any JSON parsing or allocation. */
export async function readRpc(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RangeError('Request too large'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export const validInitialize = body => InitializeRequestSchema.safeParse(body).success;

export function oldServer(tools, oldInvoke) {
  const server = new McpServer({ name: 'immo', version: '0.0.1' });
  const handles = tools.map(tool => server.registerTool(tool.name, {
    title: tool.title, description: tool.description,
  }, () => oldInvoke(tool.name)));
  server.disableToolUpdates = () => {
    const refuse = () => { throw new Error('Host tool updates are disabled after wrapping'); };
    for (const handle of handles) {
      for (const method of ['update', 'remove', 'enable', 'disable']) handle[method] = refuse;
    }
    server.registerTool = refuse; server.tool = refuse;
  };
  return server;
}
