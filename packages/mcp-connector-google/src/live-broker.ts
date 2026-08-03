/** Minimal live broker used only by the opt-in Google smoke. */
import type { AppResultEnvelope, StpConnectorContext } from '@sentropic/mcp-platform';
import { gmailLiveAdapter, googleDriveLiveAdapter } from './live-adapter.js';

type Provider = 'googleDrive' | 'gmail';

function resourceUri(provider: Provider, capabilityRef: string, input: unknown): string {
  if (provider === 'googleDrive') {
    if (capabilityRef === 'about.get') return 'google-drive://about';
    if (capabilityRef === 'files.get') return `google-drive://files/${(input as { fileId: string }).fileId}`;
  }
  if (provider === 'gmail') {
    if (capabilityRef === 'messages.get') return `gmail://messages/${(input as { messageId: string }).messageId}`;
    if (capabilityRef === 'threads.get') return `gmail://threads/${(input as { threadId: string }).threadId}`;
  }
  throw new Error(`No resource URI builder for "${capabilityRef}".`);
}

function makeLiveContext(token: string): StpConnectorContext {
  const now = new Date().toISOString();
  return {
    requestId: `google-live-broker-request-${Date.now()}`,
    correlationId: `google-live-broker-correlation-${Date.now()}`,
    auditId: `google-live-broker-audit-${Date.now()}`,
    principal: {
      sub: 'google-live-broker-principal',
      claims: {},
      scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/gmail.readonly'],
      tenantRef: 'google-live-broker-tenant',
      authTime: now,
    },
    surface: 'backend',
    session: { mcpSessionId: 'google-live-broker-session' },
    tenantRef: 'google-live-broker-tenant',
    connectorInstanceId: 'google-live-broker-connector-instance',
    consentRefs: [],
    grantRefs: [],
    getSecret: async (name: string) => (name === 'googleOAuthAccessToken' ? token : ''),
    connectorConfig: {},
    audit: { emit: async () => undefined },
    logger: console,
  };
}

async function invokeGoogleLive(
  provider: Provider,
  capabilityRef: string,
  input: unknown,
  token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? '',
): Promise<AppResultEnvelope<unknown>> {
  const adapter = provider === 'googleDrive' ? googleDriveLiveAdapter : gmailLiveAdapter;
  const ctx = makeLiveContext(token);
  const resource = adapter.manifest.resources.some((candidate) => candidate.name === capabilityRef);
  if (resource) {
    return adapter.readResource({ capabilityRef, input: { uri: resourceUri(provider, capabilityRef, input) }, ctx });
  }
  const result = await adapter.invokeTool({ capabilityRef, input, ctx });
  if (typeof result === 'string') throw new Error('Live read-only tool returned a durable call reference.');
  return result;
}

export function invokeGoogleDriveLive(
  capabilityRef: string,
  input: unknown,
  token?: string,
): Promise<AppResultEnvelope<unknown>> {
  return invokeGoogleLive('googleDrive', capabilityRef, input, token);
}

export function invokeGmailLive(
  capabilityRef: string,
  input: unknown,
  token?: string,
): Promise<AppResultEnvelope<unknown>> {
  return invokeGoogleLive('gmail', capabilityRef, input, token);
}
