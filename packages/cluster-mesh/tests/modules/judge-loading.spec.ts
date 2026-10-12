import { describe, expect, it } from 'vitest';
import { createClusterMeshModules } from '../../src/index.js';
import * as meshJudgeProvider from '@sentropic/llm-mesh/judge';
import * as meshJudgeHostProvider from '@sentropic/llm-mesh/judge/host';

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
    expect(modules.snapshot()['llm-mesh/judge/host']).toMatchObject({ state: 'loaded' });
  });

  it('fails with unavailable when disabled', async () => {
    const modules = createClusterMeshModules({ disabled: ['llm-mesh/judge', 'llm-mesh/judge/host'] });
    expect(modules.isEnabled('llm-mesh/judge')).toBe(false);
    expect(modules.isEnabled('llm-mesh/judge/host')).toBe(false);
    await expect(modules.load('llm-mesh/judge')).rejects.toThrow();
    await expect(modules.load('llm-mesh/judge/host')).rejects.toThrow();
  });
});
