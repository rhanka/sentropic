import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFakeSchedulerAdapter, InvalidTaskSpecError, probeStateDirObservability,
  readLastSkipEntry, readSchedulerEnvFile, readTaskLockSummary, readTaskManifest,
  readTaskWitness, TaskNotFoundError, type LocalTaskSpecV1,
} from '../src/index.js';

const tmpDirs: string[] = [];
const makeTmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'lsch-fake-')); tmpDirs.push(d); return d; };
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

describe('createFakeSchedulerAdapter', () => {
  it('creates 0700 stateDir at construction and drives full §4.4 consumer workflow', async () => {
    const root = makeTmp();
    const stateDir = path.join(root, 'state');
    const script = path.join(root, 'h2a-bin.mjs');
    writeFileSync(script, 'console.log("archive");\n', { mode: 0o600 });

    const adapter = createFakeSchedulerAdapter({ stateDir, clock: () => '2026-11-25T10:00:00.000Z' });
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(probeStateDirObservability(stateDir)).toEqual({ observable: true });

    const missing = await adapter.status('h2a-session-archive');
    expect(missing.health.status).toBe('not_installed');

    const spec: LocalTaskSpecV1 = {
      v: 1, taskId: 'h2a-session-archive', owner: 'h2a', description: 'h2a archive',
      schedule: { onCalendar: 'daily', persistent: true, expectedIntervalMs: 86_400_000 },
      command: { bin: process.execPath, args: [script, 'archive', 'run'] },
      timeoutMs: 900_000, killSwitchEnv: 'H2A_ARCHIVE_OFF',
    };
    const policy = { runner: { bin: process.execPath, args: [script, 'archive', '_schedule-exec'] }, allowedBins: [process.execPath], allowedScripts: [script] };

    await expect(adapter.enable({ ...spec, schedule: { ...spec.schedule, expectedIntervalMs: 120_000 } }, policy)).rejects.toThrow(InvalidTaskSpecError);
    const enabled = await adapter.enable(spec, policy);
    expect(enabled.manifest.enabled).toBe(true);
    expect(readTaskManifest(stateDir, 'h2a-session-archive')?.enabled).toBe(true);
    expect(adapter.getRenderedUnits('h2a-session-archive')?.service).toContain('SuccessExitStatus=130 143');

    adapter.setPersistedEnvFile('H2A_ARCHIVE_OFF=1\nPATH=/bad\n');
    expect(readSchedulerEnvFile(path.join(stateDir, 'env'))?.H2A_ARCHIVE_OFF).toBe('1');
    adapter.setWitness('h2a-session-archive', {
      v: 1, taskId: 'h2a-session-archive', owner: 'h2a', runId: 'r-1', trigger: 'systemd-timer', host: 'ws', pid: 10,
      startedAt: '2026-11-25T10:01:00.000Z', finishedAt: '2026-11-25T10:02:00.000Z', durationMs: 60_000,
      outcome: 'skipped_disabled', exitCode: null, signal: null, killSwitch: { scope: 'alias', name: 'H2A_ARCHIVE_OFF' },
      consecutiveFailures: 0, lastSuccessAt: null, lastSuccessRunId: null,
    });
    expect(readTaskWitness(stateDir, 'h2a-session-archive')?.outcome).toBe('skipped_disabled');
    expect(readTaskLockSummary(stateDir, 'h2a-session-archive')).toBeNull();
    expect(readLastSkipEntry(stateDir, 'h2a-session-archive')).toBeNull();

    const st = await adapter.status('h2a-session-archive', { nowIso: '2026-11-25T12:00:00.000Z' });
    expect(st.health.status).toBe('paused');
    expect(st.health.hints.some((h) => h.includes('remove PATH'))).toBe(true);

    await adapter.disable('h2a-session-archive');
    expect((await adapter.status('h2a-session-archive')).health.status).toBe('disabled');
    await adapter.uninstall('h2a-session-archive', { purgeState: true });
    await expect(adapter.disable('h2a-session-archive')).rejects.toThrow(TaskNotFoundError);
  });
});

describe('static architectural and packaging guards (m-26, m-32(i), §6.1, §6.2)', () => {
  it('enforces zero Python, zero network imports/globals, and safe package exports/files', () => {
    const pkgRoot = path.resolve(process.cwd());
    const allFiles = collectFiles(pkgRoot);
    expect(allFiles.some((f) => f.endsWith('.py'))).toBe(false);

    const srcFiles = collectFiles(path.join(pkgRoot, 'src'));
    const forbiddenImports = /\b(?:@sentropic\/cluster-mesh|@sentropic\/flow|node:http|node:https|node:net|node:tls|node:dgram|undici)\b/;
    const forbiddenGlobals = /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\b/;
    for (const file of srcFiles) {
      const text = readFileSync(file, 'utf8');
      expect(forbiddenImports.test(text), file).toBe(false);
      expect(forbiddenGlobals.test(text), file).toBe(false);
      expect(/SKIP_HOST_PID|BYPASS_HOST_PID|NO_HOST_PID/i.test(text), file).toBe(false);
    }

    const pkgJson = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    expect(pkgJson.dependencies).toEqual({});
    expect(pkgJson.files).toEqual(['dist', 'README.md', 'LICENSE']);
    expect(JSON.stringify(pkgJson.exports)).not.toContain('Internal');
  });
});
