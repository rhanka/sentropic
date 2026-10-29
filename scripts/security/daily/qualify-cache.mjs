// Qualification receipts stay separate from the disabled service's policy.
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { campaignAcquirer, restoreSnapshot } from './toolchain-cache.mjs';
import { createOciClient } from './toolchain-oci.mjs';

const root = '/evidence/cache';
await mkdir(root, { recursive: true, mode: 0o700 });
const acquire = campaignAcquirer(createOciClient());
const report = { observedAt: new Date().toISOString(), qualified: false, snapshots: {}, measurements: {} };
for (const kind of ['vulnerability', 'java']) {
  const start = performance.now();
  try {
    const snapshot = await acquire(kind, root);
    const ingestedMs = performance.now() - start;
    const receipt = await restoreSnapshot(snapshot);
    const restoreMs = performance.now() - start - ingestedMs;
    report.snapshots[kind] = { ...snapshot, receipt };
    report.measurements[kind] = { ingestedMs, restoreMs };
  } catch (error) {
    report.snapshots[kind] = { status: 'coverage-blocked', error: error.message };
    process.exitCode = 1;
  }
}
report.nodeMaxRssKiB = process.resourceUsage().maxRSS;
await writeFile('/evidence/ingestion.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
