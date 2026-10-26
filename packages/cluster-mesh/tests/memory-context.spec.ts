import { describe, expect, it } from 'vitest';
import { createGuardedRunner } from '../src/compose/mcp.js';
import { hostContext } from '../../mcp-platform/tests/memory/host-fixture.js';

describe('P01.mesh.memory-context', () => {
  it('should preserve the full per-call context and cancellation through guards', async () => {
    const context = hostContext(), signal = new AbortController().signal;
    const call = { context, signal };
    let seen: unknown;
    const guarded = createGuardedRunner({
      contextResolver: async () => ({ sub: 'user-1', tid: 'tenant-1', clientId: 'client-1', scopes: ['mcp:tools:invoke'] }),
      invocation: { authorize: async () => ({ allowed: true }) },
      runner: { run: async (_tool, _args, _identity, forwarded) => {
        seen = forwarded;
        return { ok: true, output: {}, auditId: 'audit-host-1', redactionClass: 'high' };
      } },
    });
    await guarded.run('engram_memory_search', { purpose_ref: 'purpose-1' }, undefined, call);
    expect(seen).toBe(call);
  });
});
