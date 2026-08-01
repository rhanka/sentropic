/** LIVE Google Drive and Gmail adapters using the existing read-only manifests. */
import type {
  AppCapability,
  AppMcpProviderManifest,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
  RedactionClass,
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppResultEnvelope,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
  DurableCallRef,
  StpConnectorContext,
} from '@sentropic/mcp-platform';
import {
  exportDriveFileLive,
  getDriveAboutLive,
  getDriveFileLive,
  getGmailMessageLive,
  getGmailThreadLive,
  GoogleLiveApiError,
  listDriveFilesLive,
  listDrivePermissionsLive,
  listGmailLabelsLive,
  listGmailMessagesLive,
  type DriveFilesExportInput,
  type DriveFilesListInput,
  type DriveFileInput,
  type GmailMessagesListInput,
  type GmailMessageInput,
  type GmailThreadInput,
} from './live-executors.js';
import { gmailManifest, googleDriveManifest } from './manifest.js';

type LiveProvider = 'googleDrive' | 'gmail';

type GoogleLiveErrorEnvelope = AppResultEnvelope<unknown> & {
  error: NonNullable<AppResultEnvelope<unknown>['error']> & { detail?: Record<string, unknown> };
};

let liveAuditSequence = 0;

function nextLiveAuditId(provider: LiveProvider, kind: 'resource' | 'tool'): string {
  liveAuditSequence += 1;
  return `${provider}-live-${kind}-${liveAuditSequence}`;
}

function capabilityRedactionClass(
  manifest: AppMcpProviderManifest,
  kind: 'resource' | 'tool',
  capabilityRef: string,
): RedactionClass {
  const capabilities = kind === 'resource' ? manifest.resources : manifest.tools;
  return capabilities.find((capability) => capability.name === capabilityRef)?.redactionClass ?? 'low';
}

function liveErrorEnvelope(
  error: GoogleLiveApiError,
  auditId: string,
  redactionClass: RedactionClass,
): GoogleLiveErrorEnvelope {
  return {
    ok: false,
    auditId,
    redactionClass,
    error: {
      code: error.code,
      message: error.message,
      retriable: error.retriable,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    },
  };
}

function secretEnvelopeDetail(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const detail: Record<string, unknown> = {};
  const source = error as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(error, 'reason')) detail.reason = source.reason;
  if (Object.prototype.hasOwnProperty.call(error, 'version')) detail.version = source.version;
  return Object.keys(detail).length === 0 ? undefined : detail;
}

async function getAccessToken(ctx: StpConnectorContext): Promise<string> {
  try {
    return await ctx.getSecret('googleOAuthAccessToken');
  } catch (error) {
    const name = typeof error === 'object' && error !== null
      ? (error as { name?: unknown }).name
      : undefined;
    if (name === 'SecretEnvelopeError') {
      throw new GoogleLiveApiError(
        0,
        'connector_secret_unreadable',
        'Google OAuth access token cannot be read.',
        true,
        secretEnvelopeDetail(error),
      );
    }
    if (name === 'SecretAccessError') {
      throw new GoogleLiveApiError(
        0,
        'connector_secret_unavailable',
        'Google OAuth access token is unavailable.',
        false,
      );
    }
    throw error;
  }
}

function parseDriveFileUri(uri: string): DriveFileInput {
  const match = /^google-drive:\/\/files\/([^/]+)$/.exec(uri);
  if (!match) throw new GoogleLiveApiError(400, 'google_invalid_input', 'Invalid Drive file URI.', false);
  return { fileId: match[1] };
}

function parseGmailMessageUri(uri: string): GmailMessageInput {
  const match = /^gmail:\/\/messages\/([^/]+)$/.exec(uri);
  if (!match) throw new GoogleLiveApiError(400, 'google_invalid_input', 'Invalid Gmail message URI.', false);
  return { messageId: match[1] };
}

function parseGmailThreadUri(uri: string): GmailThreadInput {
  const match = /^gmail:\/\/threads\/([^/]+)$/.exec(uri);
  if (!match) throw new GoogleLiveApiError(400, 'google_invalid_input', 'Invalid Gmail thread URI.', false);
  return { threadId: match[1] };
}

function unknownCapability(
  kind: 'resource' | 'tool',
  capabilityRef: string,
  auditId: string,
  redactionClass: RedactionClass,
): AppResultEnvelope<unknown> {
  return {
    ok: false,
    auditId,
    redactionClass,
    error: {
      code: 'not_implemented_live',
      message: `No live executor registered for ${kind} "${capabilityRef}".`,
      retriable: false,
    },
  };
}

function createGoogleLiveAdapter(
  provider: LiveProvider,
  manifest: AppMcpProviderManifest,
): AppConnectorProviderAdapter {
  return {
    appId: 'sentropic',
    connectorId: manifest.providerId,
    manifest,

    async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
      return {
        principalRef: input.principalSub,
        tenantRef: input.tenantRef,
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
      };
    },

    async listCapabilities(_ctx: ConnectorTenantContext): Promise<AppCapability[]> {
      return [...manifest.resources, ...manifest.tools, ...manifest.prompts];
    },

    async readResource(req: AppResourceRead): Promise<AppResourceResult> {
      const auditId = nextLiveAuditId(provider, 'resource');
      const redactionClass = capabilityRedactionClass(manifest, 'resource', req.capabilityRef);
      try {
        await req.ctx.audit.emit({
          domain: provider,
          capabilityRef: req.capabilityRef,
          uri: req.input.uri,
        });
        const token = await getAccessToken(req.ctx);

        if (provider === 'googleDrive') {
          if (req.capabilityRef === 'about.get') {
            if (req.input.uri !== 'google-drive://about') {
              throw new GoogleLiveApiError(400, 'google_invalid_input', 'Invalid Drive about URI.', false);
            }
            return { ok: true, output: await getDriveAboutLive(token), auditId, redactionClass };
          }
          if (req.capabilityRef === 'files.get') {
            return {
              ok: true,
              output: await getDriveFileLive(parseDriveFileUri(req.input.uri), token),
              auditId,
              redactionClass,
            };
          }
        }

        if (provider === 'gmail') {
          if (req.capabilityRef === 'messages.get') {
            return {
              ok: true,
              output: await getGmailMessageLive(parseGmailMessageUri(req.input.uri), token),
              auditId,
              redactionClass,
            };
          }
          if (req.capabilityRef === 'threads.get') {
            return {
              ok: true,
              output: await getGmailThreadLive(parseGmailThreadUri(req.input.uri), token),
              auditId,
              redactionClass,
            };
          }
        }
        return unknownCapability('resource', req.capabilityRef, auditId, redactionClass);
      } catch (error) {
        if (error instanceof GoogleLiveApiError) {
          return liveErrorEnvelope(error, auditId, redactionClass);
        }
        throw error;
      }
    },

    async invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef> {
      const auditId = nextLiveAuditId(provider, 'tool');
      const redactionClass = capabilityRedactionClass(manifest, 'tool', req.capabilityRef);
      try {
        await req.ctx.audit.emit({ domain: provider, capabilityRef: req.capabilityRef });
        const token = await getAccessToken(req.ctx);

        if (provider === 'googleDrive') {
          if (req.capabilityRef === 'files.list') {
            return {
              ok: true,
              output: await listDriveFilesLive(req.input as DriveFilesListInput, token),
              auditId,
              redactionClass,
            };
          }
          if (req.capabilityRef === 'files.export') {
            return {
              ok: true,
              output: await exportDriveFileLive(req.input as DriveFilesExportInput, token),
              auditId,
              redactionClass,
            };
          }
          if (req.capabilityRef === 'permissions.list') {
            return {
              ok: true,
              output: await listDrivePermissionsLive(req.input as DriveFileInput, token),
              auditId,
              redactionClass,
            };
          }
        }

        if (provider === 'gmail') {
          if (req.capabilityRef === 'messages.list') {
            return {
              ok: true,
              output: await listGmailMessagesLive(req.input as GmailMessagesListInput, token),
              auditId,
              redactionClass,
            };
          }
          if (req.capabilityRef === 'labels.list') {
            return { ok: true, output: await listGmailLabelsLive(token), auditId, redactionClass };
          }
        }
        return unknownCapability('tool', req.capabilityRef, auditId, redactionClass);
      } catch (error) {
        if (error instanceof GoogleLiveApiError) {
          return liveErrorEnvelope(error, auditId, redactionClass);
        }
        throw error;
      }
    },

    async validateSecrets(_ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus> {
      return [{ name: 'googleOAuthAccessToken', scope: 'principal', state: 'active' }];
    },
  };
}

export const googleDriveLiveAdapter = createGoogleLiveAdapter('googleDrive', googleDriveManifest);
export const gmailLiveAdapter = createGoogleLiveAdapter('gmail', gmailManifest);
