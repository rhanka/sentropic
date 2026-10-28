import type { CompiledMcpRegistry } from '@sentropic/cluster-mesh/mcp/registry';
import { authorizeDispatch } from '@sentropic/mcp-platform/transport/dispatch';
import { ARTIFACT_SESSION_CLIENT, artifactCredential, artifactTurnCredential } from '../../artifacts/credentials';
import type { ArtifactTransport } from '../../artifacts/transport';
import type { CatalogSource } from '../source';
import type { ToolEntry } from '../types';
import { isTrustedCatalogContext, revalidateCatalogInvocation, type CatalogRequestContext } from '../request-context';
import type { StandaloneToolHandler } from './standalone-tool-source';

interface HostRegistryPorts {
  registry(): CompiledMcpRegistry | undefined;
  invoke(name: string, args: Record<string, unknown>, context: CatalogRequestContext): Promise<unknown>;
}

/** Request-local projection of the existing immutable compiled plan; no descriptor/view cache. */
export class HostRegistryCatalogSource implements CatalogSource {
  readonly id = 'host-registry';
  readonly kind = 'mcp' as const;
  readonly requiresContext = true;
  constructor(private readonly ports: HostRegistryPorts) {}

  snapshot(context?: CatalogRequestContext): readonly ToolEntry[] {
    if (!isTrustedCatalogContext(context)) return [];
    const registry = this.ports.registry();
    if (!registry) return [];
    return [...registry.tools].flatMap(([name, resolution]) => {
      if (!context.allowedTools.includes(name) || !authorizeDispatch({ registry, toolName: name,
        principal: { sub: context.subjectId, clientId: 'sentropic-catalog',
          scopes: ['mcp:tools:invoke'], claims: [] } }).allowed) return [];
      const sideEffect = resolution.entry.mutability !== 'read-only' || resolution.entry.mutatesExternalSystem;
      if (context.readOnly && sideEffect) return [];
      const description = `${resolution.providerId}: ${resolution.capabilityName}`;
      return [{ kind: 'tool' as const, sourceId: this.id, metadata: { name, description },
        tool: { name, description, inputSchema: resolution.inputSchema as Record<string, unknown>, sideEffect } }];
    });
  }

  getHandler(name: string): StandaloneToolHandler | undefined {
    if (!this.ports.registry()?.resolveTool(name)) return undefined;
    return async (args, context) => {
      const entry = this.snapshot(context).find(entry => entry.metadata.name === name);
      if (!entry) throw new Error('catalog_access_denied');
      const current = await revalidateCatalogInvocation(context, name, args, entry.tool.sideEffect);
      if (!this.snapshot(current).some(entry => entry.metadata.name === name)) throw new Error('catalog_access_denied');
      return this.ports.invoke(name, args, current);
    };
  }
}

/** Both HTTP sessions and verified conversation turns use W2's existing transport/effect guard. */
export function createHostRegistryCatalogSource(ports: {
  registry(): CompiledMcpRegistry | undefined;
  transport(): Promise<Pick<ArtifactTransport, 'invoke'>>;
}): HostRegistryCatalogSource {
  return new HostRegistryCatalogSource({ registry: ports.registry, async invoke(name, args, context) {
    const identity = { subject: context.subjectId, tenantId: context.tenantId,
      clientId: context.sessionKind === 'http' ? ARTIFACT_SESSION_CLIENT : 'sentropic-turn',
      credentialId: context.sessionKind === 'http' ? artifactCredential('session', context.sessionId)
        : artifactTurnCredential(context.sessionId, context.workspaceId) };
    return (await ports.transport()).invoke(identity, context.workspaceId, ['mcp:tools:invoke'], name, args);
  } });
}
