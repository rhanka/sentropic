import path from 'node:path';
import type { OsSchedulerAdapter } from '../adapter-types.js';
import { validateAllowedExecutable } from '../allowlist.js';
import { validateTaskSpec } from '../contract.js';
import type { LocalTaskManifestV1 } from '../contract-types.js';
import { evaluateKillSwitch, readSchedulerEnvFile } from '../env-file.js';
import { InvalidTaskSpecError, ManifestCorruptError, SystemctlFailedError, TaskNotFoundError } from '../errors.js';
import { evaluateTaskHealth } from '../health.js';
import { assertHostPidNamespace } from '../host-pid-guard.js';
import { readTaskLockSummary } from '../lock.js';
import {
  ensurePrivateDir, probeStateDirObservability, readTaskManifest,
  resolveSchedulerEnvFilePath, resolveStateDir, writeFileAtomicPrivate,
} from '../state-dir.js';
import { readLastSkipEntry, readTaskWitness } from '../witness.js';
import { isNotLoadedError, querySystemdRuntime, TASK_ID_REGEX } from './runtime-query.js';
import { computeExpectedIntervalMsWith } from './calendar.js';
import { defaultExecFile, probeLingerEnabledWith, requireSystemdUserAvailable, runSystemctl, type ExecFileFn } from './systemctl.js';
import { assertManagedUnitIfPresent, defaultUnitDir, ensureSafeUnitDir, removeUnitsAndTaskState, rollbackEnableUnits, unitPaths } from './unit-files.js';
import { renderSystemdUnits } from './unit-generator.js';

export interface SystemdAdapterInternalDeps {
  readonly stateDir?: string;
  readonly envFilePath?: string;
  readonly hostPidGuard?: () => void;
  readonly execFile?: ExecFileFn;
  readonly nowIso?: () => string;
}

/** @internal Package-internal factory with hostPidGuard/execFile seams (never exported in package.json). */
export function createSystemdUserAdapterInternal(deps: SystemdAdapterInternalDeps = {}): OsSchedulerAdapter {
  const execFn = deps.execFile ?? defaultExecFile;
  const hostGuard = deps.hostPidGuard ?? assertHostPidNamespace;
  const nowClock = deps.nowIso ?? (() => new Date().toISOString());

  return {
    async enable(spec, policy) {
      hostGuard();
      await requireSystemdUserAvailable(execFn);
      const validSpec = validateTaskSpec(spec);
      validateAllowedExecutable(policy.runner.bin, policy.runner.args, policy.allowedBins, policy.allowedScripts, 'runner');
      validateAllowedExecutable(validSpec.command.bin, validSpec.command.args, policy.allowedBins, policy.allowedScripts, 'command');
      const expectedIntervalMs = await computeExpectedIntervalMsWith(validSpec.schedule.onCalendar, execFn);
      if (validSpec.schedule.expectedIntervalMs !== undefined && Math.abs(validSpec.schedule.expectedIntervalMs - expectedIntervalMs) / expectedIntervalMs > 0.1) {
        throw new InvalidTaskSpecError('INTERVAL_MISMATCH', `schedule.expectedIntervalMs (${validSpec.schedule.expectedIntervalMs}) deviates > 10% from ${expectedIntervalMs}`, 'schedule.expectedIntervalMs');
      }
      const stateDir = policy.stateDir ?? deps.stateDir ?? resolveStateDir();
      const envFilePath = policy.envFilePath ?? deps.envFilePath ?? resolveSchedulerEnvFilePath();
      const unitDir = policy.unitDir ?? defaultUnitDir();
      ensurePrivateDir(stateDir);
      const taskDir = path.join(stateDir, 'tasks', validSpec.taskId);
      ensurePrivateDir(taskDir);
      ensureSafeUnitDir(unitDir);
      const paths = unitPaths(unitDir, validSpec.taskId);
      const { servicePath, timerPath, timerName } = paths;
      assertManagedUnitIfPresent(servicePath, validSpec.taskId);
      assertManagedUnitIfPresent(timerPath, validSpec.taskId);

      const prev = readTaskManifest(stateDir, validSpec.taskId);
      if (prev === 'corrupt') throw new ManifestCorruptError(path.join(taskDir, 'manifest.json'), `Task ${validSpec.taskId} manifest is corrupt`);
      const wasActive = prev !== null && prev.spec.schedule.onCalendar !== validSpec.schedule.onCalendar
        ? await runSystemctl(['is-active', '--', timerName], execFn).then((out) => out.trim() === 'active', () => false)
        : false;
      const nowIso = nowClock();
      const baseManifest = {
        v: 1 as const, spec: validSpec, runner: policy.runner, enabled: true,
        installedAt: prev ? prev.installedAt : nowIso, enabledAt: nowIso, stateDir, envFilePath, expectedIntervalMs,
      };
      const rendered = renderSystemdUnits(baseManifest);
      writeFileAtomicPrivate(servicePath, rendered.service);
      writeFileAtomicPrivate(timerPath, rendered.timer);
      try {
        await runSystemctl(['daemon-reload'], execFn);
        await runSystemctl([...(policy.runtime ? ['enable', '--now', '--runtime'] : ['enable', '--now']), '--', timerName], execFn);
        if (wasActive) await runSystemctl(['restart', '--', timerName], execFn);
      } catch (err) {
        if (!(err instanceof SystemctlFailedError)) throw err;
        const rolledBack = await rollbackEnableUnits(prev, paths, policy.runtime, execFn);
        throw new SystemctlFailedError(err.command, err.stderr, rolledBack, err.message, { cause: err });
      }
      const manifest: LocalTaskManifestV1 = { ...baseManifest, units: { serviceSha256: rendered.serviceSha256, timerSha256: rendered.timerSha256 } };
      writeFileAtomicPrivate(path.join(taskDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      const lingerEnabled = await probeLingerEnabledWith(execFn);
      return {
        manifest, servicePath, timerPath, lingerEnabled,
        ...(lingerEnabled === false ? { lingerNotice: 'Linger is disabled; run `loginctl enable-linger "$USER"` to keep user timers active while logged out.' } : {}),
      };
    },
    async disable(taskId, disableOpts) {
      if (!TASK_ID_REGEX.test(taskId)) throw new InvalidTaskSpecError('INVALID_TASK_SPEC', `Invalid taskId: ${taskId}`, 'taskId');
      await requireSystemdUserAvailable(execFn);
      const targetDir = disableOpts?.stateDir ?? deps.stateDir ?? resolveStateDir();
      const manifestPath = path.join(targetDir, 'tasks', taskId, 'manifest.json');
      const prev = readTaskManifest(targetDir, taskId);
      if (prev === null) throw new TaskNotFoundError(taskId, `Task ${taskId} is not installed`);
      if (prev === 'corrupt') throw new ManifestCorruptError(manifestPath, `Task ${taskId} manifest is corrupt`);
      const { servicePath, timerPath, timerName } = unitPaths(disableOpts?.unitDir ?? defaultUnitDir(), taskId);
      assertManagedUnitIfPresent(servicePath, taskId);
      assertManagedUnitIfPresent(timerPath, taskId);
      await runSystemctl([...(disableOpts?.runtime ? ['disable', '--now', '--runtime'] : ['disable', '--now']), '--', timerName], execFn);
      const updated: LocalTaskManifestV1 = { ...prev, enabled: false };
      writeFileAtomicPrivate(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
      return { taskId, manifest: updated };
    },
    async status(taskId, statusOpts) {
      const targetDir = statusOpts?.stateDir ?? deps.stateDir ?? resolveStateDir();
      const obs = probeStateDirObservability(targetDir);
      const validId = TASK_ID_REGEX.test(taskId);
      const manifest = obs.observable && validId ? readTaskManifest(targetDir, taskId) : null;
      const witness = obs.observable && validId ? readTaskWitness(targetDir, taskId) : null;
      const lock = obs.observable && validId ? readTaskLockSummary(targetDir, taskId) : null;
      const lastSkip = obs.observable && validId ? readLastSkipEntry(targetDir, taskId) : null;
      const envPath = manifest && manifest !== 'corrupt' ? manifest.envFilePath : (deps.envFilePath ?? resolveSchedulerEnvFilePath());
      const persistedEnv = readSchedulerEnvFile(envPath);
      const envFileProtectedOverrides = persistedEnv ? (['PATH', 'SENTROPIC_LOCAL_SCHEDULER_STATE_DIR'] as const).filter((k) => k in persistedEnv) : [];
      const specRef = manifest && manifest !== 'corrupt' ? manifest.spec : { taskId, killSwitchEnv: undefined };
      const health = evaluateTaskHealth({
        stateDirObservable: obs.observable, manifest, witness,
        persistedKillSwitch: persistedEnv ? evaluateKillSwitch(persistedEnv, specRef) : null,
        readerEnvKillSwitch: evaluateKillSwitch(process.env, specRef),
        lock, lastSkip, envFileProtectedOverrides, nowIso: statusOpts?.nowIso ?? nowClock(),
      });
      const { serviceName, timerName } = unitPaths(defaultUnitDir(), taskId);
      const rt = await querySystemdRuntime(serviceName, timerName, witness, execFn);
      return { manifest, witness, lock, lastSkip, health, systemd: rt.systemd, lingerEnabled: rt.lingerEnabled };
    },
    async uninstall(taskId, uninstallOpts) {
      if (!TASK_ID_REGEX.test(taskId)) throw new InvalidTaskSpecError('INVALID_TASK_SPEC', `Invalid taskId: ${taskId}`, 'taskId');
      await requireSystemdUserAvailable(execFn);
      const targetDir = uninstallOpts?.stateDir ?? deps.stateDir ?? resolveStateDir();
      const paths = unitPaths(uninstallOpts?.unitDir ?? defaultUnitDir(), taskId);
      const { servicePath, timerPath, serviceName, timerName } = paths;
      assertManagedUnitIfPresent(servicePath, taskId);
      assertManagedUnitIfPresent(timerPath, taskId);
      const disArgs = uninstallOpts?.runtime ? ['disable', '--now', '--runtime', '--', timerName] : ['disable', '--now', '--', timerName];
      await runSystemctl(disArgs, execFn).catch((e) => { if (!isNotLoadedError(e)) throw e; });
      await runSystemctl(['stop', '--', serviceName], execFn).catch((e) => { if (!isNotLoadedError(e)) throw e; });
      await runSystemctl(['clean', '--what=state', '--', timerName], execFn).catch((e) => { if (!isNotLoadedError(e)) throw e; });
      const removedUnits = removeUnitsAndTaskState(paths, targetDir, taskId, uninstallOpts?.purgeState);
      await runSystemctl(['daemon-reload'], execFn).catch(() => {});
      await runSystemctl(['reset-failed', '--', serviceName, timerName], execFn).catch(() => {});
      return { taskId, removedUnits, purgedState: Boolean(uninstallOpts?.purgeState) };
    },
  };
}
