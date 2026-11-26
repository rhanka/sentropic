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
    expect(out.service).toContain('# Managed-By: @sentropic/local-scheduler v1');
    expect(out.service).toContain('SuccessExitStatus=130 143');
    expect(out.service).toContain('KillMode=mixed');
    expect(out.service).toContain('NoNewPrivileges=yes');
    expect(out.service).toContain('RestrictAddressFamilies=AF_UNIX');
    expect(out.service).toContain('LockPersonality=yes');
    expect(out.service).toContain('RestrictRealtime=yes');
    expect(out.service).toContain('TimeoutStartSec=1845');
    expect(out.service).toContain('TimeoutStopSec=30');
    expect(out.service).toContain('Environment="PATH=/usr/bin:/bin"');
    expect(out.service).toContain('Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=/home/user/.local/state/sentropic/local-scheduler"');
    expect(out.service).toContain('EnvironmentFile=-/home/user/.config/sentropic/local-scheduler/env');
    expect(out.service).toContain('UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT');
    expect(out.service).toContain('ExecStart="/usr/bin/node" "/opt/h2a/bin.js" "archive" "_schedule-exec" "h2a-session-archive"');
    expect(out.timer).toContain('OnCalendar=daily');
    expect(out.timer).toContain('Persistent=true');
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
  });
});
