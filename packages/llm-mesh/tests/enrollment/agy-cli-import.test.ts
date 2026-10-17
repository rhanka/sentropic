import { describe, expect, it, vi } from 'vitest';
import {
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
    const hooks = { persist: vi.fn(), acquire: vi.fn(), providerCall: vi.fn() };
    const result = translateAgySeatToApplication({ ...base }, hooks);
    expect(result).toMatchObject({
      transportProviderId: 'antigravity',
      targetProviderId: 'cloudcode-pa',
      productAccountSource: 'antigravity',
    });
    expect(hooks.persist).not.toHaveBeenCalled();
    expect(hooks.acquire).not.toHaveBeenCalled();
    expect(hooks.providerCall).not.toHaveBeenCalled();
  });

  it('refuses a gemini target with zero side effects', () => {
    const hooks = { persist: vi.fn(), acquire: vi.fn(), providerCall: vi.fn() };
    expect(() =>
      translateAgySeatToApplication({ ...base, requestedTargetProviderId: 'gemini' }, hooks),
    ).toThrow(/gemini/);
    expect(hooks.persist).not.toHaveBeenCalled();
    expect(hooks.acquire).not.toHaveBeenCalled();
    expect(hooks.providerCall).not.toHaveBeenCalled();
  });

  it('refuses the application cloud-code transport with zero side effects', () => {
    const hooks = { persist: vi.fn(), acquire: vi.fn(), providerCall: vi.fn() };
    expect(() =>
      translateAgySeatToApplication({ ...base, requestedTransportProviderId: 'cloud-code' }, hooks),
    ).toThrow(/cloud-code/);
    expect(hooks.persist).not.toHaveBeenCalled();
    expect(hooks.acquire).not.toHaveBeenCalled();
    expect(hooks.providerCall).not.toHaveBeenCalled();
  });

  it('refuses mixed tuples with zero side effects', () => {
    const hooks = { persist: vi.fn(), acquire: vi.fn(), providerCall: vi.fn() };
    expect(() =>
      translateAgySeatToApplication(
        { ...base, requestedTargetProviderId: 'gemini', requestedTransportProviderId: 'cloud-code' },
        hooks,
      ),
    ).toThrow();
    expect(hooks.persist).not.toHaveBeenCalled();
  });

  it('refuses wrong package ids and wrong clients before any call', () => {
    const hooks = { persist: vi.fn(), acquire: vi.fn(), providerCall: vi.fn() };
    expect(() => translateAgySeatToApplication({ ...base, packageProviderId: 'antigravity' }, hooks)).toThrow();
    expect(() =>
      translateAgySeatToApplication({ ...base, packageAccountTransport: 'antigravity' }, hooks),
    ).toThrow();
    expect(() => translateAgySeatToApplication({ ...base, issuingClientRef: '' }, hooks)).toThrow();
    expect(hooks.persist).not.toHaveBeenCalled();
    expect(hooks.acquire).not.toHaveBeenCalled();
    expect(hooks.providerCall).not.toHaveBeenCalled();
  });
});
