import { describe, expect, it } from 'vitest';
import { InvalidTaskSpecError, type LocalTaskManifestV1 } from '../src/index.js';
import { renderSystemdUnits } from '../src/systemd/unit-generator.js';

function baseManifest(overrides: Partial<Omit<LocalTaskManifestV1, 'units'>> = {}): Omit<LocalTaskManifestV1, 'units'> {
  return {
    v: 1,
    spec: {
      v: 1,
      taskId: 'h2a-session-archive',
      owner: 'h2a',
      description: 'h2a local CLI session archive',
      schedule: { onCalendar: 'daily', persistent: true, randomizedDelaySec: 600, accuracySec: 60 },
      command: { bin: '/usr/bin/node', args: ['/opt/h2a/bin.js', 'archive', 'run'] },
      timeoutMs: 1_800_000,
      killGraceMs: 15_000,
    },
    runner: { bin: '/usr/bin/node', args: ['/opt/h2a/bin.js', 'archive', '_schedule-exec'] },
    enabled: true,
    installedAt: '2026-11-25T10:00:00.000Z',
    enabledAt: '2026-11-25T10:00:00.000Z',
    stateDir: '/home/user/.local/state/sentropic/local-scheduler',
    envFilePath: '/home/user/.config/sentropic/local-scheduler/env',
    expectedIntervalMs: 86_400_000,
    ...overrides,
  };
}

describe('renderSystemdUnits', () => {
  it('renders golden hardened .service and .timer units', () => {
    const out = renderSystemdUnits(baseManifest());
    expect(out.service).toBe([
      '# Managed-By: @sentropic/local-scheduler v1',
      '# Task-Id: h2a-session-archive',
      '# Owner: h2a',
      '[Unit]',
      'Description=Sentropic local scheduled task: h2a local CLI session archive (h2a-session-archive)',
      'After=default.target',
      '',
      '[Service]',
      'Type=oneshot',
      'KillMode=mixed',
      'SuccessExitStatus=130 143',
      'Nice=15',
      'IOSchedulingClass=idle',
      'MemoryMax=512M',
      'CPUQuota=50%',
      'TasksMax=64',
      'UMask=0077',
      'NoNewPrivileges=yes',
      'RestrictAddressFamilies=AF_UNIX',
      'LockPersonality=yes',
      'RestrictRealtime=yes',
      'TimeoutStartSec=1845',
      'TimeoutStopSec=30',
      'Environment="PATH=/usr/bin:/bin"',
      'Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=/home/user/.local/state/sentropic/local-scheduler"',
      'EnvironmentFile=-/home/user/.config/sentropic/local-scheduler/env',
      'UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT',
      'ExecStart="/usr/bin/node" "/opt/h2a/bin.js" "archive" "_schedule-exec" "h2a-session-archive"',
      'StandardOutput=journal',
      'StandardError=journal',
      '',
    ].join('\n'));
    expect(out.timer).toBe([
      '# Managed-By: @sentropic/local-scheduler v1',
      '# Task-Id: h2a-session-archive',
      '# Owner: h2a',
      '[Unit]',
      'Description=Timer for Sentropic local scheduled task: h2a-session-archive',
      '',
      '[Timer]',
      'OnCalendar=daily',
      'Persistent=true',
      'RandomizedDelaySec=600',
      'AccuracySec=60',
      'Unit=sentropic-task-h2a-session-archive.service',
      '',
      '[Install]',
      'WantedBy=timers.target',
      '',
    ].join('\n'));
    expect(out.serviceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.timerSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('escapes % and spaces in paths while keeping $ literal in Environment/EnvironmentFile and $$ in ExecStart (m-25)', () => {
    const out = renderSystemdUnits(baseManifest({
      stateDir: '/home/my user/100%state/$HOME',
      envFilePath: '/home/my user/100%cfg/${H2A_ROOT}/env',
      runner: { bin: '/usr/bin/node', args: ['/opt/dir$$/${X}/runner.mjs', '$$arg', '${H2A_ROOT}'] },
    }));
    expect(out.service).toContain('Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=/home/my user/100%%state/$HOME"');
    expect(out.service).toContain('EnvironmentFile=-/home/my user/100%%cfg/${H2A_ROOT}/env');
    expect(out.service).toContain('ExecStart="/usr/bin/node" "/opt/dir$$$$/$${X}/runner.mjs" "$$$$arg" "$${H2A_ROOT}" "h2a-session-archive"');
  });

  it('rejects newline injection, % in description, glob chars in envFilePath, lone ; arg, and trailing backslash', () => {
    expect(() => renderSystemdUnits(baseManifest({
      spec: { ...baseManifest().spec, description: 'bad %u' },
    }))).toThrow(InvalidTaskSpecError);
    expect(() => renderSystemdUnits(baseManifest({
      spec: { ...baseManifest().spec, schedule: { onCalendar: 'daily\nExecStart=/bin/sh', persistent: true } },
    }))).toThrow(InvalidTaskSpecError);
    expect(() => renderSystemdUnits(baseManifest({ envFilePath: '/home/user/.config/*.env' }))).toThrow(InvalidTaskSpecError);
    expect(() => renderSystemdUnits(baseManifest({
      runner: { bin: '/usr/bin/node', args: ['/opt/run.mjs', ';'] },
    }))).toThrow(InvalidTaskSpecError);
    expect(() => renderSystemdUnits(baseManifest({
      runner: { bin: '/usr/bin/node', args: ['/opt/run.mjs', 'bad\\'] },
    }))).toThrow(InvalidTaskSpecError);

    for (const badEnvFile of ['/home/user/*.env', '/home/user/env?.txt', '/home/user/[a]/env', '/home/user/env"q', '/home/user/env\\b', 'relative/env']) {
      expect(() => renderSystemdUnits(baseManifest({ envFilePath: badEnvFile }))).toThrow(InvalidTaskSpecError);
    }
    for (const badState of ['/var/lib/s\x00x', '/var/lib/s\rx', '/var/lib/s"x', '/var/lib/s\\x', 'rel/state']) {
      expect(() => renderSystemdUnits(baseManifest({ stateDir: badState }))).toThrow(InvalidTaskSpecError);
    }
    for (const badCal of ['daily\rExecStart=/bin/sh', 'daily\\', 'daily%', '-custom']) {
      expect(() => renderSystemdUnits(baseManifest({
        spec: { ...baseManifest().spec, schedule: { onCalendar: badCal, persistent: true } },
      }))).toThrow(InvalidTaskSpecError);
    }
    expect(() => renderSystemdUnits(baseManifest({
      spec: { ...baseManifest().spec, description: 'bad\x00desc' },
    }))).toThrow(InvalidTaskSpecError);
    expect(() => renderSystemdUnits(baseManifest({
      runner: { bin: '/usr/bin/node', args: ['/opt/run\x00.mjs'] },
    }))).toThrow(InvalidTaskSpecError);

    // m-5: renderSystemdUnits validates owner, resources, numeric bounds, and taskId directly
    const badSpecs: Array<Partial<LocalTaskManifestV1['spec']>> = [
      { owner: 'x\n[Service]\nExecStartPre=/bin/sh' },
      { taskId: 'Bad_Task' },
      { timeoutMs: 100 },
      { killGraceMs: 100 },
      { resources: { ioSchedulingClass: 'realtime' as unknown as 'idle' } },
      { resources: { memoryMax: '10G' } },
      { resources: { cpuQuota: '200%' } },
      { resources: { nice: 99, tasksMax: 9999 } },
    ];
    for (const s of badSpecs) {
      expect(() => renderSystemdUnits(baseManifest({ spec: { ...baseManifest().spec, ...s } }))).toThrow(InvalidTaskSpecError);
    }
  });

  it('escapes quotes/backslashes/percent/dollar in non-path ExecStart args, supports custom resources and non-Node runner', () => {
    const out = renderSystemdUnits(baseManifest({
      spec: {
        ...baseManifest().spec,
        schedule: { onCalendar: 'hourly', persistent: false, randomizedDelaySec: 120, accuracySec: 30 },
        resources: { nice: 5, ioSchedulingClass: 'best-effort', memoryMax: '1G', cpuQuota: '25%', tasksMax: 32 },
      },
      runner: { bin: '/opt/custom/runner$bin', args: ['a"b', 'c\\d', '100%x', '$FOO'] },
    }));
    expect(out.service).toContain('Nice=5');
    expect(out.service).toContain('IOSchedulingClass=best-effort');
    expect(out.service).toContain('MemoryMax=1G');
    expect(out.service).toContain('CPUQuota=25%');
    expect(out.service).toContain('TasksMax=32');
    expect(out.service).toContain('ExecStart="/opt/custom/runner$$bin" "a\\"b" "c\\\\d" "100%%x" "$$FOO" "h2a-session-archive"');
    expect(out.timer).toContain('OnCalendar=hourly');
    expect(out.timer).toContain('Persistent=false');
    expect(out.timer).toContain('RandomizedDelaySec=120');
    expect(out.timer).toContain('AccuracySec=30');
    expect(out.timer).toContain('Unit=sentropic-task-h2a-session-archive.service');
    expect(out.timer).toContain('WantedBy=timers.target');
  });
});
