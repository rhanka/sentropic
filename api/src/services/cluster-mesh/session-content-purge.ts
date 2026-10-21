import type { SessionContentService } from './session-content';

export const startSessionContentPurgeConsumer = (
  content: SessionContentService,
  options: { intervalMs?: number; onError?: () => void } = {},
) => {
  let stopped = false;
  let running: Promise<void> | undefined;
  const sweep = () => {
    if (stopped || running) return;
    running = content.consumePurgeJobs().catch(() => { options.onError?.(); })
      .finally(() => { running = undefined; });
  };
  const timer = setInterval(sweep, options.intervalMs ?? 30_000);
  timer.unref();
  sweep();
  return { stop: async (): Promise<void> => {
    stopped = true;
    clearInterval(timer);
    await running;
  } };
};
