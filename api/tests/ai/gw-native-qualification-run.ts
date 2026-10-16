import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { qualificationCases } from '../../src/services/llm-runtime/gw-native-qualification-plan';
import { closeQualificationRun, qualificationRoot, readQualificationFixture } from '../../src/services/llm-runtime/gw-native-qualification-transport';
import { checkQualificationReadiness, checkQualificationReaper, probeQualificationListener, qualificationEnvironment,
  qualificationListener, openQualificationDb, requireQualification } from './gw-native-qualification-readiness';
import { readQualificationReply } from './gw-native-qualification-http';
import { readQualificationLedger } from './gw-native-qualification-ledger';
import { serverToolQualifies } from './gw-native-qualification-receipts';

export const createFirstFailureGuard = (close: () => void) => {
  let failed = false;
  return { failed: () => failed, async run<T>(operation: () => Promise<T>): Promise<T> {
    requireQualification(!failed);
    try { return await operation(); }
    catch { failed = true; try { close(); } finally { throw new Error('Qualification stopped at first failed case'); } }
  } };
};
const persist = (name: string, evidence: unknown) => writeFileSync(`${qualificationRoot}/${name}.json`, JSON.stringify(evidence), { flag: 'wx', mode: 0o600 });
export const postQualificationReadinessFailure = async () => {
  const { token } = qualificationEnvironment();
  await probeQualificationListener(token);
  // No run was armed: only the operator's existing listener is probed, without administrative mutation.
};
export const createQualificationRun = async () => {
  const { token, database } = qualificationEnvironment(); const fixture = readQualificationFixture();
  const db = await openQualificationDb(database);
  let before: Awaited<ReturnType<typeof checkQualificationReadiness>>;
  try {
    before = await checkQualificationReadiness(db, token);
    mkdirSync(qualificationRoot, { recursive: true, mode: 0o700 });
    requireQualification(!existsSync(`${qualificationRoot}/1.sent.json`) && !existsSync(`${qualificationRoot}/closed.json`));
    persist('armed', { runId: randomUUID(), callCap: 13, readinessPassed: true });
  } catch { await db.end(); throw new Error('Qualification readiness or construction evidence failed'); }
  const cases = qualificationCases(fixture); let completed = 0;
  const guard = createFirstFailureGuard(() => closeQualificationRun());
  return { failed: guard.failed,
    async runCase(index: number) { return guard.run(async () => {
      checkQualificationReaper(before.identity.generation);
      requireQualification(index === completed); const planned = cases[index]!;
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'anthropic-version': '2023-06-01',
        ...(planned.betas.length ? { 'anthropic-beta': planned.betas.join(',') } : {}) };
      const response = await fetch(`${qualificationListener}/v1/messages${planned.count ? '/count_tokens' : ''}`, {
        method: 'POST', headers, body: JSON.stringify(planned.body), redirect: 'error', signal: AbortSignal.timeout(55_000) });
      try {
        requireQualification(response.status === 200);
        const requestId = response.headers.get('x-sentropic-request-id') ?? '';
        requireQualification(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId));
        const native = response.headers.get('x-sentropic-relay') === 'native'; requireQualification(native === planned.native);
        const reply = await readQualificationReply(response, planned.stream, fixture.successfulSafeguardResults);
        persist(`${index + 1}.reply`, { requestId, model: planned.model, stream: planned.stream, status: response.status, native, ...reply });
        const observer = JSON.parse(readFileSync(`${qualificationRoot}/${index + 1}.observer.json`, 'utf8'));
        requireQualification(observer.serverCredentialEqual && observer.callerCredentialAbsent && observer.model === planned.model
          && observer.stream === planned.stream && (!planned.native || observer.bodyEqual));
        if (planned.count) requireQualification(reply.countTokens !== null);
        else requireQualification(reply.servedModel === planned.model && reply.finalOutput !== null);
        if (planned.name === 'sse' || planned.name === 'json') requireQualification(reply.safeguardResultsPresent
          && reply.safeguardResultsEqual && observer.safeguardResultsPresent && observer.safeguardResultsEqual
          && !reply.input.message_delta_input_decreased);
        const ledger = await readQualificationLedger(db, planned, requestId,
          evidence => persist(`${index + 1}.ledger`, evidence));
        if (planned.native && !planned.count) requireQualification(ledger.outputTokens === reply.finalOutput);
        if (planned.name === 'websearch') {
          const qualified = serverToolQualifies({ selectedModel: planned.model, servedModel: reply.servedModel, native,
            requestId, toolName: 'web_search', serverTool: reply.serverTool, resultObserved: reply.resultObserved,
            webSearchRequests: reply.webSearchRequests, input: reply.input });
          persist('server-tool', { qualified, rq4Pending: ledger.iterations_present === true, ownerDispositionRequired: !qualified
            || ledger.fallback_present === true || ledger.iterations_present === true });
          requireQualification(qualified && !ledger.fallback_present && !ledger.iterations_present);
        }
        completed++;
      } finally { await response.body?.cancel().catch(() => undefined); }
    }); },
    async finish() {
      try {
        closeQualificationRun();
        const after = await checkQualificationReadiness(db, token);
        const unchanged = isDeepStrictEqual(before.identity, after.identity);
        persist('post-run', { probesPassed: true, cutoverPartitionUnchanged: unchanged, completedCases: completed });
        requireQualification(unchanged && (guard.failed() || completed === 13));
      } catch { persist('post-run-failure', { probesPassed: false, completedCases: completed }); throw new Error('Qualification post-run readiness failed'); }
      finally { await db.end(); }
    },
  };
};
