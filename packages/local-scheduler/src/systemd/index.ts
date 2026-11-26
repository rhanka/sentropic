import type { OsSchedulerAdapter } from '../adapter-types.js';
import { createSystemdUserAdapterInternal } from './adapter.js';
import { computeExpectedIntervalMs } from './calendar.js';
import { probeSystemdUserAvailability } from './systemctl.js';
import { renderSystemdUnits } from './unit-generator.js';

/** Creates the production systemd --user OsSchedulerAdapter (§3.2, §4.2). */
export function createSystemdUserAdapter(opts?: {
  readonly stateDir?: string;
  readonly envFilePath?: string;
}): OsSchedulerAdapter {
  return createSystemdUserAdapterInternal({ stateDir: opts?.stateDir, envFilePath: opts?.envFilePath });
}

export { computeExpectedIntervalMs, probeSystemdUserAvailability, renderSystemdUnits };
