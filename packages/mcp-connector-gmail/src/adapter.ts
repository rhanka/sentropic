/**
 * BR-72 Wave-1 — Gmail READ-ONLY `AppConnectorProviderAdapter` (benchmark proof).
 *
 * Implements the §4.4 adapter contract against the four read-only capabilities
 * declared in `./manifest.ts`. Every result comes from the in-repo SYNTHETIC
 * fixtures in `./fixtures.ts` — there is NO real network call, no secret is ever
 * read on a read-only path, and `resolveTenant` only NARROWS the core-authorized
 * principal→tenant binding (never re-binds it from selector hints), per §4.4.
 *
 * MOCK-ONLY: pure in-memory; recoded independently against Sentropic contracts.
 */
import type {
  AppCapability,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
} from '../../mcp-platform/src/manifest.js';
import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
  DurableCallRef,
} from '../../mcp-platform/src/runtime.js';
import { getDraft, getMessage, gmailManifest, listDrafts, searchThreads } from './manifest.js';
import {
  getDraftFixture,
  getMessageFixture,
  listDraftsFixture,
  searchThreadsFixture,
} from './fixtures.js';
import type { SyntheticThreadSummary } from './fixtures.js';

/** Extract a single `{name}` path segment from a URI given its template prefix. */
function extractTrailingParam(template: string, uri: string): string | undefined {
  const marker = template.slice(0, template.lastIndexOf('/') + 1);
  if (!uri.startsWith(marker)) return undefined;
  const rest = uri.slice(marker.length);
  return rest.length > 0 ? rest : undefined;
}

export function createGmailConnector(): AppConnectorProviderAdapter {
  return {
    appId: gmailManifest.appId,
    connectorId: gmailManifest.providerId,
    manifest: gmailManifest,

    async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
      // Narrow-only: keep the core-authorized tenant, never re-bind from selectorHints.
      return {
        principalRef: input.principalSub,
        tenantRef: input.tenantRef,
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
        domainScopeRef: `gmail-account:${input.tenantRef}`,
      };
    },

    async listCapabilities(): Promise<AppCapability[]> {
      return [...gmailManifest.resources, ...gmailManifest.tools, ...gmailManifest.prompts];
    },

    async invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef> {
      if (req.capabilityRef !== searchThreads.name) {
        return {
          ok: false,
          auditId: req.ctx.auditId,
          redactionClass: searchThreads.redactionClass,
          error: { code: 'unknown_capability', message: `unknown tool '${req.capabilityRef}'`, retriable: false },
        };
      }
      const input = req.input as { query?: string; maxResults?: number };
      const q = (input.query ?? '').trim().toLowerCase();
      const matches = q.length === 0
        ? searchThreadsFixture
        : searchThreadsFixture.filter(
            (t: SyntheticThreadSummary) =>
              t.subject.toLowerCase().includes(q) || t.snippet.toLowerCase().includes(q) || t.from.toLowerCase().includes(q),
          );
      const limited = typeof input.maxResults === 'number' ? matches.slice(0, input.maxResults) : matches;
      await req.ctx.audit.emit({
        kind: 'tool.invoke',
        auditId: req.ctx.auditId,
        correlationId: req.ctx.correlationId,
        at: new Date().toISOString(),
        detail: { capabilityRef: searchThreads.name, resultCount: limited.length },
      });
      return {
        ok: true,
        output: limited,
        auditId: req.ctx.auditId,
        redactionClass: searchThreads.redactionClass,
      };
    },

    async readResource(req: AppResourceRead): Promise<AppResourceResult> {
      const { uri } = req.input;

      if (uri === listDrafts.uriTemplate) {
        await req.ctx.audit.emit({
          kind: 'resource.read',
          auditId: req.ctx.auditId,
          correlationId: req.ctx.correlationId,
          at: new Date().toISOString(),
          detail: { capabilityRef: listDrafts.name, resultCount: listDraftsFixture.length },
        });
        return {
          ok: true,
          output: listDraftsFixture,
          auditId: req.ctx.auditId,
          redactionClass: listDrafts.redactionClass,
        };
      }

      const draftId = extractTrailingParam(getDraft.uriTemplate, uri);
      if (draftId !== undefined && uri.startsWith('gmail://drafts/')) {
        const draft = getDraftFixture[draftId];
        await req.ctx.audit.emit({
          kind: 'resource.read',
          auditId: req.ctx.auditId,
          correlationId: req.ctx.correlationId,
          at: new Date().toISOString(),
          detail: { capabilityRef: getDraft.name, found: draft !== undefined },
        });
        if (!draft) {
          return {
            ok: false,
            auditId: req.ctx.auditId,
            redactionClass: getDraft.redactionClass,
            error: { code: 'not_found', message: `no synthetic draft '${draftId}'`, retriable: false },
          };
        }
        return { ok: true, output: draft, auditId: req.ctx.auditId, redactionClass: getDraft.redactionClass };
      }

      const messageId = extractTrailingParam(getMessage.uriTemplate, uri);
      if (messageId !== undefined && uri.startsWith('gmail://messages/')) {
        const message = getMessageFixture[messageId];
        await req.ctx.audit.emit({
          kind: 'resource.read',
          auditId: req.ctx.auditId,
          correlationId: req.ctx.correlationId,
          at: new Date().toISOString(),
          detail: { capabilityRef: getMessage.name, found: message !== undefined },
        });
        if (!message) {
          return {
            ok: false,
            auditId: req.ctx.auditId,
            redactionClass: getMessage.redactionClass,
            error: { code: 'not_found', message: `no synthetic message '${messageId}'`, retriable: false },
          };
        }
        return { ok: true, output: message, auditId: req.ctx.auditId, redactionClass: getMessage.redactionClass };
      }

      return {
        ok: false,
        auditId: req.ctx.auditId,
        redactionClass: 'none',
        error: { code: 'unknown_resource', message: `unrecognized resource uri '${uri}'`, retriable: false },
      };
    },

    async validateSecrets(): Promise<ConnectorSecretStatus> {
      // Synthetic status only — never reads/discloses a secret VALUE. No real
      // secret store is wired for this benchmark proof.
      return (gmailManifest.secrets ?? []).map((s) => ({
        name: s.name,
        scope: s.scope,
        state: 'active',
      }));
    },
  };
}
