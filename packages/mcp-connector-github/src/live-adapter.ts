/**
 * BR-72 DEPTH Lot 1 — GitHub LIVE `AppConnectorProviderAdapter` variant.
 *
 * DELIBERATE deviation from the read-only benchmark proof (`./adapter.ts`):
 * `readResource`/`invokeTool` call the REAL-network executors in
 * `./live-executors.ts` instead of the synthetic fixtures in `./fixtures.ts`.
 * The token is read from `ctx.getSecret('githubToken')`, which may resolve
 * to `''` for public/no-auth capabilities — handled gracefully (the token is
 * simply omitted from the request). The token value is NEVER logged/echoed.
 *
 * Live capability coverage (BR-72 DEPTH Lot 1 scope): `get_repository`,
 * `get_file_contents`, `get_current_user` (resources) and
 * `search_repositories` (tool). Every other capability declared in
 * `../src/manifest.ts` (`list_my_repositories`, `check_pull_request_merged`,
 * `compare_commits`) returns a typed `not_implemented_live` error — this
 * proof intentionally covers only the 4 capabilities in the brief, not the
 * full read-only manifest.
 *
 * Recoded against the Sentropic `@sentropic/mcp-platform` contract
 * (`../../mcp-platform/src/runtime.ts`); not the production connector
 * (production connector residence is an architect D4 decision, deferred).
 */
import type {
  AppCapability,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
  RedactionClass,
} from '../../mcp-platform/src/manifest.js';
import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppResultEnvelope,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
  DurableCallRef,
} from '../../mcp-platform/src/runtime.js';
import {
  getCurrentUserLive,
  getFileContentsLive,
  getRepositoryLive,
  GithubLiveApiError,
  searchRepositoriesLive,
  type GetFileContentsInput,
  type GetRepositoryInput,
  type SearchRepositoriesInput,
} from './live-executors.js';
import { githubManifest } from './manifest.js';

let liveAuditSequence = 0;
function nextLiveAuditId(prefix: string): string {
  liveAuditSequence += 1;
  return `${prefix}-${liveAuditSequence}`;
}

function liveErrorEnvelope(
  err: unknown,
  auditId: string,
  redactionClass: RedactionClass,
): AppResultEnvelope<unknown> {
  if (err instanceof GithubLiveApiError) {
    return {
      ok: false,
      auditId,
      redactionClass,
      error: { code: err.code, message: err.message, retriable: err.retriable },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    auditId,
    redactionClass,
    error: { code: 'github_live_error', message, retriable: false },
  };
}

// Resource URI parsing — mirrors the uriTemplate declared in ../src/manifest.ts.
function parseRepositoryUri(uri: string): GetRepositoryInput {
  const match = /^github:\/\/repos\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) {
    throw new Error(`get_repository: cannot parse owner/repo from uri "${uri}"`);
  }
  return { owner: match[1], repo: match[2] };
}

function parseFileContentsUri(uri: string): GetFileContentsInput {
  const match = /^github:\/\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(uri);
  if (!match) {
    throw new Error(`get_file_contents: cannot parse owner/repo/path from uri "${uri}"`);
  }
  return { owner: match[1], repo: match[2], path: match[3] };
}

export const githubLiveAdapter: AppConnectorProviderAdapter = {
  appId: 'sentropic',
  connectorId: 'github',
  manifest: githubManifest,

  async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
    // Narrow-only: echo the core-authorized scoping, never broaden it.
    return {
      principalRef: input.principalSub,
      tenantRef: input.tenantRef,
      workspaceRef: input.workspaceRef,
      connectorInstanceId: input.connectorInstanceId,
    };
  },

  async listCapabilities(_ctx: ConnectorTenantContext): Promise<AppCapability[]> {
    return [...githubManifest.resources, ...githubManifest.tools, ...githubManifest.prompts];
  },

  async readResource(req: AppResourceRead): Promise<AppResourceResult> {
    const auditId = nextLiveAuditId('github-live-resource');
    await req.ctx.audit.emit({
      domain: 'github-live',
      capabilityRef: req.capabilityRef,
      uri: req.input.uri,
    });

    let token = '';
    try {
      token = await req.ctx.getSecret('githubToken');
    } catch {
      // No token available — public/no-auth capabilities handle '' gracefully.
      token = '';
    }

    try {
      switch (req.capabilityRef) {
        case 'get_current_user': {
          const output = await getCurrentUserLive(token);
          return { ok: true, output, auditId, redactionClass: 'low' };
        }
        case 'get_repository': {
          const output = await getRepositoryLive(parseRepositoryUri(req.input.uri), token);
          return { ok: true, output, auditId, redactionClass: 'low' };
        }
        case 'get_file_contents': {
          const output = await getFileContentsLive(parseFileContentsUri(req.input.uri), token);
          return { ok: true, output, auditId, redactionClass: 'low' };
        }
        default:
          return {
            ok: false,
            auditId,
            redactionClass: 'low',
            error: {
              code: 'not_implemented_live',
              message: `No live executor registered for resource "${req.capabilityRef}".`,
              retriable: false,
            },
          };
      }
    } catch (err) {
      return liveErrorEnvelope(err, auditId, 'low');
    }
  },

  async invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef> {
    const auditId = nextLiveAuditId('github-live-tool');
    await req.ctx.audit.emit({ domain: 'github-live', capabilityRef: req.capabilityRef });

    let token = '';
    try {
      token = await req.ctx.getSecret('githubToken');
    } catch {
      token = '';
    }

    try {
      if (req.capabilityRef === 'search_repositories') {
        const output = await searchRepositoriesLive(req.input as SearchRepositoriesInput, token);
        return { ok: true, output, auditId, redactionClass: 'none' };
      }
      return {
        ok: false,
        auditId,
        redactionClass: 'none',
        error: {
          code: 'not_implemented_live',
          message: `No live executor registered for tool "${req.capabilityRef}".`,
          retriable: false,
        },
      };
    } catch (err) {
      return liveErrorEnvelope(err, auditId, 'none');
    }
  },

  async validateSecrets(_ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus> {
    // State only — the raw secret VALUE is never disclosed here.
    return [
      {
        name: 'githubAccessToken',
        scope: 'connector-instance',
        state: 'active',
      },
    ];
  },
};
