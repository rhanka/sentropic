import type { McpOAuthEgressProfile, McpOAuthNamespaceOptions } from './oauth-contracts.js';

export type McpOAuthEgressRefusal = 'profile_denied' | 'invalid_parameters' | 'exchange_refused'
  | 'downstream_unavailable' | 'invocation_inactive' | 'invalid_response';

/** Fixed diagnostics only: no issuer/body/header/token material is attached. */
export class McpOAuthEgressError extends Error {
  readonly code = 'mcp_oauth_egress_refused';
  constructor(readonly reason: McpOAuthEgressRefusal) {
    super(`MCP egress refused: ${reason}`);
    this.name = 'McpOAuthEgressError';
  }
}

interface Profile {
  readonly configuration: McpOAuthEgressProfile;
  readonly parameters: readonly string[];
}

/** Freeze the host's exact destinations and reject URL/path ambiguity before listening. */
export function compileOAuthProfiles(options: McpOAuthNamespaceOptions) {
  const profiles = new Map<string, Profile>();
  for (const [id, source] of Object.entries(options.exchange?.profiles ?? {})) {
    const origin = new URL(source.origin);
    const audience = new URL(source.audience);
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(id) || source.method !== 'GET'
      || !['https:', 'http:'].includes(origin.protocol) || origin.origin !== source.origin
      || !['https:', 'http:'].includes(audience.protocol) || audience.username || audience.password || audience.search || audience.hash
      || typeof source.validateParams !== 'function' || !options.tools.some((tool) => tool.name === source.tool)
      || source.requiredScopes.length === 0
      || source.requiredScopes.some((scope) => !options.scopesSupported.includes(scope))) {
      throw new TypeError('Invalid MCP OAuth egress profile');
    }
    const segments = source.pathTemplate.split('/');
    if (segments.shift() !== '' || segments.length === 0 || segments.some((segment) =>
      !/^(?:[a-zA-Z0-9_-]+|:[a-z][a-zA-Z0-9_]*)$/u.test(segment))) {
      throw new TypeError('MCP OAuth egress requires an exact absolute path template');
    }
    const parameters = segments.filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1));
    if (new Set(parameters).size !== parameters.length) throw new TypeError('Duplicate egress parameter');
    profiles.set(id, { parameters: Object.freeze(parameters), configuration: Object.freeze({
      ...source, requiredScopes: Object.freeze([...source.requiredScopes]),
    }) });
  }
  return {
    audiences: [...new Set([...profiles.values()].map(({ configuration }) => configuration.audience))],
    resolve(id: string, tool: string, input: Readonly<Record<string, string>>) {
      const profile = profiles.get(id);
      if (!profile || profile.configuration.tool !== tool) throw new McpOAuthEgressError('profile_denied');
      try {
        if (typeof input !== 'object' || input === null || Array.isArray(input)
          || Object.keys(input).length !== profile.parameters.length
          || profile.parameters.some((key) => !Object.hasOwn(input, key))) throw new Error();
        const params = profile.configuration.validateParams(Object.freeze({ ...input }));
        if (typeof params !== 'object' || params === null || Object.keys(params).length !== profile.parameters.length) throw new Error();
        let path = profile.configuration.pathTemplate;
        for (const key of profile.parameters) {
          const value = params[key];
          if (typeof value !== 'string' || value !== input[key] || value.length > 128
            || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) || (key === 'city' && value === 'by-city')) throw new Error();
          path = path.replace(`:${key}`, encodeURIComponent(value));
        }
        const url = new URL(path, profile.configuration.origin);
        if (url.origin !== profile.configuration.origin || url.pathname !== path || url.search || url.hash) throw new Error();
        return { profile: profile.configuration, url: url.href };
      } catch {
        throw new McpOAuthEgressError('invalid_parameters');
      }
    },
  };
}
