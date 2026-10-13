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
      writeFileSync(file, `// Consumer usage snippet from packages/llm-mesh/README.md
import { createRemoteJudgeClient } from '@sentropic/llm-mesh/judge';

const client = createRemoteJudgeClient({
  baseUrl: 'https://llm.sent-tech.ca',
  authToken: 'secret-bearer-token',
});

const result = await client.judge({
  schemaVersion: 1,
  evaluator: { providerId: 'typesafe', evaluatorId: 'jev-1.13.0', revision: 'syn-v1' },
  inputs: { output: 'Candidate completion', state: null },
  criterion: { kind: 'binary', instructions: 'Verify output correctness' },
  decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 },
  correlationId: 'corr-judge-100',
  policy: { timeoutMs: 10_000 },
});
void [result];

// Host usage snippet from packages/llm-mesh/README.md
import { createJudgeService, createJevAdapter, jevDescriptor } from '@sentropic/llm-mesh/judge/host';
import { createJevTransport } from '@sentropic/llm-mesh/transport/jev';
import { createProviderRegistry } from '@sentropic/llm-mesh';

declare const resolveEvaluator: Parameters<typeof createJudgeService>[0]['resolveEvaluator'];
declare const resolvePrice: Parameters<typeof createJudgeService>[0]['resolvePrice'];
declare const authorize: Parameters<typeof createJudgeService>[0]['authorize'];
declare const budget: Parameters<typeof createJudgeService>[0]['budget'];
declare const receipts: Parameters<typeof createJudgeService>[0]['receipts'];
declare const resolveAuth: Parameters<typeof createJudgeService>[0]['resolveAuth'];
declare const clock: Parameters<typeof createJudgeService>[0]['clock'];

const adapter = createJevAdapter({
  descriptor: jevDescriptor,
  transport: createJevTransport({ fetch: globalThis.fetch }),
});
const service = createJudgeService({
  registry: createProviderRegistry([adapter]),
  resolveEvaluator,
  resolvePrice,
  authorize,
  budget,
  receipts,
  resolveAuth,
  clock,
});
void [service];
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
