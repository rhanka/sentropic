import { isDeepStrictEqual } from 'node:util';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CompiledMcpRegistry, CompiledToolResolution } from '@sentropic/mcp-platform/registry';
import type { StatefulMcpNamespaceOptions } from './stateful-contracts.js';

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** All checks and snapshots complete before the host can mutate an existing server. */
export function prepareStatefulTools(options: StatefulMcpNamespaceOptions) {
  if (!options.host || typeof options.host.bind !== 'function'
    || typeof options.authorize !== 'function' || typeof options.invoke !== 'function'
    || typeof options.formatRefusal !== 'function') throw new TypeError('Missing stateful host bindings');
  const claimNames = options.host.verifiedClaimNames;
  if (!Array.isArray(claimNames) || claimNames.some(name => typeof name !== 'string' || !name)
    || new Set(claimNames).size !== claimNames.length) throw new TypeError('Invalid verified claim mappings');
  const tools = freeze(structuredClone(options.tools));
  const resolutions = new Map<string, CompiledToolResolution>();
  for (const tool of tools) {
    const resolution = options.registry.resolveTool(tool.name);
    if (!tool.name || resolutions.has(tool.name) || !resolution || !ToolSchema.safeParse(tool).success) {
      throw new TypeError('MCP tools must be unique, valid and resolve in the compiled registry');
    }
    if (!isDeepStrictEqual(tool.inputSchema, resolution.inputSchema)) {
      throw new TypeError(`${tool.name}: descriptor schema differs from digest-bound manifest`);
    }
    if (resolution.requiredClaims.some(claim => !claimNames.includes(claim))) {
      throw new TypeError(`${tool.name}: required claim has no verified host mapping`);
    }
    resolutions.set(tool.name, freeze({
      ...resolution, requiredScopes: [...resolution.requiredScopes], requiredClaims: [...resolution.requiredClaims],
    }));
  }
  if (resolutions.size !== options.registry.tools.size
    || [...options.registry.tools.keys()].some(name => !resolutions.has(name))) {
    throw new TypeError('MCP wrapping requires complete selected-provider tool coverage');
  }
  const registry: CompiledMcpRegistry = {
    providers: options.registry.providers, tools: resolutions, resolveTool: name => resolutions.get(name),
  };
  return { tools, registry, claimNames: Object.freeze([...claimNames]) };
}
