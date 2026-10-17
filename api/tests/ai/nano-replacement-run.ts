import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { env } from '../../src/config/env';
import { createNanoJournal } from '../utils/nano-qualification-evidence';
import { NANO_CANDIDATES, type NanoCandidate } from '../utils/nano-qualification-budget';
import { NANO_CASES, type NanoCase } from './nano-replacement-fixtures';
import { runNanoShortCase, type NanoCaseResult } from './nano-replacement-short-cases';
import { runNanoToolCase } from './nano-replacement-tool-cases';
import { runNanoLongCase } from './nano-replacement-long-cases';
import { createNanoRuntime, sha256 } from './nano-replacement-runtime';

export const createNanoQualificationRun = () => {
  if (!env.OPENAI_API_KEY?.trim()) throw new Error('Qualification requires the existing OpenAI environment credential');
  const root = resolve(process.cwd(), '..');
  const directory = resolve(root, '.tmp/nano-retirement');
  const sourceCommit = readFileSync(resolve(directory, 'source-commit'), 'utf8').trim();
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Qualification source commit is not pinned');
  const meshVersion = JSON.parse(readFileSync(resolve(root, 'packages/llm-mesh/package.json'), 'utf8')).version;
  const metadata = { sourceCommit, meshVersion, agentSig: '7f3a9c2e1b', candidates: NANO_CANDIDATES,
    fixturePlanSha256: sha256(JSON.stringify(NANO_CASES)), budgetUsd: 15, maxPhysicalRequests: 38,
    transport: 'product helpers -> llm-mesh -> injected native OpenAI API runtime', retries: 0, tier: 'default',
    pricingSources: NANO_CANDIDATES.map((model) => `https://developers.openai.com/api/docs/models/${model}`) };
  const journal = createNanoJournal(directory, metadata);
  const runtime = createNanoRuntime(journal);
  const rows: Array<Record<string, any>> = [];
  const runCase = async (fixture: NanoCase, model: NanoCandidate) => {
    const signal = runtime.activate(model, fixture.id);
    vi.stubEnv('OPENAI_MODEL', model);
    const before = runtime.receipts.length;
    const started = performance.now();
    let result: NanoCaseResult;
    try {
      result = fixture.kind === 'tool_json' ? await runNanoToolCase(fixture, model, signal, runtime)
        : fixture.kind === 'history_document' ? await runNanoLongCase(fixture, model, signal)
        : await runNanoShortCase(fixture, model, signal);
    } catch {
      runtime.budget.close();
      result = { output: null, checks: { helperExecution: false }, fixtureSha256: sha256(JSON.stringify(fixture)) };
    } finally { runtime.abortActive(); vi.unstubAllEnvs(); }
    const receipts = runtime.receipts.slice(before);
    const expectedRequests = fixture.kind === 'tool_json' || (fixture.kind === 'history_document' && fixture.singlePassLimit === 1) ? 2 : 1;
    const checks = { ...result.checks, exactRequestCount: receipts.length === expectedRequests,
      completeProviderOutput: receipts.every((receipt) => receipt.status === 'stop' || receipt.status === 'completed'),
      reasoningMeasuredAndDisabled: receipts.every((receipt) => receipt.reasoningReported && receipt.usage.reasoning === 0),
      noSafetyFailure: !runtime.budget.snapshot().closed };
    const row = { type: 'case', caseId: fixture.id, kind: fixture.kind, model, elapsedMs: performance.now() - started,
      fixtureSha256: result.fixtureSha256, checks, valid: Object.values(checks).every(Boolean), output: result.output,
      requestOrdinals: receipts.map((receipt) => receipt.ordinal), knownCostUsd: receipts.reduce((sum, receipt) => sum + receipt.costUsd, 0) };
    rows.push(row);
    journal.append(row);
    return row;
  };
  return {
    runCase, abortActive: runtime.abortActive, failed: () => runtime.budget.snapshot().closed,
    finish: () => {
      const report = { metadata, rows, receipts: runtime.receipts, budget: runtime.budget.snapshot() };
      journal.append({ type: 'finished', cases: rows.length, validCases: rows.filter((row) => row.valid).length, budget: report.budget });
      writeFileSync(resolve(directory, 'campaign-results.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
      runtime.close(); journal.close(); vi.unstubAllEnvs();
    },
  };
};
