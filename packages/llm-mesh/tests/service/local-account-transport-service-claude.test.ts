import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountTransportAcquireError } from '../../src/account-transports.js';
import { ClaudeCodeEnrollmentProvider } from '../../src/enrollment/claude-code.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';

const ACCESS = 'FAKE_SERVICE_ACCESS_CANARY_159';
const REFRESH = 'FAKE_SERVICE_REFRESH_CANARY_826';
const CODE = 'FAKE_SERVICE_CODE_CANARY_407';
const VERSION = 'claude-code-oauth-2.1.80-v1';
const owner = 'tenant:test:user:a';
const acquire = { ownerScopeRef: owner, targetProviderId: 'anthropic' as const, transportProviderId: 'claude-code' as const };
const start = { ownerScope: owner, configRef: 'claude-code', mode: 'cli' as const, redirectUri: '' };
const paste = (expired = false) => JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH,
  expiresAt: Date.now() + (expired ? -1000 : 3600_000), scopes: ['user:inference'] });
const response = () => new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH,
  expires_in: 3600, scope: 'user:inference' }));
function setup(keyring = new InMemoryKeyring(), fetchFn = vi.fn(async () => response())) {
  const configResolver = { resolveConfig: vi.fn(async () => ({})) };
  const provider = new ClaudeCodeEnrollmentProvider({ configResolver, fetchFn, nowFn: () => Date.now() });
  const create = () => new LocalAccountTransportService(keyring, new Map([['claude-code', provider]]), configResolver);
  return { keyring, fetchFn, configResolver, provider, service: create(), create };
}
async function assertSafe(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  for (const secret of [ACCESS, REFRESH, CODE]) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  }
  return error;
}
function codeFor(session: { url?: string }) { return `${CODE}#${new URL(session.url!).searchParams.get('state')}`; }
afterEach(() => vi.useRealTimers());

describe('Claude service enrollment', () => {
  it.each(['browser', 'paste'])('persists and restores %s with owner-scoped secret-free completion/listing', async (method) => {
    const { service, create, keyring, fetchFn } = setup();
    const session = method === 'browser' ? await service.enroll('claude-code', start) : undefined;
    const completion = session
      ? await service.completeClaudeEnrollment(session.enrollmentId, codeFor(session), owner)
      : await service.completeClaudeCredentialImport(paste(), owner);
    expect(Object.keys(completion).sort()).toEqual(['accountId', 'label']);
    expect(completion.label).toBe(`Claude (${completion.accountId})`);
    expect(completion.accountId).toMatch(/^acct_claude_[\w-]{22}$/);
    const prefix = `sentropic-llm-mesh:${completion.accountId}`;
    expect(JSON.parse((await keyring.getSecret(`${prefix}:envelope`))!)).toMatchObject({
      accountId: completion.accountId, accessToken: ACCESS, refreshToken: REFRESH, authClientConfigVersion: VERSION });
    const pub = await keyring.getSecret(`${prefix}:public`);
    expect(JSON.parse(pub!).account).toMatchObject({ ownerScopeRef: owner,
      targetProviderId: 'anthropic', transportProviderId: 'claude-code',
      metadata: { billing_type: 'seat', scopes: ['user:inference'] } });
    const restored = create();
    const listed = await restored.listAccounts(owner);
    for (const secret of [ACCESS, REFRESH, CODE]) {
      expect(JSON.stringify({ completion, listed, pub })).not.toContain(secret);
    }
    expect((await restored.acquire(acquire)).material.accessToken).toBe(ACCESS);
    await expect(restored.listAccounts('foreign')).resolves.toEqual([]);
    await assertSafe(restored.acquire({ ...acquire, ownerScopeRef: 'foreign' }));
    await assertSafe(restored.removeAccount(completion.accountId, 'foreign'));
    await service.removeAccount(completion.accountId, owner);
    await assertSafe(restored.acquire(acquire));
    expect(fetchFn).toHaveBeenCalledTimes(method === 'browser' ? 1 : 0);
  });

  it('validates caller/session owner before parsing, configuration or exchange', async () => {
    const { service, provider, configResolver, fetchFn } = setup();
    const parse = vi.spyOn(provider, 'importCredential');
    await assertSafe(service.completeClaudeCredentialImport(CODE, ' '));
    await assertSafe(service.enroll('claude-code', { ...start, ownerScope: ' ' }));
    expect(parse).not.toHaveBeenCalled();
    expect(configResolver.resolveConfig).not.toHaveBeenCalled();
    const session = await service.enroll('claude-code', start);
    await assertSafe(service.completeClaudeEnrollment(session.enrollmentId, codeFor(session), 'foreign'));
    expect(fetchFn).not.toHaveBeenCalled();
    await service.completeClaudeEnrollment(session.enrollmentId, codeFor(session), owner);
    await assertSafe(service.completeClaudeEnrollment(session.enrollmentId, codeFor(session), owner));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('gives concurrent imports distinct opaque identities without losing the account index', async () => {
    const { service, create } = setup();
    const results = await Promise.all(Array.from({ length: 4 }, () => service.completeClaudeCredentialImport(paste(), owner)));
    expect(new Set(results.map((result) => result.accountId)).size).toBe(4);
    expect(await create().listAccounts(owner)).toHaveLength(4);
  });

  it('imports past expiry offline then single-flights the first acquire and preserves identity/scopes', async () => {
    const { service, fetchFn, create, keyring } = setup();
    const completion = await service.completeClaudeCredentialImport(paste(true), owner);
    expect(fetchFn).not.toHaveBeenCalled();
    const restored = create();
    const results = await Promise.all([restored.acquire(acquire), restored.acquire(acquire)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.material.accountId === completion.accountId)).toBe(true);
    expect((await create().acquire(acquire)).material.accessToken).toBe(ACCESS);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await keyring.getSecret(`sentropic-llm-mesh:${completion.accountId}:public`)).toContain('user:inference');
  });
});
