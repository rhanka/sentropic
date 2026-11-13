/** Cut locally before asynchronous cgroup cleanup. Retry cleanup without overlapping it. */
export function monitorPorts(enabled: () => boolean, cut: () => void, stop: () => Promise<void>,
  failure: () => void = () => {}) {
  let stopping = false;
  const timer = setInterval(() => {
    if (enabled()) return;
    cut();
    if (!stopping) {
      stopping = true;
      void stop().catch(failure).finally(() => { stopping = false; });
    }
  }, 50);
  timer.unref();
  return () => clearInterval(timer);
}
