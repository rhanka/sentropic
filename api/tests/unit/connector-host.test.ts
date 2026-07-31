import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret, SecretEnvelopeError } from '../../src/services/secret-crypto';
import {
  createGoogleConnectorHost,
  createGoogleDriveAccountResolver,
  createGoogleDriveSecretPort,
  createSessionTenantWorkspaceResolver,
  GOOGLE_DRIVE_ACCESS_TOKEN_SECRET,
  SecretAccessError,
  toGoogleDriveConnectorInstanceId,
  type GoogleDriveConnectorAccount,
} from '../../src/services/connector-host/google-drive';

const user = { userId: 'user-1', workspaceId: 'workspace-1' };
const token = (accessToken = 'access-token-that-must-not-leak') => ({
  accessToken,
  refreshToken: 'refresh-token',
  idToken: null,
  tokenType: 'Bearer',
  scope: null,
  scopes: [],
  obtainedAt: '2099-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T01:00:00.000Z',
});
const account = (overrides: Partial<GoogleDriveConnectorAccount> = {}): GoogleDriveConnectorAccount => ({
  id: 'account-1',
  status: 'connected',
  tokenSecret: encryptSecret(JSON.stringify(token())),
  accountSubject: 'google-subject-1',
  ...overrides,
});
const secretRequest = (connectorInstanceId = toGoogleDriveConnectorInstanceId(account())) => ({
  connectorInstanceId,
  secretName: GOOGLE_DRIVE_ACCESS_TOKEN_SECRET,
  principalSub: user.userId,
  workspaceRef: user.workspaceId,
});
const hostRequest = (overrides: Record<string, unknown> = {}) => ({
  sessionPrincipalSub: user.userId,
  connectorId: 'google-drive',
  capabilityRef: 'about.get',
  input: { uri: 'google-drive://about' },
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe('Google Drive connector host ports', () => {
  it('uses SecretAccessError for absent accounts and preserves SecretEnvelopeError unchanged', async () => {
    const absent = createGoogleDriveSecretPort({ loadAccounts: async () => [] });
    await expect(absent.resolve(secretRequest())).rejects.toMatchObject({
      name: 'SecretAccessError', reason: 'not_enrolled',
    });

    const unreadable = createGoogleDriveSecretPort({
      loadAccounts: async () => [account({ tokenSecret: 'enc:v2:iv:tag:body' })],
    });
    const error = await unreadable.resolve(secretRequest()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecretEnvelopeError);
    expect(error).toMatchObject({ name: 'SecretEnvelopeError', reason: 'unsupported_version', version: 'v2' });
  });

  it('resolves one opaque enrolled account and denies ambiguous selection', async () => {
    const first = account();
    const resolver = createGoogleDriveAccountResolver(async () => [first]);
    await expect(resolver.resolve({ principalSub: user.userId, connectorId: 'google-drive', workspaceRef: user.workspaceId }))
      .resolves.toEqual({
        connectorInstanceId: toGoogleDriveConnectorInstanceId(first),
        enrollmentRef: 'connector-account:account-1',
        secretRefs: [GOOGLE_DRIVE_ACCESS_TOKEN_SECRET],
      });

    const ambiguous = createGoogleDriveAccountResolver(async () => [first, account({ id: 'account-2', accountSubject: 'google-subject-2' })]);
    await expect(ambiguous.resolve({ principalSub: user.userId, connectorId: 'google-drive', workspaceRef: user.workspaceId }))
      .resolves.toMatchObject({ deny: true });
  });

  it('binds the tenant resolver to its authenticated session principal and workspace access', async () => {
    const access = vi.fn(async () => undefined);
    const resolver = createSessionTenantWorkspaceResolver(user, access);
    await expect(resolver.resolve({ sessionPrincipalSub: 'other-user' })).resolves.toMatchObject({ deny: true });
    await expect(resolver.resolve({ sessionPrincipalSub: user.userId, hints: { principalSub: 'other-user' } }))
      .resolves.toMatchObject({ deny: true });
    await expect(resolver.resolve({ sessionPrincipalSub: user.userId })).resolves.toMatchObject({
      principalSub: user.userId, workspaceRef: user.workspaceId,
    });
    expect(access).toHaveBeenCalledWith(user.userId, user.workspaceId);

    const denied = createSessionTenantWorkspaceResolver(user, async () => { throw new Error('denied'); });
    await expect(denied.resolve({ sessionPrincipalSub: user.userId })).resolves.toMatchObject({ deny: true });
  });

  it('mounts the live Drive adapter without auditing a token and returns both secret codes', async () => {
    const accessToken = 'live-access-token-never-audit';
    const selected = account();
    const audit: unknown[] = [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ storageQuota: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const driver = createGoogleConnectorHost({
      sessionUser: user,
      loadAccounts: async () => [selected],
      resolveToken: async () => token(accessToken),
      checkWorkspaceAccess: async () => undefined,
      audit: { emit: async (event) => { audit.push(event); } },
    });
    await expect(driver.readResource(hostRequest())).resolves.toMatchObject({ ok: true });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${accessToken}` });
    expect(JSON.stringify(audit)).not.toContain(accessToken);

    const unavailable = createGoogleConnectorHost({
      sessionUser: user, loadAccounts: async () => [selected], checkWorkspaceAccess: async () => undefined,
      secretPort: { resolve: async () => { throw new SecretAccessError('secret_not_active'); } },
    });
    await expect(unavailable.readResource(hostRequest())).resolves.toMatchObject({
      error: { code: 'connector_secret_unavailable', retriable: false },
    });
    const unreadable = createGoogleConnectorHost({
      sessionUser: user, loadAccounts: async () => [selected], checkWorkspaceAccess: async () => undefined,
      secretPort: { resolve: async () => { throw new SecretEnvelopeError('bad envelope', { reason: 'malformed_payload', version: 'v1' }); } },
    });
    await expect(unreadable.readResource(hostRequest())).resolves.toMatchObject({
      error: { code: 'connector_secret_unreadable', retriable: true, detail: { reason: 'malformed_payload', version: 'v1' } },
    });
  });

  it('denies unbound capabilities and inaccessible workspaces as missing', async () => {
    const selected = account();
    const driver = createGoogleConnectorHost({
      sessionUser: user, loadAccounts: async () => [selected], resolveToken: async () => token(),
      checkWorkspaceAccess: async (_userId, workspaceId) => { if (workspaceId !== user.workspaceId) throw new Error('denied'); },
    });
    // A capability outside the finite read-only P1 allowlist (a write op) is denied as missing
    // before any adapter or network call — this is the deny-by-default boundary, not an API result.
    await expect(driver.invoke(hostRequest({ capabilityRef: 'files.delete', input: {} }))).resolves.toMatchObject({
      error: { code: 'connector_not_found' },
    });
    await expect(driver.readResource(hostRequest({ requestedWorkspaceRef: 'workspace-2' }))).resolves.toMatchObject({
      error: { code: 'connector_not_found' },
    });
  });
});
