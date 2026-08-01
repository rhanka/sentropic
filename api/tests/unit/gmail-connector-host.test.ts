import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretEnvelopeError, encryptSecret } from '../../src/services/secret-crypto';
import {
  GMAIL_ACCESS_TOKEN_SECRET,
  SecretAccessError,
  createGmailConnectorHost,
  createGmailSecretPort,
  toGmailConnectorInstanceId,
  type GmailConnectorAccount,
} from '../../src/services/connector-host/gmail';

const user = { userId: 'gmail-user', workspaceId: 'gmail-workspace' };
const token = (accessToken = 'gmail-access-token-never-audit') => ({
  accessToken,
  refreshToken: 'gmail-refresh-token',
  idToken: null,
  tokenType: 'Bearer',
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  obtainedAt: '2099-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T01:00:00.000Z',
});
const account = (overrides: Partial<GmailConnectorAccount> = {}): GmailConnectorAccount => ({
  id: 'gmail-account-1',
  status: 'connected',
  tokenSecret: encryptSecret(JSON.stringify(token())),
  accountSubject: 'gmail-subject-1',
  ...overrides,
});
const hostRequest = (overrides: Record<string, unknown> = {}) => ({
  sessionPrincipalSub: user.userId,
  connectorId: 'gmail',
  capabilityRef: 'messages.list',
  input: {},
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe('Gmail connector host', () => {
  it('does not leak a Gmail token to driver output or audit events', async () => {
    const accessToken = 'gmail-live-token-never-audit';
    const audit: unknown[] = [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const driver = createGmailConnectorHost({
      sessionUser: user,
      loadAccounts: async () => [account()],
      resolveToken: async () => token(accessToken),
      checkWorkspaceAccess: async () => undefined,
      audit: { emit: async (event) => { audit.push(event); } },
    });

    const result = await driver.invoke(hostRequest());
    expect(result).toMatchObject({ ok: true });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${accessToken}`,
    });
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(JSON.stringify(audit)).not.toContain(accessToken);
  });

  it('denies capabilities outside the finite Gmail read-only allowlist as missing', async () => {
    const driver = createGmailConnectorHost({
      sessionUser: user,
      loadAccounts: async () => [account()],
      resolveToken: async () => token(),
      checkWorkspaceAccess: async () => undefined,
    });
    await expect(driver.invoke(hostRequest({ capabilityRef: 'messages.send' }))).resolves.toMatchObject({
      error: { code: 'connector_not_found' },
    });
  });

  it('keeps unavailable and unreadable Gmail secrets as distinct connector errors', async () => {
    const selected = account();
    const unavailable = createGmailConnectorHost({
      sessionUser: user,
      loadAccounts: async () => [selected],
      checkWorkspaceAccess: async () => undefined,
      secretPort: { resolve: async () => { throw new SecretAccessError('secret_not_active'); } },
    });
    await expect(unavailable.invoke(hostRequest())).resolves.toMatchObject({
      error: { code: 'connector_secret_unavailable', retriable: false },
    });

    const unreadable = createGmailConnectorHost({
      sessionUser: user,
      loadAccounts: async () => [selected],
      checkWorkspaceAccess: async () => undefined,
      secretPort: {
        resolve: async () => {
          throw new SecretEnvelopeError('bad envelope', { reason: 'malformed_payload', version: 'v1' });
        },
      },
    });
    await expect(unreadable.invoke(hostRequest())).resolves.toMatchObject({
      error: {
        code: 'connector_secret_unreadable',
        retriable: true,
        detail: { reason: 'malformed_payload', version: 'v1' },
      },
    });
  });

  it('loads Gmail secret material through the shared principal-scoped secret name', async () => {
    const selected = account();
    const port = createGmailSecretPort({
      loadAccounts: async () => [selected],
      resolveToken: async () => token('resolved-gmail-token'),
    });
    await expect(port.resolve({
      connectorInstanceId: toGmailConnectorInstanceId(selected),
      secretName: GMAIL_ACCESS_TOKEN_SECRET,
      principalSub: user.userId,
      workspaceRef: user.workspaceId,
    })).resolves.toBe('resolved-gmail-token');
  });

  const smoke = process.env.GMAIL_SMOKE_READONLY_TOKEN ? it : it.skip;

  smoke('reads Gmail messages.list with GMAIL_SMOKE_READONLY_TOKEN through the host', async () => {
    const accessToken = process.env.GMAIL_SMOKE_READONLY_TOKEN!;
    const driver = createGmailConnectorHost({
      sessionUser: user,
      loadAccounts: async () => [account()],
      resolveToken: async () => token(accessToken),
      checkWorkspaceAccess: async () => undefined,
    });

    await expect(driver.invoke(hostRequest())).resolves.toMatchObject({ ok: true });
  });
});
