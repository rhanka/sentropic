import { describe, expect, it } from 'vitest';
import { createClusterMeshModules } from '../../src/index.js';
import * as meshJudgeProvider from '@sentropic/llm-mesh/judge';

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

  it('fails with unavailable when llm-mesh/judge is disabled', async () => {
    const modules = createClusterMeshModules({ disabled: ['llm-mesh/judge'] });
    expect(modules.isEnabled('llm-mesh/judge')).toBe(false);
    await expect(modules.load('llm-mesh/judge')).rejects.toThrow();
  });
});
