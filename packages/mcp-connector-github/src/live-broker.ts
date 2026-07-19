/**
 * BR-72 DEPTH Lot 1 — minimal GitHub LIVE broker.
 *
 * This is the "mount + invoke" seam a real broker will own: constructs an
 * in-memory `StpConnectorContext` (stub principal/tenant/connectorInstanceId/
 * session; `getSecret('githubAccessToken')` — the MANIFEST secret name, see
 * `../src/manifest.ts` — resolves `opts.token ?? process.env.GITHUB_TOKEN ??
 * ''`; `audit.emit` writes a REDACTED line to `console.error`; `logger` is
 * `console`) and invokes `./live-adapter.ts` for the given capability,
 * dispatching to `readResource` or `invokeTool` per the capability's
 * declared kind in `../src/manifest.ts`.
 *
 * NEVER log or echo the token value — `audit.emit` below only ever receives
 * `{ domain, capabilityRef, uri? }`, never the secret itself.
 */
import type { RedactionClass } from '../../mcp-platform/src/manifest.js';
import type { AppResultEnvelope, StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { githubLiveAdapter } from './live-adapter.js';

// Capabilities live-implemented in ./live-adapter.ts, by manifest kind
// (../src/manifest.ts declares get_repository/get_file_contents/
// get_current_user as resources, search_repositories as a tool).
const LIVE_RESOURCE_CAPABILITIES = new Set(['get_repository', 'get_file_contents', 'get_current_user']);
const LIVE_TOOL_CAPABILITIES = new Set(['search_repositories']);

function buildResourceUri(capabilityRef: string, input: unknown): string {
  switch (capabilityRef) {
    case 'get_current_user':
      return 'github://user';
    case 'get_repository': {
      const { owner, repo } = input as { owner: string; repo: string };
      return `github://repos/${owner}/${repo}`;
    }
    case 'get_file_contents': {
      const { owner, repo, path } = input as { owner: string; repo: string; path: string };
      return `github://repos/${owner}/${repo}/contents/${path}`;
    }
    default:
      throw new Error(`buildResourceUri: no URI builder for capability "${capabilityRef}"`);
  }
}

function makeLiveConnectorContext(opts?: { token?: string }): StpConnectorContext {
  const token = opts?.token ?? process.env.GITHUB_TOKEN ?? '';
  const now = new Date().toISOString();

  return {
    requestId: `github-live-broker-req-${Date.now()}`,
    correlationId: `github-live-broker-corr-${Date.now()}`,
    auditId: `github-live-broker-audit-${Date.now()}`,
    principal: {
      sub: 'github-live-broker-principal',
      claims: {},
      scopes: ['repo', 'read:user', 'user:email'],
      tenantRef: 'github-live-broker-tenant',
      authTime: now,
    },
    surface: 'backend',
    session: { mcpSessionId: 'github-live-broker-session' },
    tenantRef: 'github-live-broker-tenant',
    connectorInstanceId: 'github-live-broker-connector-instance',
    consentRefs: [],
    grantRefs: [],
    // Audited just-in-time secret accessor — resolves the raw token VALUE for
    // this single call only; never logged/echoed by this broker.
    getSecret: async (name: string) => {
      if (name === 'githubAccessToken') {
        return token;
      }
      return '';
    },
    connectorConfig: {},
    audit: {
      emit: async (event: unknown) => {
        // REDACTED console audit sink: `event` is always a shape without the
        // token value (see ./live-adapter.ts's audit.emit calls).
        console.error('[github-live-broker audit]', JSON.stringify(event));
      },
    },
    logger: console,
  };
}

/**
 * Invoke a live GitHub capability through the minimal broker context. Real
 * network call to `https://api.github.com` (see `./live-executors.ts`) —
 * this is the point of BR-72 DEPTH Lot 1.
 */
export async function invokeGithubLive(
  capabilityRef: string,
  input: unknown,
  opts?: { token?: string },
): Promise<AppResultEnvelope<unknown>> {
  const ctx = makeLiveConnectorContext(opts);

  if (LIVE_RESOURCE_CAPABILITIES.has(capabilityRef)) {
    return githubLiveAdapter.readResource({
      capabilityRef,
      input: { uri: buildResourceUri(capabilityRef, input) },
      ctx,
    });
  }

  if (LIVE_TOOL_CAPABILITIES.has(capabilityRef)) {
    const result = await githubLiveAdapter.invokeTool({ capabilityRef, input, ctx });
    if (typeof result === 'string') {
      throw new Error(
        `invokeGithubLive: unexpected DurableCallRef for live read-only tool "${capabilityRef}"`,
      );
    }
    return result;
  }

  const redactionClass: RedactionClass = 'none';
  return {
    ok: false,
    auditId: 'github-live-broker-unknown-capability',
    redactionClass,
    error: {
      code: 'unknown_live_capability',
      message: `invokeGithubLive: no live capability registered for "${capabilityRef}".`,
      retriable: false,
    },
  };
}
