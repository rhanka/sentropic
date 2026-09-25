import { createClusterMeshModules } from '@sentropic/cluster-mesh';
import { loadGateway } from '@sentropic/cluster-mesh/loaders/gateway';
import { describe, expect, it } from 'vitest';

import { createHostApp, type HostDependencies } from '../src/app';
import { DRAIN_TIMEOUT_MS, loadHostConfig } from '../src/config';
import { fixtureDependencies, testConfig } from './fixtures';

const refusal = (env: Record<string, string | undefined>) => {
  try {
    loadHostConfig(env);
  } catch (error) {
    return error as { code: string; field: string; message: string };
  }
  throw new Error('configuration was accepted');
};

describe('host listener configuration', () => {
  it('accepts the production listener contract', () => {
    expect(loadHostConfig({ NODE_ENV: 'production', PORT: '3001', HOST: '0.0.0.0' })).toEqual({
      mode: 'production', port: 3001, host: '0.0.0.0', drainTimeoutMs: DRAIN_TIMEOUT_MS,
    });
    expect(DRAIN_TIMEOUT_MS).toBe(25_000);
  });

  it('defaults development to loopback on the service port', () => {
    expect(loadHostConfig({ NODE_ENV: 'development' })).toMatchObject({ port: 3001, host: '127.0.0.1' });
  });

  it.each([undefined, '', 'staging', 'PRODUCTION'])('refuses mode %s', (mode) => {
    expect(refusal({ NODE_ENV: mode, PORT: '3001', HOST: '0.0.0.0' })).toMatchObject({
      code: 'invalid_llm_gateway_host_config', field: 'NODE_ENV',
    });
  });

  it.each(['abc', '70000', '-1', '1.5', '0x10', '3001 1', '123456'])('refuses invalid PORT %s', (port) => {
    expect(refusal({ NODE_ENV: 'development', PORT: port })).toMatchObject({ field: 'PORT' });
  });

  it('allows the ephemeral port only in test mode', () => {
    expect(loadHostConfig({ NODE_ENV: 'test', PORT: '0' }).port).toBe(0);
    expect(refusal({ NODE_ENV: 'development', PORT: '0' })).toMatchObject({ field: 'PORT' });
  });

  it('pins production to port 3001 on 0.0.0.0 and requires both explicitly', () => {
    expect(refusal({ NODE_ENV: 'production', PORT: '8080', HOST: '0.0.0.0' })).toMatchObject({ field: 'PORT' });
    expect(refusal({ NODE_ENV: 'production', HOST: '0.0.0.0' })).toMatchObject({ field: 'PORT' });
    expect(refusal({ NODE_ENV: 'production', PORT: '3001', HOST: '127.0.0.1' })).toMatchObject({ field: 'HOST' });
    expect(refusal({ NODE_ENV: 'production', PORT: '3001' })).toMatchObject({ field: 'HOST' });
  });

  it('never echoes a rejected raw value', () => {
    const error = refusal({ NODE_ENV: 'production', PORT: 'sk-secret-value', HOST: 'bad host/secret' });
    expect(error.message).not.toContain('secret');
  });
});

describe('injected dependency ports', () => {
  const compose = (dependencies: HostDependencies, modules = createClusterMeshModules()) =>
    createHostApp({ config: testConfig(), dependencies, modules });

  it('refuses the gateway scaffold caller auth as a production port', async () => {
    const modules = createClusterMeshModules();
    const gateway = await loadGateway(modules);
    await expect(compose({ identity: { callerAuth: gateway.stubCallerAuth, ready: async () => true } }, modules))
      .rejects.toMatchObject({ code: 'invalid_llm_gateway_host_composition' });
  });

  it.each([
    ['identity without verify', { identity: { callerAuth: {}, ready: async (): Promise<boolean> => true } }],
    ['identity without readiness probe', { identity: { callerAuth: { verify: async () => ({ ok: false }) } } }],
    ['routing without prepareAttempt', { routing: { planner: { plan: async () => ({}) }, ready: async (): Promise<boolean> => true } }],
    ['settlement without settleRoute', { settlement: { metering: {}, ready: async (): Promise<boolean> => true } }],
    ['settlement as a non-object', { settlement: { metering: 'noop', ready: async (): Promise<boolean> => true } }],
  ])('refuses %s', async (_name, dependencies) => {
    await expect(compose(dependencies as unknown as HostDependencies))
      .rejects.toMatchObject({ code: 'invalid_llm_gateway_host_composition' });
  });

  it('accepts complete fixture ports', async () => {
    const host = await compose(fixtureDependencies().dependencies);
    expect(host.pending).toEqual([]);
  });
});
