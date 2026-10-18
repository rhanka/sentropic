import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('published judge boundaries', () => {
  it('exports the three exact subpaths without changing package versions', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(pkg.version).toBe('0.25.0');
    for (const [name, path] of [['judge', 'judge/index'], ['judge/host', 'judge/host'], ['transport/jev', 'transport/jev']]) {
      expect(pkg.exports[`./${name}`]).toEqual({ types: `./dist/${path}.d.ts`, import: `./dist/${path}.js` });
    }
  });
  it('compiles a real external consumer against public declarations and ProviderAdapter judge types', () => {
    const require = createRequire(import.meta.url);
    const ts = require('typescript');
    const directory = mkdtempSync(join(tmpdir(), 'judge-consumer-'));
    try {
      mkdirSync(join(directory, 'node_modules/@sentropic'), { recursive: true });
      symlinkSync(resolve('.'), join(directory, 'node_modules/@sentropic/llm-mesh'));
      const file = join(directory, 'consumer.mts');
      writeFileSync(file, `import type { ProviderAdapter } from '@sentropic/llm-mesh';
import type { EvaluatorRef, JudgeRequest, JudgeAdapterResult, JudgeResult } from '@sentropic/llm-mesh/judge';
import { createRemoteJudgeClient } from '@sentropic/llm-mesh/judge';
import { createJudgeService, createJevAdapter } from '@sentropic/llm-mesh/judge/host';
import { createJevTransport } from '@sentropic/llm-mesh/transport/jev';
declare const adapter: ProviderAdapter;
declare const result: Awaited<ReturnType<NonNullable<typeof adapter.judge>>>;
const evidence: JudgeAdapterResult = result;
declare const request: JudgeRequest;
const argument: Parameters<NonNullable<typeof adapter.judge>>[0] = request;
const evaluator: EvaluatorRef = argument.evaluator;
declare const receipt: JudgeResult;
void [evidence, evaluator, receipt, createJudgeService, createJevAdapter, createJevTransport, createRemoteJudgeClient];
// @ts-expect-error Consumer contracts must not expose host custody.
import { createJudgeService as consumerFactory } from '@sentropic/llm-mesh/judge';
// @ts-expect-error Private judge modules must not have export-map escape hatches.
import { quoteJudge } from '@sentropic/llm-mesh/judge/pricing';
`);
      const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, skipLibCheck: false, types: [] });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('imports compiled consumer contracts without fetching or reading host credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Unexpected consumer fetch'); });
    try {
      const consumer = await import('../dist/judge/index.js');
      expect(Object.keys(consumer)).toEqual(['createRemoteJudgeClient']);
      expect(typeof consumer.createRemoteJudgeClient).toBe('function');
      expect(readFileSync(resolve('dist/judge/index.js'), 'utf8')).not.toMatch(/(?:import|export).*from.*(?:host|pricing|transport)/);
      const host = await import('../dist/judge/host.js');
      expect(typeof host.createJudgeService).toBe('function');
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('typechecks the public README consumer and host examples against actual exported signatures', () => {
    const require = createRequire(import.meta.url);
    const ts = require('typescript');
    const directory = mkdtempSync(join(tmpdir(), 'judge-readme-'));
    try {
      mkdirSync(join(directory, 'node_modules/@sentropic'), { recursive: true });
      symlinkSync(resolve('.'), join(directory, 'node_modules/@sentropic/llm-mesh'));
      const file = join(directory, 'readme-examples.mts');
      const readme = readFileSync(resolve('README.md'), 'utf8');
      const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
      const consumer = blocks.find((b) => b.includes('createRemoteJudgeClient'));
      const host = blocks.find((b) => b.includes('createJudgeService'));
      expect(consumer).toBeDefined();
      expect(host).toBeDefined();
      expect(consumer).toContain("authToken: 'secret-bearer-token'");
      expect(consumer).toContain("evaluatorId: 'jev-1.13.0'");
      expect(host).toContain('jevDescriptor');
      expect(host).toContain('createJevTransport({ fetch: globalThis.fetch })');
      if (!consumer || !host) throw new Error('README judge blocks missing');
      writeFileSync(file, `${consumer}\nvoid [result];\ndeclare const resolveEvaluator: Parameters<typeof createJudgeService>[0]['resolveEvaluator'];
declare const resolvePrice: Parameters<typeof createJudgeService>[0]['resolvePrice'];
declare const authorize: Parameters<typeof createJudgeService>[0]['authorize'];
declare const budget: Parameters<typeof createJudgeService>[0]['budget'];
declare const receipts: Parameters<typeof createJudgeService>[0]['receipts'];
declare const resolveAuth: Parameters<typeof createJudgeService>[0]['resolveAuth'];
declare const clock: Parameters<typeof createJudgeService>[0]['clock'];
${host}\nvoid [service];
`);
      const program = ts.createProgram([file], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
