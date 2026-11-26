import { rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
  computeFakeExpectedIntervalMs,
  DEFAULT_FAKE_SYSTEMD_STATE,
  type FakeSchedulerAdapter,
  type LocalTaskStatusV1,
  type OsSchedulerAdapter,
} from './adapter-types.js';
import { validateAllowedExecutable } from './allowlist.js';
import { validateTaskSpec } from './contract.js';
import type { LocalTaskManifestV1, SystemdRuntimeStateV1 } from './contract-types.js';
import { evaluateKillSwitch, readSchedulerEnvFile } from './env-file.js';
import { ManifestCorruptError, TaskNotFoundError } from './errors.js';
import { evaluateTaskHealth } from './health.js';
import { readTaskLockSummary } from './lock.js';
import {
  ensurePrivateDir, probeStateDirObservability, readTaskManifest,
  resolveSchedulerEnvFilePath, resolveStateDir, writeFileAtomicPrivate,
} from './state-dir.js';
import { renderSystemdUnits } from './systemd/unit-generator.js';
import { readLastSkipEntry, readTaskWitness, writeTaskWitnessAtomic } from './witness.js';

export type { FakeSchedulerAdapter, LocalTaskStatusV1, OsSchedulerAdapter };

/** Disk-backed fake OsSchedulerAdapter for consumer tests without systemd --user (§4.2). */
export function createFakeSchedulerAdapter(opts?: {
  readonly clock?: () => string;
  readonly stateDir?: string;
  readonly envFilePath?: string;
}): FakeSchedulerAdapter {
  const stateDir = opts?.stateDir ?? resolveStateDir();
  const envFilePath = opts?.envFilePath ?? (opts?.stateDir ? path.join(stateDir, 'env') : resolveSchedulerEnvFilePath());
  const clock = opts?.clock ?? (() => new Date().toISOString());
  ensurePrivateDir(stateDir);

  let systemdState: SystemdRuntimeStateV1 | 'unavailable' = DEFAULT_FAKE_SYSTEMD_STATE;
  let lingerEnabled: boolean | null = false;
  const renderedUnits = new Map<string, { readonly service: string; readonly timer: string }>();

  return {
    async enable(spec, policy) {
      const validSpec = validateTaskSpec(spec);
      validateAllowedExecutable(policy.runner.bin, policy.runner.args, policy.allowedBins, policy.allowedScripts, 'runner');
      validateAllowedExecutable(validSpec.command.bin, validSpec.command.args, policy.allowedBins, policy.allowedScripts, 'command');
      const expectedIntervalMs = computeFakeExpectedIntervalMs(validSpec);
      const taskStateDir = policy.stateDir ?? stateDir;
      const taskEnvFilePath = policy.envFilePath ?? envFilePath;
      ensurePrivateDir(taskStateDir);
      const taskDir = path.join(taskStateDir, 'tasks', validSpec.taskId);
      ensurePrivateDir(taskDir);

      const prev = readTaskManifest(taskStateDir, validSpec.taskId);
      const now = clock();
      const installedAt = prev && prev !== 'corrupt' ? prev.installedAt : now;
      const baseManifest = {
        v: 1 as const, spec: validSpec, runner: policy.runner, enabled: true,
        installedAt, enabledAt: now, stateDir: taskStateDir, envFilePath: taskEnvFilePath, expectedIntervalMs,
      };
      const rendered = renderSystemdUnits(baseManifest);
      const manifest: LocalTaskManifestV1 = {
        ...baseManifest,
        units: { serviceSha256: rendered.serviceSha256, timerSha256: rendered.timerSha256 },
      };
      writeFileAtomicPrivate(path.join(taskDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      renderedUnits.set(validSpec.taskId, { service: rendered.service, timer: rendered.timer });
      const unitBase = policy.unitDir ?? path.join(taskStateDir, 'units');
      return {
        manifest,
        servicePath: path.join(unitBase, `sentropic-task-${validSpec.taskId}.service`),
        timerPath: path.join(unitBase, `sentropic-task-${validSpec.taskId}.timer`),
        lingerEnabled,
        ...(lingerEnabled === false ? { lingerNotice: 'Linger is disabled; run `loginctl enable-linger "$USER"` to keep user timers active while logged out.' } : {}),
      };
    },
    async disable(taskId, disableOpts) {
      const targetDir = disableOpts?.stateDir ?? stateDir;
      const manifestPath = path.join(targetDir, 'tasks', taskId, 'manifest.json');
      const prev = readTaskManifest(targetDir, taskId);
      if (prev === null) throw new TaskNotFoundError(taskId, `Task ${taskId} is not installed`);
      if (prev === 'corrupt') throw new ManifestCorruptError(manifestPath, `Task ${taskId} manifest is corrupt`);
      const updated: LocalTaskManifestV1 = { ...prev, enabled: false };
      writeFileAtomicPrivate(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
      return { taskId, manifest: updated };
    },
    async status(taskId, statusOpts) {
      const targetDir = statusOpts?.stateDir ?? stateDir;
      const nowIso = statusOpts?.nowIso ?? clock();
      const obs = probeStateDirObservability(targetDir);
      const manifest = obs.observable ? readTaskManifest(targetDir, taskId) : null;
      const witness = obs.observable ? readTaskWitness(targetDir, taskId) : null;
      const lock = obs.observable ? readTaskLockSummary(targetDir, taskId) : null;
      const lastSkip = obs.observable ? readLastSkipEntry(targetDir, taskId) : null;
      const effectiveEnvPath = manifest && manifest !== 'corrupt' ? manifest.envFilePath : envFilePath;
      const persistedEnv = readSchedulerEnvFile(effectiveEnvPath);
      const envFileProtectedOverrides = persistedEnv
        ? (['PATH', 'SENTROPIC_LOCAL_SCHEDULER_STATE_DIR'] as const).filter((k) => k in persistedEnv)
        : [];
      const specRef = manifest && manifest !== 'corrupt' ? manifest.spec : { taskId, killSwitchEnv: undefined };
      const health = evaluateTaskHealth({
        stateDirObservable: obs.observable, manifest, witness,
        persistedKillSwitch: persistedEnv ? evaluateKillSwitch(persistedEnv, specRef) : null,
        readerEnvKillSwitch: evaluateKillSwitch(process.env, specRef),
        lock, lastSkip, envFileProtectedOverrides, nowIso,
      });
      return { manifest, witness, lock, lastSkip, health, systemd: systemdState, lingerEnabled };
    },
    async uninstall(taskId, uninstallOpts) {
      const targetDir = uninstallOpts?.stateDir ?? stateDir;
      const hadManifest = readTaskManifest(targetDir, taskId) !== null;
      const unitBase = uninstallOpts?.unitDir ?? path.join(targetDir, 'units');
      const removedUnits = hadManifest || renderedUnits.has(taskId)
        ? [path.join(unitBase, `sentropic-task-${taskId}.timer`), path.join(unitBase, `sentropic-task-${taskId}.service`)]
        : [];
      renderedUnits.delete(taskId);
      const taskDir = path.join(targetDir, 'tasks', taskId);
      if (uninstallOpts?.purgeState) {
        rmSync(taskDir, { recursive: true, force: true });
        try { unlinkSync(path.join(targetDir, 'locks', `${taskId}.lock`)); } catch { /* absent */ }
      } else {
        try { unlinkSync(path.join(taskDir, 'manifest.json')); } catch { /* absent */ }
      }
      return { taskId, removedUnits, purgedState: Boolean(uninstallOpts?.purgeState) };
    },
    setWitness(taskId, witness) {
      const taskDir = path.join(stateDir, 'tasks', taskId);
      const witnessPath = path.join(taskDir, 'last-run.json');
      if (witness === null) { try { unlinkSync(witnessPath); } catch { /* absent */ } }
      else if (witness === 'corrupt') { ensurePrivateDir(taskDir); writeFileAtomicPrivate(witnessPath, '{corrupt'); }
      else writeTaskWitnessAtomic(stateDir, taskId, witness);
    },
    setPersistedEnvFile(text) { ensurePrivateDir(path.dirname(envFilePath)); writeFileAtomicPrivate(envFilePath, text); },
    setSystemdState(state, linger) { systemdState = state; if (linger !== undefined) lingerEnabled = linger; },
    getRenderedUnits(taskId) {
      const cached = renderedUnits.get(taskId);
      if (cached) return cached;
      const manifest = readTaskManifest(stateDir, taskId);
      if (!manifest || manifest === 'corrupt') return null;
      const r = renderSystemdUnits(manifest);
      return { service: r.service, timer: r.timer };
    },
  };
}
