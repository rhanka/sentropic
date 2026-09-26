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
const paste = (expired = false, refreshToken = REFRESH) => JSON.stringify({ accessToken: ACCESS, refreshToken,
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
  it('refuses an already stored Claude grant for the same owner after restart', async () => {
    const { service, create } = setup();
    const first = await service.completeClaudeCredentialImport(paste(), owner);
    const error = await assertSafe(create().completeClaudeCredentialImport(paste(), owner));
    expect((error as Error).message).toBe('This Claude credential is already enrolled');
    expect((await service.listAccounts(owner)).map((account) => account.accountId)).toEqual([first.accountId]);
    await service.completeClaudeCredentialImport(paste(), 'another-owner');
    await service.removeAccount(first.accountId, owner);
    const next = await service.completeClaudeCredentialImport(paste(), owner);
    expect(next.accountId).not.toBe(first.accountId);
    expect(await service.listAccounts(owner)).toHaveLength(1);
  });

  it('serializes duplicate grant checks with concurrent import persistence', async () => {
    const { service, create } = setup();
    const results = await Promise.allSettled([
      service.completeClaudeCredentialImport(paste(), owner),
      service.completeClaudeCredentialImport(paste(), owner),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toBe('This Claude credential is already enrolled');
    expect(await create().listAccounts(owner)).toHaveLength(1);
  });

  it('retains previously granted scopes across restart when refresh omits scope', async () => {
    const { service, create, fetchFn, keyring } = setup();
    const { accountId } = await service.completeClaudeCredentialImport(paste(true), owner);
    fetchFn.mockImplementation(async () => new Response(JSON.stringify({ access_token: ACCESS,
      refresh_token: REFRESH, expires_in: 3600 })));
    await create().acquire(acquire);
    const pub = JSON.parse((await keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`))!);
    expect(pub.account.metadata.scopes).toEqual(['user:inference']);
    await create().acquire({ ...acquire, now: Date.now() + 7200_000 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each(['read', 'write', 'write-then-throw', 'profile', 'missing-token'])(
    'keeps a pre-request %s failure retryable without requiring reauthentication', async (kind) => {
      const { service, keyring, fetchFn, configResolver, create } = setup();
      const custom = { id: 'custom-retry-v1', authorizationUrl: 'https://auth.example.test/authorize',
        tokenUrl: 'https://auth.example.test/token', redirectUri: 'https://auth.example.test/callback',
        clientId: 'test-client', source: 'https://source.example.test/v1', authorizationScopes: ['user:inference'],
        refreshScopes: ['user:inference'], requiredScopes: ['user:inference'] };
      if (kind === 'profile') configResolver.resolveConfig.mockResolvedValue(custom);
      const { accountId } = await service.completeClaudeCredentialImport(paste(true), owner);
      const pubKey = `sentropic-llm-mesh:${accountId}:public`;
      const read = keyring.getSecret.bind(keyring);
      const save = keyring.setSecret.bind(keyring);
      if (kind === 'read') keyring.getSecret = async (key) => {
        if (key === pubKey) { keyring.getSecret = read; throw new Error(REFRESH); }
        return read(key);
      };
      if (kind.startsWith('write')) keyring.setSecret = async (key, value) => {
        if (key === pubKey) {
          keyring.setSecret = save;
          if (kind === 'write-then-throw') await save(key, value);
          throw new Error(REFRESH);
        }
        await save(key, value);
      };
      if (kind === 'profile') configResolver.resolveConfig.mockRejectedValueOnce(new Error(REFRESH));
      if (kind === 'missing-token') (service as any).accountsMap.get(accountId).refreshToken = undefined;
      const error = await assertSafe(service.acquire(acquire));
      expect(error).toBeInstanceOf(AccountTransportAcquireError);
      expect(String(error)).toContain('retry');
      expect(String(error)).not.toContain('reauthentication required');
      expect(fetchFn).not.toHaveBeenCalled();
      expect((await service.listAccounts(owner))[0].status).toBe('active');
      expect((await create().acquire(acquire)).material.accountId).toBe(accountId);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

  it.each(['provider-5xx', 'rate-limited'] as const)('keeps the refresh fence when a concurrent route records %s', async (reason) => {
    const { service, keyring, fetchFn, create } = setup();
    const { accountId } = await service.completeClaudeCredentialImport(paste(), owner);
    const directory = service.createRouteDirectory({ generate: vi.fn(), stream: vi.fn() });
    const attempt = await directory.prepareAttempt({
      subject: { principalRef: 'test', ownerScopeRef: owner }, accountRef: accountId,
      target: { requestedModel: 'claude-opus-4-6', providerId: 'anthropic',
        modelId: 'claude-opus-4-6', transportProviderId: 'claude-code', reason: 'exact' },
      requestId: 'fence-race', attemptIndex: 0,
    });
    let finish!: (value: Response) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    fetchFn.mockImplementationOnce(() => { enter(); return new Promise((resolve) => { finish = resolve; }); });
    const pending = service.acquire({ ...acquire, now: Date.now() + 7200_000 });
    await entered;
    await attempt.recordOutcome({ reason, retryAfterMs: 1, retryable: true, healthScope: 'account' });
    const pub = JSON.parse((await keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`))!);
    const save = keyring.setSecret.bind(keyring);
    keyring.setSecret = async () => { throw new Error(REFRESH); };
    finish(response());
    await assertSafe(pending);
    keyring.setSecret = save;
    const restored = create().acquire({ ...acquire, now: Date.now() + 7200_000 });
    const result = await restored.then(() => null, (error) => error);
    expect(pub.status).toBe('reauth_required');
    expect(pub.account.status).toBe('reauth_required');
    expect(result).toBeInstanceOf(AccountTransportAcquireError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not replay old refresh material after rotation followed by a storage outage', async () => {
    const { service, keyring, fetchFn, create } = setup();
    await service.completeClaudeCredentialImport(paste(true), owner);
    const save = keyring.setSecret.bind(keyring);
    let storageUnavailable = false;
    keyring.setSecret = async (key, value) => {
      if (storageUnavailable) throw new Error(REFRESH);
      await save(key, value);
    };
    fetchFn.mockImplementation(async () => { storageUnavailable = true; return response(); });
    await assertSafe(service.acquire(acquire));
    storageUnavailable = false;
    await assertSafe(create().acquire(acquire));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('refuses a colliding immutable foreign owner claim without touching its records', async () => {
    const { provider, service, keyring } = setup();
    const credential = await provider.importCredential(paste());
    vi.spyOn(provider, 'importCredential').mockResolvedValue(credential);
    const prefix = `sentropic-llm-mesh:${credential.accountId}`;
    await keyring.setSecret(`${prefix}:owner`, JSON.stringify({ v: 1, accountId: credential.accountId, ownerScopeRef: 'foreign' }));
    await keyring.setSecret(`${prefix}:envelope`, 'foreign-envelope-canary');
    await assertSafe(service.completeClaudeCredentialImport(paste(), owner));
    expect(await keyring.getSecret(`${prefix}:envelope`)).toBe('foreign-envelope-canary');
    expect(await keyring.getSecret(`${prefix}:removed`)).toBeNull();
  });

  it('does not enroll without atomic owner-claim support', async () => {
    const { service, keyring } = setup();
    keyring.setSecretIfAbsent = undefined as any;
    await assertSafe(service.completeClaudeCredentialImport(paste(), owner));
    expect(await keyring.getSecret('sentropic-llm-mesh:accounts:index')).toBeNull();
  });

  it.each([false, true])('holds real Claude refresh through save failure=%s', async (fail) => {
    const { service, keyring, create, fetchFn } = setup();
    const { accountId } = await service.completeClaudeCredentialImport(paste(true), owner);
    fetchFn.mockResolvedValue(new Response(JSON.stringify({ access_token: 'FAKE_FRESH_ACCESS_CANARY',
      refresh_token: 'FAKE_ROTATED_REFRESH_CANARY', expires_in: 3600, scope: 'user:inference user:profile' })));
    const save = keyring.setSecret.bind(keyring);
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    keyring.setSecret = async (key, value) => {
      if (key.endsWith(':envelope')) { enter(); await gate; if (fail) throw new Error(REFRESH); }
      await save(key, value);
    };
    let served = 0;
    const request = () => service.acquire(acquire).then((value) => { served++; return value; });
    const first = request();
    await entered;
    const second = request();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(served).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    finish();
    if (fail) {
      await Promise.all([assertSafe(first), assertSafe(second)]);
      await assertSafe(create().acquire(acquire));
    } else {
      expect((await Promise.all([first, second])).every((value) => value.material.accessToken === 'FAKE_FRESH_ACCESS_CANARY')).toBe(true);
      const pub = JSON.parse((await keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`))!);
      expect(pub.account.metadata.scopes).toEqual(['user:inference', 'user:profile']);
      expect(pub.account.metadata.enrollmentMethod).toBe('credential-import');
      expect((await create().acquire(acquire)).material.refreshToken).toBe('FAKE_ROTATED_REFRESH_CANARY');
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it.each(['envelope', 'public', 'index'])('fails closed on partial %s save without publishing secrets', async (part) => {
    const { service, create, keyring } = setup();
    const save = keyring.setSecret.bind(keyring);
    let failed = false;
    keyring.setSecret = async (key, value) => {
      // Fail after the write too: the caller cannot infer whether storage committed.
      await save(key, value);
      if (!failed && key.endsWith(`:${part}`)) { failed = true; throw new Error(`${ACCESS} ${REFRESH}`); }
    };
    await assertSafe(service.completeClaudeCredentialImport(paste(), owner));
    await expect(service.listAccounts(owner)).resolves.toEqual([]);
    await expect(create().listAccounts(owner)).resolves.toEqual([]);
    await assertSafe(create().acquire(acquire));
  });

  it.each(['success', 'cancel', 'remove'])('keeps completion unavailable during index save, then %s', async (mode) => {
    const { service, keyring } = setup();
    const save = keyring.setSecret.bind(keyring);
    let enter!: () => void;
    let finish!: () => void;
    const paused = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let accountId = '';
    keyring.setSecret = async (key, value) => {
      if (key.endsWith(':index')) { accountId = JSON.parse(value)[0]; enter(); await gate; }
      await save(key, value);
    };
    const session = await service.enroll('claude-code', start);
    const completion = service.completeClaudeEnrollment(session.enrollmentId, codeFor(session), owner);
    await paused;
    await assertSafe(service.acquire(acquire));
    expect(await service.listAccounts(owner)).toEqual([]);
    if (mode === 'cancel') await service.cancel(session.enrollmentId);
    if (mode === 'remove') await service.removeAccount(accountId, owner);
    finish();
    if (mode === 'success') {
      expect((await completion).accountId).toBe(accountId);
      expect((await service.acquire(acquire)).material.accountId).toBe(accountId);
    } else {
      await assertSafe(completion);
      await assertSafe(service.acquire(acquire));
      expect(await keyring.getSecret(`sentropic-llm-mesh:${accountId}:envelope`)).toBeNull();
    }
  });

  it.each(['network', 'invalid_grant', 'unknown-profile', 'empty-refresh'])(
    'keeps %s refresh failure and AcquireError secret-free across restart', async (kind) => {
      const { service, fetchFn, keyring, create } = setup();
      const { accountId } = await service.completeClaudeCredentialImport(paste(true), owner);
      if (kind === 'network') fetchFn.mockRejectedValue(new Error(`${ACCESS} ${REFRESH} ${CODE}`));
      if (kind === 'invalid_grant') fetchFn.mockResolvedValue(new Response(JSON.stringify({
        error: 'invalid_grant', error_description: `${ACCESS} ${REFRESH}` }), { status: 400 }));
      if (kind === 'empty-refresh') fetchFn.mockResolvedValue(new Response(JSON.stringify({
        access_token: ACCESS, refresh_token: '', expires_in: 3600, scope: 'user:inference' })));
      if (kind === 'unknown-profile') {
        const key = `sentropic-llm-mesh:${accountId}:envelope`;
        const envelope = JSON.parse((await keyring.getSecret(key))!);
        await keyring.setSecret(key, JSON.stringify({ ...envelope, authClientConfigVersion: 'v1.0.0' }));
      }
      const error = await assertSafe(create().acquire(acquire));
      expect(error).toBeInstanceOf(AccountTransportAcquireError);
      expect(String(error)).toContain('reauthentication required');
      expect((await service.listAccounts(owner))[0].status).toBe('reauth_required');
      await assertSafe(create().acquire(acquire));
      expect(fetchFn).toHaveBeenCalledTimes(kind === 'unknown-profile' ? 0 : 1);
    });

  it.each(['cancel', 'expire', 'remove'])('cannot resurrect an account after %s during HTTP', async (mode) => {
    const { service, fetchFn, create } = setup();
    let complete!: (value: Response) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    fetchFn.mockImplementation(() => { enter(); return new Promise((resolve) => { complete = resolve; }); });
    const session = await service.enroll('claude-code', start);
    let accountId: string | undefined;
    if (mode === 'remove') accountId = (await service.completeClaudeCredentialImport(paste(true), owner)).accountId;
    const pending = accountId ? service.acquire(acquire)
      : service.completeClaudeEnrollment(session.enrollmentId, codeFor(session), owner);
    await entered;
    if (mode === 'remove') await service.removeAccount(accountId!, owner);
    if (mode === 'cancel') await service.cancel(session.enrollmentId);
    if (mode === 'expire') { vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60_000); }
    complete(response());
    const error = await assertSafe(pending);
    if (mode === 'remove') expect(String(error)).toContain('has been removed');
    await service.cancel(session.enrollmentId);
    expect(await create().listAccounts(owner)).toEqual([]);
  });
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
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      service.completeClaudeCredentialImport(paste(false, `${REFRESH}_${index}`), owner)));
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
