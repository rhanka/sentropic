import { describe, expect, it } from 'vitest';
import * as meshProvider from '@sentropic/llm-mesh';
import * as facadeProvider from '@sentropic/llm-mesh/facade';
import * as enrollmentProvider from '@sentropic/llm-mesh/enrollment';
import * as nodeProvider from '@sentropic/llm-mesh/node';
import * as cloudCodeProvider from '@sentropic/llm-mesh/transport/cloud-code';
import * as meshLeaf from '../../src/integrations/llm-mesh/index.js';
import * as facadeLeaf from '../../src/integrations/llm-mesh/facade.js';
import * as enrollmentLeaf from '../../src/integrations/llm-mesh/enrollment.js';
import * as nodeLeaf from '../../src/integrations/llm-mesh/node.js';
import * as cloudCodeLeaf from '../../src/integrations/llm-mesh/transport/cloud-code.js';
import { createClusterMeshModules, verifyClusterMeshTopology } from '../../src/index.js';
import { loadLlmMesh } from '../../src/loaders/llm-mesh/index.js';
import { loadLlmMeshFacade } from '../../src/loaders/llm-mesh/facade.js';
import { loadLlmMeshEnrollment } from '../../src/loaders/llm-mesh/enrollment.js';
import { loadLlmMeshNode } from '../../src/loaders/llm-mesh/node.js';
import { loadCloudCodeTransport } from '../../src/loaders/llm-mesh/transport/cloud-code.js';

const pairs = [
  ['llm-mesh', meshLeaf, meshProvider],
  ['llm-mesh/facade', facadeLeaf, facadeProvider],
  ['llm-mesh/enrollment', enrollmentLeaf, enrollmentProvider],
  ['llm-mesh/node', nodeLeaf, nodeProvider],
  ['llm-mesh/transport/cloud-code', cloudCodeLeaf, cloudCodeProvider],
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
      'CloudCodeRuntimeClient', 'CodexRuntimeClient', 'GeminiAdapter', 'MuseAdapter', 'MuseRuntimeClient',
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
    const [mesh, facade, enrollment, node, cloudCode] = await Promise.all([
      loadLlmMesh(modules), loadLlmMeshFacade(modules), loadLlmMeshEnrollment(modules),
      loadLlmMeshNode(modules), loadCloudCodeTransport(modules),
    ]);
    expect(mesh.createLlmMesh).toBe(meshProvider.createLlmMesh);
    expect(facade.createLlmMeshFacade).toBe(facadeProvider.createLlmMeshFacade);
    expect(Object.keys(enrollment)).toEqual(Object.keys(enrollmentProvider));
    expect(node.InMemoryKeyring).toBe(nodeProvider.InMemoryKeyring);
    expect(cloudCode.CloudCodeProviderAdapter).toBe(cloudCodeProvider.CloudCodeProviderAdapter);
    expect(modules.snapshot()['llm-mesh']).toMatchObject({ state: 'loaded', installedVersion: '0.22.1' });
  });

  it('should pass the explicit topology preflight for the workspace tree', () => {
    const report = verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] });
    expect(report.instances).toHaveLength(1);
    expect(report.gateway?.llmMesh?.path).toBe(report.llmMesh?.path);
  });
});
