// Explicit operator preparation only; no scheduled workflow or qualification side effect.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { policy, requireEvidence } from './toolchain-contract.mjs';
import { createOciClient } from './toolchain-oci.mjs';
import { campaignAcquirer, restoreSnapshot } from './toolchain-cache.mjs';

export async function preflight(operation = 'status') {
  requireEvidence(['status', 'acquire'].includes(operation), 'unknown preparation operation');
  const report = { option: policy.option, qualified: false, scanner: {
    version: policy.version, repository: policy.repository, indexDigest: policy.indexDigest,
    manifestDigest: policy.manifestDigest, platform: policy.platform },
    status: 'coverage-blocked', blockers: policy.blockers, snapshots: {} };
  if (operation === 'acquire') {
    const acquire = campaignAcquirer(createOciClient());
    for (const kind of ['vulnerability', 'java']) {
      try {
        const snapshot = await acquire(kind, '/cache');
        const receipt = await restoreSnapshot(snapshot);
        report.snapshots[kind] = { ...snapshot, receipt };
      } catch (error) { report.snapshots[kind] = { status: 'coverage-blocked', error: error.message }; }
    }
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  preflight(process.argv[2]).then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1; // Preparation can never qualify or activate the daily service.
  }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
