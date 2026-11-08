import { describe, expect, it } from 'vitest';
import { fixture, key, placement as fixturePlacement } from './fixture';
import { builderPlacement } from '../../../src/services/artifacts/live/placement';
import { builderPod } from '../../../src/services/artifacts/live/pods';
import { artifactEnvironment, INSTALL_RECIPE, liveViteConfig } from '../../../src/services/artifacts/live/recipes';

const prod = { ARTIFACT_BUILDER_NAMESPACE: 'artifact-builders-prod',
  ARTIFACT_BUILDER_SERVICE_DOMAIN: 'artifact-builders-prod.svc.cluster.local' };

describe('per-environment builder placement and offline install', () => {
  it('takes the worker namespace and service domain from the environment configuration only', () => {
    expect(builderPlacement(prod)).toEqual({ namespace: 'artifact-builders-prod', serviceDomain: 'artifact-builders-prod.svc.cluster.local' });
    for (const env of [{}, { ...prod, ARTIFACT_BUILDER_NAMESPACE: '' }, { ...prod, ARTIFACT_BUILDER_SERVICE_DOMAIN: undefined },
      { ...prod, ARTIFACT_BUILDER_NAMESPACE: 'Bad_NS' }, { ...prod, ARTIFACT_BUILDER_SERVICE_DOMAIN: 'other.svc.cluster.local' },
      { ...prod, ARTIFACT_BUILDER_SERVICE_DOMAIN: 'artifact-builders-prod.svc.cluster.local.' },
      { ...prod, ARTIFACT_BUILDER_SERVICE_DOMAIN: 'artifact-builders-prod.svc..local' }]) {
      expect(() => builderPlacement(env)).toThrow(expect.objectContaining({ code: 'builder_unavailable', reason: 'placement_unconfigured' }));
    }
  });
  it('creates the pod, its service and the Vite allowed host in the configured namespace', async () => {
    const placement = builderPlacement(prod); const f = fixture();
    const runtime = await f.controller.start(key);
    for (const kind of ['pods', 'services']) {
      expect(f.objects.get(kind + runtime.podName)?.metadata).toMatchObject({ namespace: fixturePlacement.namespace });
    }
    expect(fixturePlacement.namespace).toBe('artifact-builders-test');
    expect(builderPod(key, runtime, 'trusted', placement).metadata.namespace).toBe('artifact-builders-prod');
    const config = liveViteConfig(runtime.sessionId, runtime.podName, placement);
    expect(config).toContain(JSON.stringify(`${runtime.podName}.artifact-builders-prod.svc.cluster.local`));
    expect(config).not.toContain('sentropic-artifact-builders');
  });
  it('installs offline with every script disabled and no script allowlist', () => {
    expect(INSTALL_RECIPE).toEqual({ executable: '/usr/local/bin/npm',
      args: ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], timeoutMs: 300_000 });
    const env = artifactEnvironment();
    expect(env).toMatchObject({ npm_config_offline: 'true', npm_config_ignore_scripts: 'true' });
    expect(env).not.toHaveProperty('npm_config_registry');
    expect(Object.keys(env).filter(name => /allow|script/i.test(name))).toEqual(['npm_config_ignore_scripts']);
  });
});
