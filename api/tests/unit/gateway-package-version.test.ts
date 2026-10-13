import { createGatewayRouter } from '@sentropic/llm-gateway';
import { describe, expect, it, vi } from 'vitest';
import { gatewayNativeMessagesEnabled } from '../../src/services/llm-runtime/gateway-native-config';
import { GATEWAY_PACKAGE_NAME, gatewayStartupRecord, resolveGatewayPackageVersion,
  type GatewayVersionLoader } from '../../src/services/llm-runtime/gateway-package-version';

const fixture = (manifest: unknown = { name: GATEWAY_PACKAGE_NAME, version: '0.20.0' }) => {
  const source: GatewayVersionLoader = {
    resolve: vi.fn(() => 'file:///artifact/gateway/dist/index.js'),
    load: vi.fn(async () => ({ createGatewayRouter })),
    read: vi.fn(async path => {
      if (path === '/artifact/gateway/package.json') return JSON.stringify(manifest);
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }),
  };
  return source;
};
describe('running gateway version evidence', () => {
  it('resolves the real API-imported instance and its release tuple', async () => {
    expect(await resolveGatewayPackageVersion()).toBe('0.20.0');
  });
  it('walks from the resolved entry without resolving a non-exported package.json subpath', async () => {
    const source = fixture();
    expect(await resolveGatewayPackageVersion(source)).toBe('0.20.0');
    expect(source.resolve).toHaveBeenCalledOnce();
    expect(source.load).toHaveBeenCalledWith('file:///artifact/gateway/dist/index.js');
    expect(source.read).toHaveBeenCalledWith('/artifact/gateway/dist/package.json');
    expect(source.read).toHaveBeenCalledWith('/artifact/gateway/package.json');
  });
  it.each(['0.20.0', '1.2.3-beta.0+build.12'])('accepts valid semantic version %s', async version => {
    expect(await resolveGatewayPackageVersion(fixture({ name: GATEWAY_PACKAGE_NAME, version }))).toBe(version);
  });
  it.each(['0.020.0', 'v0.20.0', '0.20', '0.20.0-beta.01', '0.20.0-..', '0.20.0+..',
    '999999999999999999999.20.0', null])('refuses invalid semantic version %s', async version => {
    expect(await resolveGatewayPackageVersion(fixture({ name: GATEWAY_PACKAGE_NAME, version }))).toBeUndefined();
  });
  it('refuses wrong package names, unavailable resolution and a bundled/different factory without fallback', async () => {
    expect(await resolveGatewayPackageVersion(fixture({ name: '@sentropic/other', version: '0.20.0' }))).toBeUndefined();
    const missing = fixture(); missing.resolve = () => { throw new Error('private resolution path'); };
    expect(await resolveGatewayPackageVersion(missing)).toBeUndefined();
    const bundled = fixture(); bundled.load = async () => ({ createGatewayRouter: () => undefined });
    expect(await resolveGatewayPackageVersion(bundled)).toBeUndefined();
    expect(bundled.read).not.toHaveBeenCalled();
    const absent = fixture(); absent.read = async () => { throw Object.assign(new Error('private'), { code: 'ENOENT' }); };
    expect(await resolveGatewayPackageVersion(absent)).toBeUndefined();
  });
  it('records only fixed safe fields for both OFF and unverified startup', () => {
    expect(gatewayStartupRecord('0.20.0', false)).toEqual({ packageName: GATEWAY_PACKAGE_NAME,
      resolvedVersion: '0.20.0', nativeMessagesEnabled: false });
    expect(gatewayStartupRecord(undefined, false)).toEqual({ packageName: GATEWAY_PACKAGE_NAME,
      resolvedVersion: 'version_unverified', nativeMessagesEnabled: false });
    expect(Object.isFrozen(gatewayStartupRecord('0.20.0', true))).toBe(true);
  });
  it.each([undefined, '', 'Enabled', 'true', '1', ' enabled ', 'disabled'])('keeps switch OFF for %s', value => {
    expect(gatewayNativeMessagesEnabled(value)).toBe(false);
  });
  it('enables only the exact enabled value', () => expect(gatewayNativeMessagesEnabled('enabled')).toBe(true));
});
