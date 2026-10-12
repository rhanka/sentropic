import { describe, expect, it } from 'vitest';
import { createClusterMeshModules } from '../../src/index.js';
import * as meshJudgeProvider from '@sentropic/llm-mesh/judge';
import * as meshJudgeHostProvider from '@sentropic/llm-mesh/judge/host';
import * as meshJevTransportProvider from '@sentropic/llm-mesh/transport/jev';
import { loadLlmMeshJudge, loadJudgeClient } from '../../src/loaders/llm-mesh/judge.js';
import { loadLlmMeshJudgeHost, loadJudgeHost } from '../../src/loaders/llm-mesh/judge/host.js';

describe('judge module loading', () => {
  it('probes and loads llm-mesh/judge from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/judge']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/judge']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/judge')) as typeof meshJudgeProvider;
    expect(typeof loaded.createRemoteJudgeClient).toBe('function');
    expect(loaded.createRemoteJudgeClient).toBe(meshJudgeProvider.createRemoteJudgeClient);
    const loadedByLoader = await loadLlmMeshJudge(modules);
    expect(loadedByLoader.createRemoteJudgeClient).toBe(meshJudgeProvider.createRemoteJudgeClient);
    const loadedByAlias = await loadJudgeClient(modules);
    expect(loadedByAlias.createRemoteJudgeClient).toBe(meshJudgeProvider.createRemoteJudgeClient);
    expect(modules.snapshot()['llm-mesh/judge']).toMatchObject({ state: 'loaded' });
  });

  it('probes and loads llm-mesh/judge/host from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/judge/host']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/judge/host']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/judge/host')) as typeof meshJudgeHostProvider;
    expect(typeof loaded.createJudgeService).toBe('function');
    expect(typeof loaded.createJevAdapter).toBe('function');
    expect(typeof loaded.jevDescriptor).toBe('object');
    expect(loaded.createJudgeService).toBe(meshJudgeHostProvider.createJudgeService);
    expect(loaded.jevDescriptor).toBe(meshJudgeHostProvider.jevDescriptor);
    const loadedByLoader = await loadLlmMeshJudgeHost(modules);
    expect(loadedByLoader.createJudgeService).toBe(meshJudgeHostProvider.createJudgeService);
    const loadedByAlias = await loadJudgeHost(modules);
    expect(loadedByAlias.createJudgeService).toBe(meshJudgeHostProvider.createJudgeService);
    expect(modules.snapshot()['llm-mesh/judge/host']).toMatchObject({ state: 'loaded' });
  });

  it('probes and loads llm-mesh/transport/jev from installed provider', async () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh/transport/jev']).toEqual({ availability: 'gated', state: 'unprobed' });
    await modules.probe();
    expect(modules.snapshot()['llm-mesh/transport/jev']).toMatchObject({
      availability: 'available',
      state: 'installed',
      packageName: '@sentropic/llm-mesh',
    });
    const loaded = (await modules.load('llm-mesh/transport/jev')) as typeof meshJevTransportProvider;
    expect(typeof loaded.createJevTransport).toBe('function');
    expect(loaded.createJevTransport).toBe(meshJevTransportProvider.createJevTransport);
    expect(modules.snapshot()['llm-mesh/transport/jev']).toMatchObject({ state: 'loaded' });
  });

  it('fails with unavailable when disabled', async () => {
    const modules = createClusterMeshModules({ disabled: ['llm-mesh/judge', 'llm-mesh/judge/host', 'llm-mesh/transport/jev'] });
    expect(modules.isEnabled('llm-mesh/judge')).toBe(false);
    expect(modules.isEnabled('llm-mesh/judge/host')).toBe(false);
    expect(modules.isEnabled('llm-mesh/transport/jev')).toBe(false);
    await expect(modules.load('llm-mesh/judge')).rejects.toThrow();
    await expect(loadLlmMeshJudge(modules)).rejects.toThrow();
    await expect(loadJudgeClient(modules)).rejects.toThrow();
    await expect(modules.load('llm-mesh/judge/host')).rejects.toThrow();
    await expect(loadLlmMeshJudgeHost(modules)).rejects.toThrow();
    await expect(loadJudgeHost(modules)).rejects.toThrow();
    await expect(modules.load('llm-mesh/transport/jev')).rejects.toThrow();
  });
});
