import { describe, expect, it, vi } from 'vitest';
import {
  persistAgySeatProjection,
  translateAgySeatToApplication,
} from '../../src/enrollment/agy-cli-import.js';

const base = {
  packageProviderId: 'cloud-code',
  packageAccountTransport: 'cloud-code',
  issuingClientRef: 'client-synth-agy-01',
  endpointFamily: 'endpoint-synth-agy-01',
  ownerScope: 'owner-synth-01',
  seatRef: 'seat-synth-agy-01',
  accountBinding: 'binding-synth-agy-01',
  requestedTargetProviderId: 'cloudcode-pa',
  requestedTransportProviderId: 'antigravity',
};

describe('agy-cli-import', () => {
  it('accepts the exact package cloud-code to application antigravity/cloudcode-pa tuple', () => {
    expect(translateAgySeatToApplication({ ...base })).toMatchObject({
      transportProviderId: 'antigravity',
      targetProviderId: 'cloudcode-pa',
      productAccountSource: 'antigravity',
    });
  });

  it('refuses a gemini target', () => {
    expect(() => translateAgySeatToApplication({ ...base, requestedTargetProviderId: 'gemini' })).toThrow(
      /gemini/,
    );
  });

  it('refuses the application cloud-code transport', () => {
    expect(() =>
      translateAgySeatToApplication({ ...base, requestedTransportProviderId: 'cloud-code' }),
    ).toThrow(/cloud-code/);
  });

  it('refuses mixed tuples', () => {
    expect(() =>
      translateAgySeatToApplication({
        ...base,
        requestedTargetProviderId: 'gemini',
        requestedTransportProviderId: 'cloud-code',
      }),
    ).toThrow();
  });

  it('refuses wrong package ids and wrong clients', () => {
    expect(() => translateAgySeatToApplication({ ...base, packageProviderId: 'antigravity' })).toThrow();
    expect(() => translateAgySeatToApplication({ ...base, packageAccountTransport: 'antigravity' })).toThrow();
    expect(() => translateAgySeatToApplication({ ...base, issuingClientRef: '' })).toThrow();
  });

  it('persists only after validation, with the exact tuple', async () => {
    const persist = vi.fn(async () => undefined);
    const tuple = await persistAgySeatProjection({ ...base }, { persist });
    expect(tuple).toMatchObject({ transportProviderId: 'antigravity', targetProviderId: 'cloudcode-pa' });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(tuple, {
      seatRef: 'seat-synth-agy-01',
      accountBinding: 'binding-synth-agy-01',
      ownerScope: 'owner-synth-01',
    });
  });

  it.each([
    ['gemini target', { requestedTargetProviderId: 'gemini' }],
    ['cloud-code transport', { requestedTransportProviderId: 'cloud-code' }],
    ['wrong package', { packageProviderId: 'gemini' }],
    ['wrong client', { issuingClientRef: '' }],
  ])('never touches persistence when refusing (%s)', async (_label, overrides) => {
    const persist = vi.fn(async () => undefined);
    await expect(persistAgySeatProjection({ ...base, ...overrides }, { persist })).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  });
});
