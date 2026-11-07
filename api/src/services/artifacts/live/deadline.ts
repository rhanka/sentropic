import { LiveError } from './records';

/** Bound of one heavy phase; the recipes carry the same 300 s timeout. */
export const PHASE_DEADLINE_MS = 300_000;
/** A timeout does not attest termination: callers must quiesce and confirm teardown before replacement. */
export async function withinPhase<T>(work: Promise<T>, milliseconds = PHASE_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new LiveError('builder_unavailable')), milliseconds); timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}
