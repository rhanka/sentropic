/**
 * L-5e — reusable pages provider + dispatch (spec-v8 §9 5e).
 *
 * One provider (`pages`) with four exact public names; the dispatch routes
 * each capability to the same HTTP app direct calls use, carrying the
 * per-request actor identity. No sanitizing, prefixing or silent keeps:
 * unknown capabilities throw, and the app's own status mapping applies.
 */
import type { HttpRequest, HttpResponse } from '../http.js';
import { defineParameters } from '../parameters.js';
import { defineProvider, type ProviderDefinition } from '../provider-definition.js';

export const PAGES_PROVIDER_ID = 'pages';
export const PAGES_PROVIDER_VERSION = '0.1.0';

/** Define the reusable pages provider (exact public names, no wildcards). */
export function definePagesProvider(): ProviderDefinition {
  return defineProvider({
    providerId: PAGES_PROVIDER_ID,
    version: PAGES_PROVIDER_VERSION,
    parameters: defineParameters([
      { key: 'defaultStorageScopeId', type: 'string', required: false },
    ]),
    capabilities: [
      { kind: 'tool', name: 'ensure-site', publicName: 'pages_ensure_site', description: 'Ensure a private site artifact view.' },
      { kind: 'tool', name: 'publish-site', publicName: 'pages_publish_site', description: 'Publish files as a new release.' },
      { kind: 'tool', name: 'read-page', publicName: 'pages_read_page', description: 'Read the current release manifest.' },
      { kind: 'tool', name: 'serve-content', publicName: 'pages_serve_content', description: 'Serve current release bytes.' },
    ],
  });
}

export interface PagesApp {
  handle(request: HttpRequest): Promise<HttpResponse>;
}

export interface PagesInvokeInput {
  capability: string;
  actorId: string;
  args: Record<string, unknown>;
}

/** Create the dispatch over any conforming app (per-request actor identity). */
export function createPagesDispatch(deps: { app: PagesApp; defaultStorageScopeId?: string }) {
  function scopeOf(args: Record<string, unknown>): string {
    const scope = args['storageScopeId'];
    if (typeof scope === 'string' && scope.length !== 0) return scope;
    if (deps.defaultStorageScopeId !== undefined) return deps.defaultStorageScopeId;
    throw new Error('invalid request: missing storageScopeId');
  }
  function needString(args: Record<string, unknown>, name: string): string {
    const value = args[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`invalid request: missing ${name}`);
    }
    return value;
  }
  return {
    async invoke(input: PagesInvokeInput): Promise<HttpResponse> {
      const args = input.args;
      switch (input.capability) {
        case 'ensure-site':
          return deps.app.handle({
            method: 'POST',
            path: '/ensure',
            actorId: input.actorId,
            body: {
              bindingName: needString(args, 'bindingName'),
              storageScopeId: scopeOf(args),
              idempotencyKey: needString(args, 'idempotencyKey'),
              paramsHash: typeof args['paramsHash'] === 'string' ? args['paramsHash'] : '',
              parameters: (args['parameters'] ?? {}) as Record<string, string | number | boolean | null | undefined>,
            },
          });
        case 'publish-site':
          return deps.app.handle({
            method: 'POST',
            path: '/publish',
            actorId: input.actorId,
            body: {
              artifactId: needString(args, 'artifactId'),
              profile: (args['profile'] ?? {}) as Record<string, string | number | boolean | null | undefined>,
              files: args['files'],
              idempotencyKey: typeof args['idempotencyKey'] === 'string' ? args['idempotencyKey'] : undefined,
              paramsHash: typeof args['paramsHash'] === 'string' ? args['paramsHash'] : undefined,
            },
          });
        case 'read-page':
          return deps.app.handle({
            method: 'GET',
            path: `/current/${needString(args, 'artifactId')}`,
            actorId: input.actorId,
            body: undefined,
          });
        case 'serve-content':
          return deps.app.handle({
            method: 'GET',
            path: `/content/${needString(args, 'artifactId')}/${needString(args, 'digest')}`,
            actorId: input.actorId,
            body: undefined,
          });
        default:
          throw new Error(`unknown pages capability: ${input.capability}`);
      }
    },
  };
}
