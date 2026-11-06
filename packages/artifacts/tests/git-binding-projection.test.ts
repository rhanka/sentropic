import { describe, expect, it } from 'vitest';
import { ARTIFACTS_TOOL_DEFINITIONS } from '../src/mcp-core.js';
import snapshot from './snapshots/tools-list-catalogue.json' with { type: 'json' };
import { createMemoryGitBindingStore } from '../src/server/git-bindings.js';
import { createTransportWorld } from './fixtures/transport-world.js';
import { gitBinding, gitWrite } from './fixtures/git-binding-conformance.js';

describe('artifacts_get repository code right projection', () => {
  it('should expose every binding transition only with current code rights', async () => {
    const bindings = createMemoryGitBindingStore();
    let codeRight = true;
    const w = createTransportWorld(['alice', 'bob'], 'scope-a', { git: {
      bindings, codeRights: { async canReadCode(input) {
        return input.storageScopeId === 'scope-a' && input.repoId === 'repo-a' && codeRight;
      } },
    } });
    const ensured = await w.mcp.invoke({ tool: 'artifacts_ensure', invocation: w.invocation(),
      args: { bindingName: 'git-demo', idempotencyKey: 'ensure' } });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    expect(ensured.status).toBe(201);
    const acl = (await w.acls.getArtifactAcl(artifactId))!;
    await w.acls.putArtifactAcl(artifactId, { ...acl, grants: [{ principalId: 'bob', grant: 'read' }] });
    const read = () => w.mcp.invoke({ tool: 'artifacts_get', invocation: w.invocation(), args: { artifactId } });
    let binding = gitBinding(artifactId);
    await bindings.write(gitWrite(binding));
    for (const [action, state, generation] of [
      ['attach', 'attached', 1], ['pause', 'paused', 2], ['detach', 'detached', 3],
    ] as const) {
      if (action !== 'attach') {
        const expectedVersion = binding.version;
        binding = { ...binding, state, generation, version: expectedVersion + 1 };
        await bindings.write({ ...gitWrite(binding, action), expectedVersion, event: { action } });
      }
      expect((await read()).body).toMatchObject({ git: { state, generation } });
      codeRight = false;
      const denied = await read();
      expect(denied.status).toBe(200);
      expect(denied.body).not.toHaveProperty('git');
      const reader = await w.mcp.invoke({ tool: 'artifacts_get', invocation: w.invocation('bob'), args: { artifactId } });
      expect(reader.status).toBe(200);
      expect(reader.body).not.toHaveProperty('git');
      codeRight = true;
    }
  });
  it('should keep the frozen access grant limited to read', () => {
    const definition = ARTIFACTS_TOOL_DEFINITIONS.artifacts_set_access;
    expect(definition).toEqual(snapshot.definitions.artifacts_set_access);
    expect(definition.inputSchema).toMatchObject({ properties: { grant: { enum: ['read'] } } });
  });
});
