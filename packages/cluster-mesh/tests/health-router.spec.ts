import { describe, expect, it, vi } from 'vitest';

import {
  createHealthNamespaceModule,
  createHealthRouter,
  HEALTH_PATHS,
  HEALTH_ROUTES,
  type HealthRouterOptions,
} from '../src/index.js';

const state = {
  snapshot: () => ({
    generation: { generationId: 'generation-health-1', status: 'active' },
    modules: [
      { namespace: '/health' as const, enabled: true },
      { namespace: '/memory' as const, enabled: false },
    ],
  }),
};

const options = (override: Partial<HealthRouterOptions> = {}): HealthRouterOptions => ({
  probes: [{
    name: 'database',
    async check() {
      return {
        status: 'ok',
        services: {
          database: 'ok',
          tables: { settings: 'accessible', jobQueue: 'accessible' },
        },
      } as const;
    },
  }],
  state,
  now: () => new Date('2026-09-03T12:00:00.000Z'),
  ...override,
});

describe('cluster mesh health router', () => {
  it('aggregates injected probes with generation and module observations', async () => {
    const router = createHealthRouter(options());

    expect(router.routes.map(({ method, path }) => [method, path])).toEqual(HEALTH_ROUTES);
    expect(HEALTH_PATHS).toEqual(['/health']);
    const response = await router.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      timestamp: '2026-09-03T12:00:00.000Z',
      services: {
        database: 'ok',
        tables: { settings: 'accessible', jobQueue: 'accessible' },
      },
      clusterMesh: state.snapshot(),
      readiness: { status: 'ready', reasons: [] },
    });
  });

  it('does not infer readiness from an active generation or enabled module', async () => {
    const router = createHealthRouter(options({
      probes: [{
        name: 'queue',
        async check() {
          return {
            status: 'degraded',
            reason: 'queue_lagging',
            services: { queue: 'degraded' },
          } as const;
        },
      }],
    }));

    const response = await router.request('/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      clusterMesh: state.snapshot(),
      readiness: { status: 'degraded', reasons: ['queue_lagging'] },
    });
  });

  it('returns a stable unavailable reason without leaking probe errors', async () => {
    const check = vi.fn(async () => { throw new Error('socket 10.0.0.8 refused'); });
    const response = await createHealthRouter(options({
      probes: [{ name: 'database', check }],
    })).request('/health');

    expect(check).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'error',
      readiness: { status: 'unavailable', reasons: ['database_probe_failed'] },
    });
    expect(JSON.stringify(body)).not.toContain('10.0.0.8');
  });

  it('requires real probes and remains independently disableable', () => {
    expect(() => createHealthRouter(options({ probes: [] })))
      .toThrowError('health probes and state are unavailable');
    const disabled = createHealthNamespaceModule({ ...options(), enabled: false });
    expect(disabled).toMatchObject({ namespace: '/health', enabled: false });
  });
});
