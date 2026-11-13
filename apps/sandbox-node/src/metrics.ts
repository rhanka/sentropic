import { readFileSync } from 'node:fs';
import type { createExecutionNode } from './index.js';
import { baseCacheHits } from './base-store.js';

/** Cumulative cgroup counters; purpose=all denotes tenant aggregate accounting. */
export function nodeMetrics(node: ReturnType<typeof createExecutionNode>, read = (path: string) => readFileSync(path, 'utf8')) {
  return (['sentropic', 'immo'] as const).map(tenant_id => {
    const root = `/sys/fs/cgroup/builder.slice/builder-tenant.slice/builder-tenant-${tenant_id}.slice`;
    const counter = (file: string, pattern: RegExp) => {
      const match = pattern.exec(read(`${root}/${file}`));
      if (!match) throw new Error(`invalid cgroup metric ${file}`);
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value < 0) throw new Error('invalid cgroup counter');
      return value;
    };
    return { tenant_id, purpose: 'all', sandboxesActive: node.daemon.activeCount(tenant_id),
      memoryBytes: counter('memory.current', /^(\d+)\s*$/),
      cpuSecondsTotal: counter('cpu.stat', /^usage_usec (\d+)$/m) / 1e6,
      psiStallSeconds: counter('memory.pressure', /^some .* total=(\d+)$/m) / 1e6,
      wfqWaitMs: node.admission.builds.waitMs[tenant_id], cacheHitsTotal: baseCacheHits[tenant_id] };
  });
}
