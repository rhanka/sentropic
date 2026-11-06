import { LiveError } from './records';

/** A timeout does not attest termination: callers must quiesce and confirm teardown before replacement. */
export async function withinPhase<T>(work: Promise<T>, milliseconds = 300_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new LiveError('builder_unavailable')), milliseconds); timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}
