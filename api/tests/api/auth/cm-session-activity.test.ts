import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../../src/db/client';
import { logger } from '../../../src/logger';
import { touchCmSessionActivity } from '../../../src/services/identity/cm-session-activity';

vi.mock('../../../src/db/client', () => ({ pool: { query: vi.fn() } }));
vi.mock('../../../src/logger', () => ({ logger: { warn: vi.fn() } }));

describe('best-effort CM session activity', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    ['40001', '40001'],
    ['ECONNRESET', 'identity_host_failure'],
  ])('sanitizes %s without failing the authenticated request', async (driverCode, publicCode) => {
    const error = Object.assign(new Error('private database connection details'), {
      code: driverCode, detail: 'private query parameters',
      cause: new Error('private infrastructure cause'),
    });
    vi.mocked(pool.query).mockRejectedValueOnce(error);

    await expect(touchCmSessionActivity('test-session', new Date('2026-11-06T00:00:00Z'))).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { code: publicCode, sessionId: 'test-session' }, 'CM session activity touch unavailable',
    );
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
  });
});
