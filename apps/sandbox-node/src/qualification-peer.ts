import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunscRuntimeAdapter } from './runtime-adapter.js';
import { tenantWitnessScript, verifyTenantWitness } from './qualification-network.js';
import { qualificationProcesses, assertQualificationProcessesGone } from './qualification-processes.js';
import { waitForQualificationPort } from './qualification-runtime.js';
import { qualificationDiskMiB, qualificationInodes } from './qualification-storage.js';

/** A second live tenant, sharing neither namespace nor disk state. */
export function qualificationPeer(directory: string, release: string) {
  const adapter = new RunscRuntimeAdapter();
  const uid = `qual-peer-${randomUUID()}`, base = join(directory, uid), path = join(base, 'box');
  let processes: ReturnType<typeof qualificationProcesses> | undefined;
  return {
    async start(signal: AbortSignal) {
      mkdirSync(base, { mode: 0o700 });
      copyFileSync(join(release, 'qualification.erofs'), join(base, 'source.erofs'));
      await adapter.runSandbox({ tenantId: 'immo', sandboxUid: uid, network: 'ports', profile: 'live',
        overlayUpper: join(path, 'upper'), overlayWork: join(path, 'work'), quotaMiB: 704,
        diskQuotaMiB: qualificationDiskMiB, quotaInodes: qualificationInodes, uid: 1000, gid: 1000,
        command: ['/usr/local/bin/node', '-e', tenantWitnessScript('immo')],
        mounts: [{ source: join(release, 'rootfs.erofs'), target: '/bases/rootfs/release', readOnly: true },
          { source: join(base, 'source.erofs'), target: '/bases/source/qualification', readOnly: true }] });
      processes = qualificationProcesses(uid);
      await waitForQualificationPort(uid, signal, () => {});
      verifyTenantWitness(uid, 'immo');
    },
    verify() { verifyTenantWitness(uid, 'immo'); },
    async close() {
      await adapter.destroySandbox(`runsc-immo-${uid}`);
      if (processes) assertQualificationProcessesGone(processes);
      rmSync(base, { recursive: true, force: true });
    },
  };
}
