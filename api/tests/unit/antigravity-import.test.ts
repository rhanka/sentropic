import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AntigravityEnrollmentError, importAntigravityEnrollment } from '../../src/services/provider-connections';
import { storeAntigravityAccountTransport } from '../../src/services/llm-account-transports';
import { settingsService } from '../../src/services/settings';
import { db } from '../../src/db/client';

vi.mock('../../src/services/llm-account-transports', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/llm-account-transports')>(),
  storeAntigravityAccountTransport: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/settings', () => ({ settingsService: { set: vi.fn() } }));
vi.mock('../../src/db/client', () => ({ db: { run: vi.fn() } }));

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const input = {
  accessToken: 'imported-access', refreshToken: 'imported-refresh', updatedByUserId: 'admin',
};

describe('Antigravity import', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([-1000, 30_000, null, 'invalid'])(
    'should refresh before discovery and persist fresh credentials for expiry %s', async (expiry) => {
      fetchMock
        .mockResolvedValueOnce(response({ access_token: 'fresh-access', refresh_token: 'rotated-refresh', expires_in: 3600 }))
        .mockResolvedValueOnce(response({ cloudaicompanionProject: 'project', currentTier: { id: 'free-tier' } }))
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(response({ sub: 'account', email: 'account@example.com' }));
      const started = Date.now();
      await importAntigravityEnrollment({
        ...input, expiresAt: typeof expiry === 'number' ? new Date(started + expiry).toISOString() : expiry,
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
      expect(fetchMock.mock.calls[0][1].body.get('refresh_token')).toBe('imported-refresh');
      for (const index of [1, 2]) {
        expect(fetchMock.mock.calls[index][1].headers.Authorization).toBe('Bearer fresh-access');
      }
      expect(storeAntigravityAccountTransport).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: 'fresh-access', refreshToken: 'rotated-refresh', project: 'project',
        accountLabel: 'account@example.com', externalAccountId: 'account',
      }));
      const stored = vi.mocked(storeAntigravityAccountTransport).mock.calls[0][0];
      expect(Date.parse(stored.expiresAt!)).toBeGreaterThanOrEqual(started + 3_600_000);
    },
  );

  it('should retain the imported refresh token when Google refreshes without rotation', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: 'fresh-access', expires_in: 3600 }))
      .mockResolvedValueOnce(response({ cloudaicompanionProject: 'project' }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ sub: 'account' }));

    await importAntigravityEnrollment(input);

    expect(storeAntigravityAccountTransport).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'fresh-access', refreshToken: 'imported-refresh', project: 'project',
    }));
  });

  it('should retain a fresh imported token and tolerate unavailable optional profile metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ cloudaicompanionProject: 'project' }))
      .mockResolvedValueOnce(response({}))
      .mockRejectedValueOnce(new Error('profile unavailable'));
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    await importAntigravityEnrollment({ ...input, expiresAt });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain(':loadCodeAssist');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer imported-access');
    expect(storeAntigravityAccountTransport).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt,
    }));
  });

  it.each(['refresh_failed', 'discovery_failed', 'missing_project', 'onboarding_failed'])(
    'should surface typed %s without storing a connected account', async (code) => {
      if (code !== 'refresh_failed') {
        fetchMock.mockResolvedValueOnce(response({ access_token: 'fresh', expires_in: 3600 }));
      }
      if (code === 'onboarding_failed') {
        fetchMock.mockResolvedValueOnce(response({ cloudaicompanionProject: 'project' }));
      }
      fetchMock.mockResolvedValueOnce(response({}, code === 'missing_project' ? 200 : 401));
      const error = await importAntigravityEnrollment({ ...input, project: 'override' }).catch((caught) => caught);
      expect(error).toBeInstanceOf(AntigravityEnrollmentError);
      expect(error.code).toBe(code);
      if (code === 'missing_project') expect(error.message).toContain('cloudaicompanionProject');
      else expect(error.cause).toBeInstanceOf(Error);
      expect(fetchMock).toHaveBeenCalledTimes(code === 'refresh_failed' ? 1 : code === 'onboarding_failed' ? 3 : 2);
      expect(storeAntigravityAccountTransport).not.toHaveBeenCalled();
      expect(settingsService.set).not.toHaveBeenCalled();
      expect(db.run).not.toHaveBeenCalled();
    },
  );
});
