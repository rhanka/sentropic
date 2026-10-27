import { authorizeDispatch } from '@sentropic/mcp-platform/transport/dispatch';
import type { HttpRequest, HttpResponse } from '@sentropic/artifacts/http';
import { ArtifactProfileInputError } from '@sentropic/artifacts/mcp-core';
import { compileAppMcpRegistry } from '../mcp/cluster-registry';
import type { createArtifactHost } from './composition';
import type { ArtifactHostIdentity } from './authorization';

type Host = Pick<ReturnType<typeof createArtifactHost>, 'profile' | 'bind'>;
const refused = (status: number): HttpResponse => ({ status, body: { error: status === 400 ? 'invalid_request' : 'access_denied' } });

/** One startup plan; both transports delegate effects to the same W1 service. */
export function createArtifactTransport(host: Host) {
  const { profile } = host;
  const ready = compileAppMcpRegistry({
    artifacts: { profile, app: { profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities,
      execute: async () => { throw new Error('Registry compilation cannot execute an artifact'); } },
    createInvocation: () => { throw new Error('Registry compilation cannot bind a credential'); } },
    selection: ['sentropic.artifacts'], configurations: { 'sentropic.artifacts': {} }, bindings: {},
    compatibility: { 'sentropic.artifacts': {
      manifestDigest: 'ccf8a4ddd9365537741eb0550efa49954d86a0c2d1ee808fb18ca81ef7090e9a' } },
  }).then(result => {
    if (!result.ok) throw new Error(`App registry compilation refused: ${JSON.stringify(result.diagnostics)}`);
    return result.registry;
  });
  // Startup awaits this promise; also mark rejection observed during concurrent module loading.
  void ready.catch(() => undefined);
  return {
    ready,
    async discover(identity: ArtifactHostIdentity, workspaceId: string, scopes: readonly string[]) {
      if (!scopes.includes('mcp:discover')) return [];
      const registry = await ready;
      await host.bind(identity, workspaceId);
      return [...registry.tools].map(([name, tool]) => ({ name, inputSchema: tool.inputSchema }));
    },
    async invoke(identity: ArtifactHostIdentity, workspaceId: string, scopes: readonly string[], tool: string, args: unknown) {
      const registry = await ready;
      const decision = authorizeDispatch({ registry, toolName: tool,
        principal: { sub: identity.subject, clientId: identity.clientId, scopes: [...scopes], claims: [] } });
      if (!decision.allowed) return refused(decision.code === 'unknown_tool' ? 404 : 403);
      try {
        profile.validate(tool, args);
        return await (await host.bind(identity, workspaceId)).mcp({ tool, args });
      } catch (error) { return refused(error instanceof ArtifactProfileInputError ? 400 : 403); }
    },
    async http(identity: ArtifactHostIdentity, workspaceId: string, request: Omit<HttpRequest, 'actorId' | 'storageScopeId'>) {
      await ready;
      const capability = profile.capabilityForRoute(request.method, request.path);
      if (!capability) return refused(404);
      try {
        if (request.method === 'POST') profile.validate(capability, request.body ?? {}, request.idempotencyKey);
        return await (await host.bind(identity, workspaceId)).http(request);
      } catch (error) { return refused(error instanceof ArtifactProfileInputError ? 400 : 403); }
    },
  };
}
export type ArtifactTransport = ReturnType<typeof createArtifactTransport>;
