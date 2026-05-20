/**
 * @sentropic/flow — job processing outer loop (pure function).
 *
 * Real reorganization (BR-26 Lot 7, slice 7.F.1, see BR26-FB-03):
 * the outer `processJobs()` loop used to be an `async` method of
 * `QueueManager`. It is extracted here as a pure function taking a
 * `ProcessingLoopDeps` parameter that wires the side-effecting
 * neighbours (paused/cancellation flags, settings snapshot, SQL
 * claim/count/has-pending helpers, the per-job `processJob`
 * callback, and the `notifyJobEvent` side-effect).
 *
 * Per-job logic (`processJob` — ~600 LOC with all executor bindings)
 * STAYS in `queue-manager.ts` and is passed in via `deps.processJob`.
 * Claim/count/pending reads live behind deps callbacks, usually backed
 * by a concrete JobQueue adapter. Settings (`maxAi`, `maxPublishing`,
 * `intervalMs`) are read from `deps.getSettings()` once at loop entry.
 *
 * Behavior-preserving extraction — replay byte-identical with the
 * pre-extraction `QueueManager.processJobs()`.
 */

export type QueueClass = 'ai' | 'chat' | 'publishing';

export interface ProcessingLoopSettings {
  /** Max concurrent jobs for the `ai` and `chat` queue classes. */
  maxAi: number;
  /** Max concurrent jobs for the `publishing` queue class. */
  maxPublishing: number;
  /** Tick interval (ms) used in the inFlight race timeout. */
  intervalMs: number;
}

export interface ProcessingLoopDeps<TJobRow = unknown> {
  /** Read the current settings snapshot (called once at loop entry). */
  getSettings(): ProcessingLoopSettings;
  /** Pause flag — when true, the loop exits the outer `while`. */
  isPaused(): boolean;
  /** Cancel-all flag — when true, the loop breaks immediately. */
  isCancelAllInProgress(): boolean;
  /** Update the `isProcessing` state flag on the owner. */
  setProcessing(value: boolean): void;
  /** Count currently-processing jobs for a given queue class. */
  getProcessingCountByClass(queueClass: QueueClass): Promise<number>;
  /**
   * Claim up to `limit` pending jobs in `queueClass`, atomically
   * transitioning them to `processing`. Returns the claimed rows.
   */
  claimPendingJobsByClass(queueClass: QueueClass, limit: number): Promise<TJobRow[]>;
  /** True iff at least one job row is still in `pending` status. */
  hasAnyPending(): Promise<boolean>;
  /** Notify subscribers that a job has been (re-)entered the queue. */
  notifyJobEvent(jobId: string): Promise<void>;
  /** Extract the job id from a claimed row (used for notify + telemetry). */
  getJobId(row: TJobRow): string;
  /** Per-job processing callback (the executor switch on JobType). */
  processJob(row: TJobRow): Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run the processing outer loop until paused or cancelled.
 *
 * Replay-preserving equivalent of `QueueManager.processJobs()`:
 *   - reads settings once at entry,
 *   - iterates `['chat','publishing','ai']` queue classes per tick,
 *   - fills slots up to per-class concurrency,
 *   - `notifyJobEvent` is awaited before launching `processJob`,
 *   - the in-flight set lives locally (recovered on each call),
 *   - the race blocks on `Promise.race(inFlight) | sleep(intervalMs)`
 *     so newly-enqueued jobs do not starve behind long-running ones,
 *   - when nothing is in-flight and `hasAnyPending()` is false the
 *     loop terminates cleanly,
 *   - when nothing is in-flight but pending rows exist (global slots
 *     exhausted or race) the loop sleeps 200ms then re-tries.
 *
 * Real reorganization (BR-26 Lot 7 slice F.1): ex `QueueManager.processJobs`.
 */
export async function runProcessingLoop<TJobRow = unknown>(
  deps: ProcessingLoopDeps<TJobRow>,
): Promise<void> {
  // Guard re-entry: callers (queue-manager wrapper) already check
  // `isProcessing` before invoking us. We still mark the state so any
  // downstream observer (settings-reload, pause/resume) sees the
  // expected lifecycle.
  deps.setProcessing(true);
  console.log('🚀 Starting job processing...');
  try {
    const inFlight = new Set<Promise<void>>();
    const queueClasses: QueueClass[] = ['chat', 'publishing', 'ai'];
    const settings = deps.getSettings();

    while (!deps.isPaused()) {
      if (deps.isCancelAllInProgress()) break;

      for (const queueClass of queueClasses) {
        const classLimit =
          queueClass === 'publishing' ? settings.maxPublishing : settings.maxAi;
        const classProcessing = await deps.getProcessingCountByClass(queueClass);
        const slots = Math.max(0, classLimit - classProcessing);
        if (slots <= 0) continue;

        const claimedJobs = await deps.claimPendingJobsByClass(queueClass, slots);
        for (const job of claimedJobs) {
          await deps.notifyJobEvent(deps.getJobId(job));
          const p = deps.processJob(job).finally(() => {
            inFlight.delete(p);
          });
          inFlight.add(p);
        }
      }

      // If nothing is running and nothing is pending, we're done.
      if (inFlight.size === 0) {
        const more = await deps.hasAnyPending();
        if (!more) break;
        // No local work but pending exists: either slots=0 (global
        // limit reached) or a race. Wait briefly.
        await sleep(200);
        continue;
      }

      // Wait for at least one job to finish, then continue filling.
      // IMPORTANT: do not block indefinitely on long-running jobs.
      // New jobs can be enqueued while we are waiting; we must
      // periodically wake up to claim additional pending jobs (up to
      // the configured global concurrency).
      await Promise.race([Promise.race(inFlight), sleep(settings.intervalMs)]);
    }
  } finally {
    deps.setProcessing(false);
    console.log('✅ Job processing completed');
  }
}
