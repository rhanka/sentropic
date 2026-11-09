import { describe, expect, it, vi } from 'vitest';
import {
  createCachedOpsRecipientsPort,
  fetchOpsProductRecipients,
  OpsProductRecipientsError,
  validateOpsProductRecipientsPayload,
  type OpsMinimalResponse,
} from '../src/notifications/index.js';

const T0 = '2026-11-09T10:00:00.000Z';

const answer = (extra: Record<string, unknown> = {}) => ({
  v: 1 as const,
  target: 'immo-prod',
  asOf: T0,
  admins: [
    { accountRef: 'u-owner', email: 'Owner@Example.com ', basis: ['workspace:manage_members'] },
    { accountRef: 'u-farid', email: 'farid@example.com', basis: ['app:is_admin'] },
  ],
  ...extra,
});

const response = (payload: unknown, status = 200): OpsMinimalResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

describe('validateOpsProductRecipientsPayload', () => {
  it('accepts a versioned answer for the expected target and normalizes entries', () => {
    const validated = validateOpsProductRecipientsPayload(answer(), 'immo-prod', T0);
    expect(validated.recipients).toEqual([
      { accountId: 'u-owner', email: 'owner@example.com', basis: 'workspace:manage_members' },
      { accountId: 'u-farid', email: 'farid@example.com', basis: 'app:is_admin' },
    ]);
    expect(validated.skipped).toEqual([]);
  });

  it('rejects a wrong version, a foreign target, and a bad clock', () => {
    expect(() => validateOpsProductRecipientsPayload(answer({ v: 2 }), 'immo-prod', T0))
      .toThrowError(OpsProductRecipientsError);
    expect(() => validateOpsProductRecipientsPayload(answer({ target: 'other' }), 'immo-prod', T0))
      .toThrowError(/another product/);
    expect(() => validateOpsProductRecipientsPayload(answer({ asOf: 'not-a-date' }), 'immo-prod', T0))
      .toThrowError(OpsProductRecipientsError);
    expect(() => validateOpsProductRecipientsPayload(answer({ asOf: '2026-11-09T10:06:00.000Z' }), 'immo-prod', T0))
      .toThrowError(/future/);
    expect(() => validateOpsProductRecipientsPayload(answer({ asOf: '2026-11-07T10:00:00.000Z' }), 'immo-prod', T0))
      .toThrowError(/older than 24 h/);
  });

  it('skips invalid admin entries with reasons instead of failing the target', () => {
    const validated = validateOpsProductRecipientsPayload(answer({
      admins: [
        { accountRef: '', email: 'ghost@example.com', basis: ['app:is_admin'] },
        { accountRef: 'u-nobasis', email: 'nobasis@example.com', basis: [] },
        { accountRef: 'u-badmail', email: 'not-an-email', basis: ['app:is_admin'] },
        { accountRef: 'u-ok', email: 'ok@example.com', basis: ['app:is_admin'] },
      ],
    }), 'immo-prod', T0);
    expect(validated.recipients).toEqual([
      { accountId: 'u-ok', email: 'ok@example.com', basis: 'app:is_admin' },
    ]);
    expect(validated.skipped.map((s) => s.reason)).toEqual(['bad_account_ref', 'bad_basis', 'invalid_email']);
  });

  it('accepts an empty admin list so the caller raises the configuration alert', () => {
    const validated = validateOpsProductRecipientsPayload(answer({ admins: [] }), 'immo-prod', T0);
    expect(validated.recipients).toEqual([]);
  });
});

describe('fetchOpsProductRecipients', () => {
  it('queries the target URL and validates the answer', async () => {
    const fetchFn = vi.fn(async () => response(answer()));
    const validated = await fetchOpsProductRecipients({
      url: 'https://immo.example.com/api/v1/ops/recipients',
      targetKey: 'immo-prod',
      fetchFn,
      nowIso: T0,
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('target=immo-prod');
    expect(validated.recipients).toHaveLength(2);
  });

  it('maps timeout, HTTP errors and bad JSON to typed failures', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    await expect(fetchOpsProductRecipients({
      url: 'https://x.example.com', targetKey: 'immo-prod',
      fetchFn: async () => { throw timeout; }, nowIso: T0,
    })).rejects.toMatchObject({ code: 'timeout' });
    await expect(fetchOpsProductRecipients({
      url: 'https://x.example.com', targetKey: 'immo-prod',
      fetchFn: async () => response({}, 500), nowIso: T0,
    })).rejects.toMatchObject({ code: 'bad_status' });
    await expect(fetchOpsProductRecipients({
      url: 'https://x.example.com', targetKey: 'immo-prod',
      fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error('nope'); } }),
      nowIso: T0,
    })).rejects.toMatchObject({ code: 'invalid_json' });
  });
});

describe('createCachedOpsRecipientsPort', () => {
  it('caches for 10 min and serves stale answers for 24 h on error', async () => {
    let now = Date.parse(T0);
    const load = vi.fn(async () => validateOpsProductRecipientsPayload(answer(), 'immo-prod', new Date(now).toISOString()));
    const port = createCachedOpsRecipientsPort({ load, now: () => new Date(now).toISOString() });
    await port.listRecipientsForTarget('immo-prod');
    await port.listRecipientsForTarget('immo-prod');
    expect(load).toHaveBeenCalledTimes(1);
    now += 11 * 60 * 1000;
    await port.listRecipientsForTarget('immo-prod');
    expect(load).toHaveBeenCalledTimes(2);
    load.mockRejectedValueOnce(new OpsProductRecipientsError('timeout', 'down'));
    now += 60 * 1000;
    const stale = await port.listRecipientsForTarget('immo-prod');
    expect(stale).toHaveLength(2);
    load.mockRejectedValue(new OpsProductRecipientsError('timeout', 'down'));
    now += 25 * 60 * 60 * 1000;
    await expect(port.listRecipientsForTarget('immo-prod')).rejects.toMatchObject({ code: 'timeout' });
  });
});
