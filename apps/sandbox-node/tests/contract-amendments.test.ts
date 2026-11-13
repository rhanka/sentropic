import { describe, expect, it } from 'vitest';
import { dsRecipeKey } from '../src/recipe-key.js';
import { EXECUTION_NODE_ISOLATE_POLICY, type ArtifactProvenanceV1, type DsRecipeKeyV1, type ExecutionNodeStopResult } from '../src/contract.js';
import { EXECUTION_NODE_V1_SANDBOX_SPEC_SCHEMA } from '../src/contract.js';

describe('amended contracts', () => {
  it('should publish the mandatory configurable development scope and provenance schema', () => {
    expect(EXECUTION_NODE_V1_SANDBOX_SPEC_SCHEMA.required).toContain('devScope');
    expect(EXECUTION_NODE_V1_SANDBOX_SPEC_SCHEMA.properties.devScope).toMatchObject({
      required: ['kind', 'writable', 'refused', 'source'],
      properties: { kind: { enum: ['ui', 'api', 'jobs', 'data', 'fullstack'] },
        source: { required: ['repo', 'path', 'commit'] } },
    });
  });
  const recipe: DsRecipeKeyV1 = { schemaVersion: 'ds-recipe-key.v1', sources: { 'src/a.ts': 'a' },
    compilers: { vue: { version: '3.5.35', digest: 'sha256:vue' }, ts: { version: '5', digest: 'sha256:ts' } },
    compilerOptions: { urlRewriteMode: 'pinned' }, importMapManifestDigest: 'none' };
  it('should canonicalize complete compiler maps and bind options/import maps', () => {
    expect(dsRecipeKey(recipe)).toBe(dsRecipeKey({ ...recipe, compilers: { ts: recipe.compilers.ts!, vue: recipe.compilers.vue! } }));
    expect(dsRecipeKey({ ...recipe, importMapManifestDigest: 'sha256:map' })).not.toBe(dsRecipeKey(recipe));
    expect(dsRecipeKey({ ...recipe, compilerOptions: { urlRewriteMode: 'other' } })).not.toBe(dsRecipeKey(recipe));
    expect(() => dsRecipeKey({ ...recipe, sources: { './src/a.ts': 'a', 'src/a.ts': 'b' } })).toThrowError(/DUPLICATE_NORMALIZED_PATH/);
    expect(() => dsRecipeKey({ ...recipe, sources: { '../escape': 'x' } })).toThrowError(/INVALID_SOURCE_PATH/);
  });
  it('should keep strict per-session isolates and truthful pending stop response', () => {
    expect(EXECUTION_NODE_ISOLATE_POLICY).toMatchObject({ runscPerSession: 1, workerdPerSession: 1, network: 'none', sharedHost: false });
    const pending: ExecutionNodeStopResult = { status: 202, state: 'stopping', allProcessesExited: false, retryAfterMs: 250 };
    expect(pending.allProcessesExited).toBe(false);
    // @ts-expect-error stopping must never certify process exit.
    const invalid: ExecutionNodeStopResult = { status: 200, state: 'stopping', allProcessesExited: true };
    void invalid;
    // @ts-expect-error incomplete provenance must never satisfy the signed payload.
    const incomplete: ArtifactProvenanceV1 = { schemaVersion: 'execution-provenance.v1', tenantId: 'immo' };
    void incomplete;
  });
});
