import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneFixture, enabled, fixtureDir, nodeJson, runNode } from './helpers.js';

describe.skipIf(!enabled)('packed consumer topology (npm, single process)', () => {
  it('should resolve one cluster-mesh and one llm-mesh shared with the gateway', () => {
    const report = nodeJson<{ instances: unknown[]; llmMesh: { path: string }; gateway: { llmMesh: { path: string } } }>(
      fixtureDir('selected'), `
      import { verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
      import '@sentropic/cluster-mesh/gateway';
      console.log(JSON.stringify(verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] })));`);
    expect(report.instances).toHaveLength(1);
    expect(report.gateway.llmMesh.path).toBe(report.llmMesh.path);
  });

  it('should fail a second evaluated cluster-mesh copy at its guarded import', () => {
    const dir = cloneFixture('selected', 'duplicate-cluster');
    const nested = join(dir, 'node_modules/separate-runtime/node_modules/@sentropic');
    mkdirSync(nested, { recursive: true });
    cpSync(join(dir, 'node_modules/@sentropic/cluster-mesh'), join(nested, 'cluster-mesh'), { recursive: true });
    const result = nodeJson(dir, `
      import '@sentropic/cluster-mesh/llm-mesh';
      const second = ${JSON.stringify(join(nested, 'cluster-mesh/dist/integrations/llm-mesh/index.js'))};
      const error = await import(second).then(() => undefined, (caught) => caught);
      console.log(JSON.stringify({ code: error?.code, reason: error?.reason, paths: error?.paths?.length }));`);
    expect(result).toEqual({ code: 'cluster_mesh_topology_invalid', reason: 'duplicate_instance', paths: 2 });
  });

  it('should fail a gateway-private llm-mesh copy at leaf import and loader acquisition', () => {
    const dir = cloneFixture('selected', 'divergent-mesh');
    const privateMesh = join(dir, 'node_modules/@sentropic/llm-gateway/node_modules/@sentropic');
    mkdirSync(privateMesh, { recursive: true });
    cpSync(join(dir, 'node_modules/@sentropic/llm-mesh'), join(privateMesh, 'llm-mesh'), { recursive: true });
    const leaf = runNode(dir, `import '@sentropic/cluster-mesh/llm-mesh';`);
    expect(leaf.status).not.toBe(0);
    expect(leaf.stderr).toContain('cluster_mesh_topology_invalid');
    expect(leaf.stderr).toContain('divergent_llm_mesh');
    const loader = runNode(dir, `
      import { createClusterMeshModules } from '@sentropic/cluster-mesh';
      const modules = createClusterMeshModules();
      const { loadGateway } = await import('@sentropic/cluster-mesh/loaders/gateway').catch((caught) => ({ guard: caught }));
      console.log(JSON.stringify({ loaderImportFailed: loadGateway === undefined }));`);
    expect(loader.stdout).toContain('"loaderImportFailed":true');
  });
});
