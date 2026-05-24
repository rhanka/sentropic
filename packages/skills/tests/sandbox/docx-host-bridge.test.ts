import { afterEach, describe, expect, it } from 'vitest';

import {
  createIsolatedVmRuntime,
} from '../../src/sandbox/runtime.js';
import {
  createDocxHostBridge,
} from '../../src/sandbox/docx-host-bridge.js';
import type { Skill } from '../../src/types/skill.js';
import type { SandboxPolicy } from '../../src/types/sandbox-policy.js';

const buildSkill = (sandboxEntry: string, policy: SandboxPolicy): Skill => ({
  metadata: {
    name: 'docx-bridge-test',
    description: 'docx bridge test skill',
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
});

const PURE_POLICY: SandboxPolicy = {
  surface: [],
  timeoutMs: 5_000,
  memoryMb: 64,
};

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

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

describe('createDocxHostBridge — pure host API', () => {
  it('mints distinct handles for every helper call', () => {
    const bridge = createDocxHostBridge();
    const par1 = bridge.hostFns.__hostDocxHeading(1, 'title');
    const par2 = bridge.hostFns.__hostDocxParagraph('body');
    expect(typeof par1).toBe('string');
    expect(typeof par2).toBe('string');
    expect(par1).not.toBe(par2);
    expect(bridge.size()).toBe(2);
  });

  it('builds a Document handle that packToBuffer can resolve', async () => {
    const bridge = createDocxHostBridge();
    const h1 = bridge.hostFns.__hostDocxHeading(1, 'Title');
    const p1 = bridge.hostFns.__hostDocxParagraph('Body');
    const docHandle = bridge.hostFns.__hostDocxDoc([h1, p1]);
    expect(typeof docHandle).toBe('string');

    const buffer = await bridge.packToBuffer(docHandle as string);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it('reset() drops every retained handle', () => {
    const bridge = createDocxHostBridge();
    bridge.hostFns.__hostDocxHeading(1, 'x');
    expect(bridge.size()).toBe(1);
    bridge.reset();
    expect(bridge.size()).toBe(0);
  });

  it('packToBuffer rejects an unknown handle', async () => {
    const bridge = createDocxHostBridge();
    await expect(bridge.packToBuffer('docx:doc:does-not-exist')).rejects.toThrow(
      /expected a Document handle/,
    );
  });

  it('list() returns an array of paragraph handles (legacy parity)', () => {
    const bridge = createDocxHostBridge();
    const handles = bridge.hostFns.__hostDocxList(['a', 'b', 'c']);
    expect(Array.isArray(handles)).toBe(true);
    expect((handles as string[]).length).toBe(3);
    expect((handles as string[]).every((h) => typeof h === 'string')).toBe(true);
    expect(bridge.size()).toBe(3);
  });
});

describe('SandboxRuntime + docx bridge integration', () => {
  it('runs a sandbox script that uses doc/h/p helpers and returns a handle', async () => {
    const bridge = createDocxHostBridge();
    const skill = buildSkill(
      `return doc([h(1, 'Hello'), p('World')]);`,
      PURE_POLICY,
    );
    const rt = make();
    const result = await rt.execute(skill, {}, { bridges: { docx: bridge } });
    expect(result.ok).toBe(true);
    expect(typeof result.output).toBe('string');
    expect((result.output as string).startsWith('docx:doc:')).toBe(true);

    const buffer = await bridge.packToBuffer(result.output as string);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it('runs a sandbox script that uses bold/italic/table/pageBreak/hr helpers', async () => {
    const bridge = createDocxHostBridge();
    const skill = buildSkill(
      `
        const tHandle = table(['Col1', 'Col2'], [['a', 'b'], ['c', 'd']]);
        return doc([
          h(2, 'Section'),
          p([bold('strong'), italic('emphatic')]),
          tHandle,
          pageBreak(),
          hr(),
        ]);
      `,
      PURE_POLICY,
    );
    const rt = make();
    const result = await rt.execute(skill, {}, { bridges: { docx: bridge } });
    expect(result.ok).toBe(true);
    const buffer = await bridge.packToBuffer(result.output as string);
    expect(buffer.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it('does not leak require/process/Buffer into the isolate', async () => {
    const bridge = createDocxHostBridge();
    const skill = buildSkill(
      `
        return {
          hasRequire: typeof require !== 'undefined',
          hasProcess: typeof process !== 'undefined',
          hasBuffer: typeof Buffer !== 'undefined',
        };
      `,
      PURE_POLICY,
    );
    const rt = make();
    const result = await rt.execute(skill, {}, { bridges: { docx: bridge } });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({
      hasRequire: false,
      hasProcess: false,
      hasBuffer: false,
    });
  });

  it('execute without docx bridge keeps the legacy three-surface contract', async () => {
    const skill = buildSkill(`return typeof doc;`, PURE_POLICY);
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(true);
    // No bridge → no helpers wired → `doc` is undefined.
    expect(result.output).toBe('undefined');
  });
});
