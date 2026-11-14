import { effectiveTimeout, monoMs, recoveryDeadline, runKubectl, loadState, saveState } from './t3-lib.mjs';
import { classify } from './t3-window-driver.mjs';
import { waitZeroPods } from './t3-rollback.mjs';

// Emergency classifier: freeze the writer, then read the truth. Prints one
// JSON line { journal, locks, committed, receipts, apiReady } on stdout;
// progress goes to stderr. Exit 6 when migration locks are still held after
// the wait budget: a human must decide instead of guessing.
function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const kubeconfig = arg('--kubeconfig-file');
const namespace = arg('--namespace') ?? 'sentropic-preprod';
const dryRun = process.argv.includes('--dry-run');
const postgresPod = arg('--postgres-pod') ?? 'postgres-0';
const postgresUser = arg('--postgres-user') ?? 'app';
const waitBudgetMs = Number(arg('--wait-locks-ms') ?? 60_000);

if (!kubeconfig) {
  console.error('usage: t3-emergency-classify.mjs --kubeconfig-file F [--namespace N] [--dry-run]');
  process.exitCode = 1;
} else {
  const deadlineMs = recoveryDeadline();
  const call = runKubectl({ kubeconfig, namespace, dryRun, print: console.error,
    stateDir: process.env.T3_STATE_DIR, timeoutRef: { deadlineMs } });
  try {
    // Freeze writers BEFORE reading the truth: the commit transaction can
    // land between classify and the scale-down (same order as recover()).
    call(['scale', 'deployment/api', '--replicas=0']);
    waitZeroPods(call, Math.min(deadlineMs, monoMs() + 40_000), ['api']);
    const ctx = { call, config: { candidateImage: '' }, postgresPod, postgresUser,
      dryRun, probeReadOnly: false, print: console.error };
    const t0 = monoMs();
    let info = classify(ctx);
    while (info.locks > 0 && monoMs() - t0 < waitBudgetMs) {
      await new Promise(resolve => setTimeout(resolve, effectiveTimeout(2000, { deadlineMs })));
      info = classify(ctx);
    }
    console.log(JSON.stringify({ journal: info.journal, locks: info.locks,
      committed: info.committed, receipts: info.receipts, apiReady: info.apiReady }));
    if (info.locks === 0 && process.env.T3_STATE_DIR && !dryRun) {
      const state = loadState(process.env.T3_STATE_DIR) ?? {};
      Object.assign(state,{ commitVerified: info.committed,locks: 0,recoveryReason: 'human-emergency' });
      saveState(process.env.T3_STATE_DIR,state);
    }
    if (info.locks > 0) {
      console.error('migration locks still held; refusing to decide');
      process.exitCode = 6;
    }
  } catch (err) {
    console.error(`emergency_classify_failed: ${err.message}`);
    process.exitCode = 1;
  }
}
