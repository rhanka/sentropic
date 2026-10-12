import { describe, expect, it } from 'vitest';
import * as meshProvider from '@sentropic/llm-mesh';
import * as facadeProvider from '@sentropic/llm-mesh/facade';
import * as enrollmentProvider from '@sentropic/llm-mesh/enrollment';
import * as nodeProvider from '@sentropic/llm-mesh/node';
import * as cloudCodeProvider from '@sentropic/llm-mesh/transport/cloud-code';
import * as jevTransportProvider from '@sentropic/llm-mesh/transport/jev';
import * as judgeProvider from '@sentropic/llm-mesh/judge';
import * as judgeHostProvider from '@sentropic/llm-mesh/judge/host';
import * as meshLeaf from '../../src/integrations/llm-mesh/index.js';
import * as facadeLeaf from '../../src/integrations/llm-mesh/facade.js';
import * as enrollmentLeaf from '../../src/integrations/llm-mesh/enrollment.js';
import * as nodeLeaf from '../../src/integrations/llm-mesh/node.js';
import * as cloudCodeLeaf from '../../src/integrations/llm-mesh/transport/cloud-code.js';
import * as jevTransportLeaf from '../../src/integrations/llm-mesh/transport/jev.js';
import * as judgeLeaf from '../../src/integrations/llm-mesh/judge.js';
import * as judgeHostLeaf from '../../src/integrations/llm-mesh/judge/host.js';
import { createClusterMeshModules, verifyClusterMeshTopology } from '../../src/index.js';
import { loadLlmMesh } from '../../src/loaders/llm-mesh/index.js';
import { loadLlmMeshFacade } from '../../src/loaders/llm-mesh/facade.js';
import { loadLlmMeshEnrollment } from '../../src/loaders/llm-mesh/enrollment.js';
import { loadLlmMeshNode } from '../../src/loaders/llm-mesh/node.js';
import { loadCloudCodeTransport } from '../../src/loaders/llm-mesh/transport/cloud-code.js';
import { loadLlmMeshJevTransport } from '../../src/loaders/llm-mesh/transport/jev.js';
import { loadLlmMeshJudge } from '../../src/loaders/llm-mesh/judge.js';
import { loadLlmMeshJudgeHost } from '../../src/loaders/llm-mesh/judge/host.js';

const pairs = [
  ['llm-mesh', meshLeaf, meshProvider],
  ['llm-mesh/facade', facadeLeaf, facadeProvider],
  ['llm-mesh/enrollment', enrollmentLeaf, enrollmentProvider],
  ['llm-mesh/node', nodeLeaf, nodeProvider],
  ['llm-mesh/transport/cloud-code', cloudCodeLeaf, cloudCodeProvider],
  ['llm-mesh/transport/jev', jevTransportLeaf, jevTransportProvider],
  ['llm-mesh/judge', judgeLeaf, judgeProvider],
  ['llm-mesh/judge/host', judgeHostLeaf, judgeHostProvider],
] as const;

describe('llm-mesh static leaves', () => {
  it.each(pairs)('should re-export the full %s namespace with identical bindings', (_id, leaf, provider) => {
    expect(Object.keys(leaf).sort()).toEqual(Object.keys(provider).sort());
    for (const key of Object.keys(provider)) {
      expect((leaf as Record<string, unknown>)[key]).toBe((provider as Record<string, unknown>)[key]);
    }
  });

  it('should expose the measured h2a values synchronously', () => {
    for (const name of [
      'CloudCodeRuntimeClient', 'CodexRuntimeClient', 'GeminiAdapter', 'MistralAdapter', 'MistralRuntimeClient', 'MuseAdapter', 'MuseRuntimeClient',
      'OpenAIAdapter', 'createLlmMesh', 'createProviderRegistry', 'modelProfiles', 'validateEquivalenceCouncil',
      'validateRoutePolicy', 'DEFAULT_MODEL_EQUIVALENCE_COUNCIL', 'DEFAULT_ROUTE_POLICY',
      'InMemoryRoutePolicyProfiles', 'InMemoryRoutePlanner', 'RoutePlanError',
    ]) expect(meshLeaf).toHaveProperty(name);
    expect(typeof facadeLeaf.createLlmMeshFacade).toBe('function');
    expect(new nodeLeaf.InMemoryKeyring()).toBeInstanceOf(nodeProvider.InMemoryKeyring);
  });

  it('should keep static imports outside registry acquisition state', () => {
    const modules = createClusterMeshModules();
    expect(modules.snapshot()['llm-mesh']).toEqual({ availability: 'gated', state: 'unprobed' });
  });

  it('should return the original provider namespaces from the typed loaders', async () => {
    const modules = createClusterMeshModules();
    const [mesh, facade, enrollment, node, cloudCode, judge, judgeHost, jevTransport] = await Promise.all([
      loadLlmMesh(modules), loadLlmMeshFacade(modules), loadLlmMeshEnrollment(modules),
      loadLlmMeshNode(modules), loadCloudCodeTransport(modules), loadLlmMeshJudge(modules),
      loadLlmMeshJudgeHost(modules), loadLlmMeshJevTransport(modules),
    ]);
    expect(mesh.createLlmMesh).toBe(meshProvider.createLlmMesh);
    expect(facade.createLlmMeshFacade).toBe(facadeProvider.createLlmMeshFacade);
    expect(Object.keys(enrollment)).toEqual(Object.keys(enrollmentProvider));
    expect(node.InMemoryKeyring).toBe(nodeProvider.InMemoryKeyring);
    expect(cloudCode.CloudCodeProviderAdapter).toBe(cloudCodeProvider.CloudCodeProviderAdapter);
    expect(judge.createRemoteJudgeClient).toBe(judgeProvider.createRemoteJudgeClient);
    expect(judgeHost.createJudgeService).toBe(judgeHostProvider.createJudgeService);
    expect(judgeHost.createJevAdapter).toBe(judgeHostProvider.createJevAdapter);
    expect(judgeHost.jevDescriptor).toBe(judgeHostProvider.jevDescriptor);
    expect(jevTransport.createJevTransport).toBe(jevTransportProvider.createJevTransport);
    expect(modules.snapshot()['llm-mesh']).toMatchObject({ state: 'loaded', installedVersion: '0.25.0' });
    expect(modules.snapshot()['llm-mesh/judge']).toMatchObject({ state: 'loaded' });
    expect(modules.snapshot()['llm-mesh/judge/host']).toMatchObject({ state: 'loaded' });
    expect(modules.snapshot()['llm-mesh/transport/jev']).toMatchObject({ state: 'loaded' });
  });

  it('should pass the explicit topology preflight for the workspace tree', () => {
    const report = verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] });
    expect(report.instances).toHaveLength(1);
    expect(report.gateway?.llmMesh?.path).toBe(report.llmMesh?.path);
  });
});
