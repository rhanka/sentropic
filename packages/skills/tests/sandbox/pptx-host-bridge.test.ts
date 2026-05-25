import { afterEach, describe, expect, it } from 'vitest';

import {
  createIsolatedVmRuntime,
} from '../../src/sandbox/runtime.js';
import {
  createPptxHostBridge,
} from '../../src/sandbox/pptx-host-bridge.js';
import type { Skill } from '../../src/types/skill.js';
import type { SandboxPolicy } from '../../src/types/sandbox-policy.js';

const buildSkill = (sandboxEntry: string, policy: SandboxPolicy): Skill => ({
  metadata: {
    name: 'pptx-bridge-test',
    description: 'pptx bridge test skill',
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
  timeoutMs: 10_000,
  memoryMb: 128,
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

describe('createPptxHostBridge — pure host API', () => {
  it('mints distinct handles for presentation and slide helpers', () => {
    const bridge = createPptxHostBridge();
    const pres = bridge.hostFns.__hostPptxPres({ title: 'T' });
    const slide = bridge.hostFns.__hostPptxTitleSlide(pres, 'Hello', 'World');
    expect(typeof pres).toBe('string');
    expect(typeof slide).toBe('string');
    expect(pres).not.toBe(slide);
    expect(pres.startsWith('pptx:pres:')).toBe(true);
    expect(slide.startsWith('pptx:slide:')).toBe(true);
    expect(bridge.size()).toBe(2);
  });

  it('builds a Presentation handle that packToBuffer can resolve', async () => {
    const bridge = createPptxHostBridge();
    const pres = bridge.hostFns.__hostPptxPres();
    bridge.hostFns.__hostPptxTitleSlide(pres, 'Title');
    const buffer = await bridge.packToBuffer(pres);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it('reset() drops every retained handle', () => {
    const bridge = createPptxHostBridge();
    bridge.hostFns.__hostPptxPres();
    expect(bridge.size()).toBe(1);
    bridge.reset();
    expect(bridge.size()).toBe(0);
  });

  it('packToBuffer rejects an unknown handle', async () => {
    const bridge = createPptxHostBridge();
    await expect(bridge.packToBuffer('pptx:pres:does-not-exist')).rejects.toThrow(
      /not a Presentation/,
    );
  });

  it('slide helpers (textBox/bullets/table/statCallout/footer/visualPlaceholder) return the same slide handle', () => {
    const bridge = createPptxHostBridge();
    const pres = bridge.hostFns.__hostPptxPres();
    const slide = bridge.hostFns.__hostPptxSectionSlide(pres, 'Section');
    expect(bridge.hostFns.__hostPptxTextBox(slide, 'hello')).toBe(slide);
    expect(bridge.hostFns.__hostPptxBullets(slide, ['a', 'b'])).toBe(slide);
    expect(
      bridge.hostFns.__hostPptxTable(slide, ['C1', 'C2'], [['1', '2']]),
    ).toBe(slide);
    expect(bridge.hostFns.__hostPptxStatCallout(slide, 'KPI', '42')).toBe(slide);
    expect(bridge.hostFns.__hostPptxFooter(slide, 'footer text')).toBe(slide);
    expect(bridge.hostFns.__hostPptxVisualPlaceholder(slide, 'visual')).toBe(slide);
  });
});

describe('SandboxRuntime + pptx bridge integration', () => {
  it('runs a sandbox script that uses pptx/titleSlide helpers and returns a presentation handle', async () => {
    const bridge = createPptxHostBridge();
    const skill = buildSkill(
      `
        const p = pptx({ title: 'T' });
        titleSlide(p, 'Hello', 'World');
        return p;
      `,
      PURE_POLICY,
    );
    const rt = make();
    const result = await rt.execute(skill, {}, { bridges: { pptx: bridge } });
    expect(result.ok).toBe(true);
    expect(typeof result.output).toBe('string');
    expect((result.output as string).startsWith('pptx:pres:')).toBe(true);

    const buffer = await bridge.packToBuffer(result.output as string);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it('runs a sandbox script that uses sectionSlide/bullets/table/statCallout/footer/visualPlaceholder helpers', async () => {
    const bridge = createPptxHostBridge();
    const skill = buildSkill(
      `
        const p = pptx();
        const s1 = sectionSlide(p, 'Section', 'Subtitle');
        bullets(s1, ['one', 'two', 'three']);
        const s2 = titleSlide(p, 'Numbers');
        table(s2, ['Col1', 'Col2'], [['a', 'b'], ['c', 'd']]);
        statCallout(s2, 'Throughput', '42');
        footer(s2, 'Confidential');
        visualPlaceholder(s2, 'Diagram');
        return p;
      `,
      PURE_POLICY,
    );
    const rt = make();
    const result = await rt.execute(skill, {}, { bridges: { pptx: bridge } });
    expect(result.ok).toBe(true);
    const buffer = await bridge.packToBuffer(result.output as string);
    expect(buffer.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it('does not leak require/process/Buffer into the isolate', async () => {
    const bridge = createPptxHostBridge();
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
    const result = await rt.execute(skill, {}, { bridges: { pptx: bridge } });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({
      hasRequire: false,
      hasProcess: false,
      hasBuffer: false,
    });
  });

  it('execute without pptx bridge does not wire any pptx helper', async () => {
    const skill = buildSkill(`return typeof pptx;`, PURE_POLICY);
    const rt = make();
    const result = await rt.execute(skill, {});
    expect(result.ok).toBe(true);
    // No bridge → no helpers wired → `pptx` is undefined.
    expect(result.output).toBe('undefined');
  });
});
