import { afterEach, describe, expect, it } from 'vitest';

import {
  createIsolatedVmRuntime,
  type SandboxHostAdapters,
} from '../../src/sandbox/runtime.js';
import type { Skill } from '../../src/types/skill.js';
import type { SandboxPolicy } from '../../src/types/sandbox-policy.js';

const buildSkill = (
  sandboxEntry: string,
  policy: SandboxPolicy,
  overrides: Partial<Skill> = {},
): Skill => ({
  metadata: {
    name: 'test-skill',
    description: 'sandbox test skill',
    version: '1.0.0',
    category: 'test',
    sandbox: policy,
    toolNames: ['run'],
  },
  tools: [
    {
      name: 'run',
      description: 'execute the sandbox entry',
      inputSchema: { type: 'object' },
    },
  ],
  body: '',
  sandboxEntry,
  ...overrides,
});

const PURE_POLICY: SandboxPolicy = {
  surface: [],
  timeoutMs: 5_000,
  memoryMb: 32,
};

let runtimes: Array<{ dispose(): Promise<void> }> = [];

const make = (...args: Parameters<typeof createIsolatedVmRuntime>) => {
  const rt = createIsolatedVmRuntime(...args);
  runtimes.push(rt);
  return rt;
};

afterEach(async () => {
  for (const rt of runtimes) {
    try {
      await rt.dispose();
    } catch {
      // ignore teardown errors
    }
  }
  runtimes = [];
});

describe('IsolatedVmSandboxRuntime', () => {
  it('returns a value from a pure-compute skill (happy path)', async () => {
    const skill = buildSkill('return input.a + input.b;', PURE_POLICY);
    const rt = make();
    const result = await rt.execute(skill, { a: 2, b: 3 });
    expect(result.ok).toBe(true);
    expect(result.output).toBe(5);
    expect(result.policy.timeoutMs).toBe(5_000);
    expect(result.policy.memoryMb).toBe(32);
  });

  it('returns SANDBOX_INTERNAL when sandboxEntry is missing', async () => {
    const skill = buildSkill('', PURE_POLICY, { sandboxEntry: '' });
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('SANDBOX_INTERNAL');
  });

  it('classifies a runaway loop as SANDBOX_TIMEOUT', async () => {
    const skill = buildSkill('while (true) {}', {
      surface: [],
      timeoutMs: 200,
      memoryMb: 32,
    });
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('SANDBOX_TIMEOUT');
  });

  it('classifies excessive allocation as SANDBOX_OOM', async () => {
    const skill = buildSkill(
      `const chunks = []; while (true) { chunks.push(new Array(1_000_000).fill(0)); }`,
      {
        surface: [],
        timeoutMs: 5_000,
        memoryMb: 16,
      },
    );
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(false);
    // isolated-vm raises an OOM-ish error that may also surface as a generic
    // throw before the heap-cap kicks in — both are acceptable failure modes
    // for the isolation contract (the call did NOT succeed).
    expect(['SANDBOX_OOM', 'SANDBOX_THROW']).toContain(result.errorCode);
  });

  it('denies access to host globals (fs, process, require)', async () => {
    const skill = buildSkill(
      `return typeof require + ',' + typeof process + ',' + typeof fs;`,
      PURE_POLICY,
    );
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(true);
    // None of the host globals leak into the isolate.
    expect(result.output).toBe('undefined,undefined,undefined');
  });

  it('exposes files.create when policy + adapter are both present', async () => {
    const filesAdapter: NonNullable<SandboxHostAdapters['files']> = {
      async create(input) {
        return { artefactId: `art-${input.name}`, mimeType: input.mimeType };
      },
    };
    const rt = make({ adapters: { files: filesAdapter } });
    const skill = buildSkill(
      `const out = await files.create({ name: 'hello.txt', mimeType: 'text/plain', content: 'hi' });
       return out.artefactId;`,
      { surface: ['files.create'], timeoutMs: 5_000, memoryMb: 32 },
    );
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(true);
    expect(result.output).toBe('art-hello.txt');
  });

  it('blocks files.create when not in the policy allowlist', async () => {
    const filesAdapter: NonNullable<SandboxHostAdapters['files']> = {
      async create(input) {
        return { artefactId: 'should-not-happen', mimeType: input.mimeType };
      },
    };
    const rt = make({ adapters: { files: filesAdapter } });
    // Policy does NOT declare files.create, so the bridge is not injected
    // and the user code throws a ReferenceError.
    const skill = buildSkill(
      `try { return typeof files; } catch (e) { return 'err:' + e.message; }`,
      { surface: [], timeoutMs: 5_000, memoryMb: 32 },
    );
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(true);
    expect(result.output).toBe('undefined');
  });

  it('blocks process.exit and other forbidden globals', async () => {
    const skill = buildSkill(
      `try { process.exit(0); return 'reached'; } catch (e) { return 'blocked:' + e.message; }`,
      PURE_POLICY,
    );
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(true);
    expect(String(result.output)).toMatch(/^blocked:/);
  });

  it('reports SANDBOX_THROW on a user-thrown error', async () => {
    const skill = buildSkill(`throw new Error('boom');`, PURE_POLICY);
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('SANDBOX_THROW');
    expect(result.errorMessage).toMatch(/boom/);
  });

  it('clamps an out-of-range timeoutMs and surfaces a policy warning', async () => {
    const skill = buildSkill('return 42;', {
      surface: [],
      timeoutMs: 999_999_999,
      memoryMb: 32,
    });
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(true);
    expect(result.output).toBe(42);
    expect(result.policy.timeoutMs).toBeLessThanOrEqual(60_000);
    expect(result.policy.warnings.length).toBeGreaterThan(0);
  });

  it('isolates state across two calls on the same runtime', async () => {
    const rt = make();
    const skillA = buildSkill(
      `globalThis.leak = 'leaked'; return globalThis.leak;`,
      PURE_POLICY,
    );
    const skillB = buildSkill(
      `return typeof globalThis.leak;`,
      PURE_POLICY,
    );
    const a = await rt.execute(skillA, {});
    const b = await rt.execute(skillB, {});
    expect(a.output).toBe('leaked');
    expect(b.output).toBe('undefined');
  });
});
