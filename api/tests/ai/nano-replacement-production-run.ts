import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { createNanoJournal } from '../utils/nano-qualification-evidence';
import type { NanoCandidate } from '../utils/nano-qualification-budget';
import { NANO_PRODUCTION_CHUNK_CASES } from './nano-replacement-fixtures';
import { runNanoLongCase } from './nano-replacement-long-cases';
import { createNanoRuntime, sha256 } from './nano-replacement-runtime';

/** Supplement, never replace, the completed campaign; both journals share the original USD 15. */
export const createNanoProductionRun = () => {
  const parent = resolve(process.cwd(), '../.tmp/nano-retirement');
  const priorBytes = readFileSync(resolve(parent, 'campaign-results.json'), 'utf8');
  const priorJournal = readFileSync(resolve(parent, 'campaign.jsonl'), 'utf8');
  if (sha256(priorBytes) !== 'c305d2c7cd7e0248ff98885729cb6a66243ccfae3ff68c838490d5b3e8abd2b6'
    || sha256(priorJournal) !== '6dc857f5acfbbfd1ce1ff1bfefc2089ba92cb9945f2a3455cc4fb63f3f08778b') {
    throw new Error('Prior campaign evidence changed; cumulative allowance refused');
  }
  const prior = JSON.parse(priorBytes);
  if (prior.budget.chargedMicroUsd !== 619_189 || prior.budget.pending || prior.budget.calls !== 38
    || prior.rows.length !== 30 || prior.rows.some((row: any) => !row.valid)) throw new Error('Prior campaign is not complete');
  const remainingMicroUsd = 15_000_000 - prior.budget.chargedMicroUsd;
  const directory = resolve(parent, 'production-chunks');
  const sourceCommit = readFileSync(resolve(directory, 'source-commit'), 'utf8').trim();
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Supplement source is not pinned');
  const metadata = { sourceCommit, meshVersion: prior.metadata.meshVersion, budgetUsd: 15,
    priorChargedMicroUsd: prior.budget.chargedMicroUsd, remainingMicroUsd, maxPhysicalRequests: 16,
    priorResultsSha256: sha256(priorBytes), priorJournalSha256: sha256(priorJournal),
    fixturePlanSha256: sha256(JSON.stringify(NANO_PRODUCTION_CHUNK_CASES)), retries: 0, tier: 'default' };
  const journal = createNanoJournal(directory, metadata);
  const runtime = createNanoRuntime(journal, { limitUsd: remainingMicroUsd / 1_000_000, maxCalls: 16 });
  const rows: Array<Record<string, any>> = [];
  return {
    failed: () => runtime.budget.snapshot().closed,
    abortActive: runtime.abortActive,
    runCase: async (fixture: typeof NANO_PRODUCTION_CHUNK_CASES[number], model: NanoCandidate) => {
      const signal = runtime.activate(model, fixture.id);
      vi.stubEnv('OPENAI_MODEL', model);
      const before = runtime.receipts.length;
      const started = performance.now();
      let result;
      try { result = await runNanoLongCase(fixture, model, signal); }
      catch { runtime.budget.close(); result = { output: null, checks: { helperExecution: false }, fixtureSha256: sha256(JSON.stringify(fixture)) }; }
      finally { runtime.abortActive(); vi.unstubAllEnvs(); }
      const receipts = runtime.receipts.slice(before);
      const checks = { ...result.checks, exactRequestCount: receipts.length === 4,
        completeProviderOutput: receipts.every((r) => r.status === 'stop'),
        reasoningMeasuredAndDisabled: receipts.every((r) => r.reasoningReported && r.usage.reasoning === 0),
        noSafetyFailure: !runtime.budget.snapshot().closed };
      const row = { type: 'case', caseId: fixture.id, kind: fixture.kind, model, elapsedMs: performance.now() - started,
        fixtureSha256: result.fixtureSha256, checks, valid: Object.values(checks).every(Boolean), output: result.output,
        requestOrdinals: receipts.map((r) => r.ordinal), knownCostUsd: receipts.reduce((sum, r) => sum + r.costUsd, 0) };
      rows.push(row); journal.append(row);
      return row;
    },
    finish: () => {
      try {
        const budget = runtime.budget.snapshot();
        const report = { metadata, rows, receipts: runtime.receipts, budget,
          cumulativeChargedMicroUsd: prior.budget.chargedMicroUsd + budget.chargedMicroUsd };
        journal.append({ type: 'finished', cases: rows.length, validCases: rows.filter((r) => r.valid).length,
          cumulativeChargedMicroUsd: report.cumulativeChargedMicroUsd });
        writeFileSync(resolve(directory, 'campaign-results.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
      } finally { runtime.close(); journal.close(); vi.unstubAllEnvs(); }
    },
  };
};
