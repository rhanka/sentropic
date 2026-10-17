import { describe, expect, it, vi } from 'vitest';
import {
  parseCliSeatProfile,
  parseTokenSeatEnvelope,
  sameSeatLineage,
} from '../../src/enrollment/cli-seat-import.js';
import { SEAT_PACKAGE_PROVIDER_ID } from '../../src/enrollment/seat-bundle.js';
import type { SeatCli } from '../../src/enrollment/seat-bundle.js';

const CLIS: SeatCli[] = ['agy', 'codex', 'vibe', 'muse', 'claude'];

const profile = (cli: SeatCli) => ({
  cli,
  seatRef: `seat-synth-${cli}-01`,
  refreshFamilyRef: `family-synth-${cli}-01`,
  ownerScope: 'owner-synth-01',
  issuingClientRef: `client-synth-${cli}-01`,
  endpointFamily: `endpoint-synth-${cli}-01`,
  accountBinding: `binding-synth-${cli}-01`,
  entitlementClass: 'lab-seat',
  epoch: 1,
  generation: 2,
  operationId: `op-synth-${cli}-01`,
  issuedAt: '2026-10-17T00:00:00Z',
  accessRef: `access-synth-${cli}-01`,
});

describe('cli-seat-import', () => {
  it.each(CLIS)('parses a consumer --from cli profile for %s', (cli) => {
    const bundle = parseCliSeatProfile({ ...profile(cli), ownerScope: 'owner-synth-01' });
    expect(bundle.identity.packageProviderId).toBe(SEAT_PACKAGE_PROVIDER_ID[cli]);
    expect(bundle.authority).toBe('consumer');
    expect(bundle.lifecycle.refreshAuthority).toBe('none');
    expect(bundle.canonical).toBeUndefined();
  });

  it.each(CLIS)('converges --from cli and --from token on the same seat for %s', (cli) => {
    const fromCli = parseCliSeatProfile(profile(cli));
    const fromToken = parseTokenSeatEnvelope({
      raw: JSON.stringify({ ...fromCli }),
      ownerScope: 'owner-synth-01',
    });
    expect(sameSeatLineage(fromCli, fromToken)).toBe(true);
  });

  it('refuses a profile without a custodian-observed issuedAt', () => {
    const { issuedAt: _dropped, ...dateless } = profile('claude');
    expect(() => parseCliSeatProfile(dateless)).toThrow(/issuedAt/);
  });

  it('refuses a token envelope above the 48 KiB secret bound', () => {
    const big = parseCliSeatProfile(profile('claude'));
    const raw = JSON.stringify({ ...big, meshUse: { kind: 'access', accessRef: `x`.repeat(50 * 1024) } });
    try {
      parseTokenSeatEnvelope({ raw, ownerScope: 'owner-synth-01' });
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe('size-exceeded');
    }
  });

  it('refuses a wrong-owner envelope without mutation', () => {
    const fromCli = parseCliSeatProfile(profile('codex'));
    expect(() =>
      parseTokenSeatEnvelope({ raw: JSON.stringify(fromCli), ownerScope: 'owner-other-01' }),
    ).toThrow(/owner/);
  });

  it('refuses a renewable consumer class without a custodian channel', () => {
    const fromCli = parseCliSeatProfile(profile('vibe'));
    const tampered = { ...fromCli, credentialClass: 'renewable' };
    expect(() => parseTokenSeatEnvelope({ raw: JSON.stringify(tampered), ownerScope: 'owner-synth-01' })).toThrow();
  });

  it('rejects unparseable envelopes without provider calls', () => {
    expect(() => parseTokenSeatEnvelope({ raw: '{not-json', ownerScope: 'owner-synth-01' })).toThrow(
      /not JSON-serializable|unexpected|parse/i,
    );
  });

  it('performs no provider exchange, mint, or store reread on either mode', () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network must stay untouched');
    });
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;
    try {
      const fromCli = parseCliSeatProfile(profile('muse'));
      parseTokenSeatEnvelope({ raw: JSON.stringify(fromCli), ownerScope: 'owner-synth-01' });
    } finally {
      (globalThis as Record<string, unknown>)['fetch'] = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
