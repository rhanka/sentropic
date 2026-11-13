import { describe, expect, it } from 'vitest';
import { nodeMetrics } from '../src/metrics.js';
import { createExecutionNode } from '../src/index.js';

describe('pull node metrics', () => {
  it('should expose tenant-labelled kernel memory, CPU and pressure without inventing counters', () => {
    const node = createExecutionNode();
    const metrics = nodeMetrics(node, path => path.endsWith('memory.current') ? '1024' :
      path.endsWith('cpu.stat') ? 'usage_usec 2500000\n' : 'some avg10=0.00 avg60=0.00 avg300=0.00 total=1000000\n');
    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toMatchObject({ tenant_id: 'sentropic', memoryBytes: 1024, cpuSecondsTotal: 2.5,
      psiStallSeconds: 1, sandboxesActive: 0, wfqWaitMs: 0, cacheHitsTotal: 0 });
  });
});
