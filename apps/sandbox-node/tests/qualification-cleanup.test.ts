import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTicketKeyPair } from '../src/tickets.js';
import { qualifyDataPlane } from '../src/data-plane-qualification.js';
import { qualificationNode } from '../src/data-plane-qualification-node.js';
import { probeDataPlane } from '../src/data-plane-qualification-probes.js';
import { acquireNodeLock } from '../src/node-lock.js';
import { createAgentServer } from '../src/transport.js';
import { rmSync } from 'node:fs';
import { waitForQualificationPort } from '../src/qualification-runtime.js';

vi.mock('../src/node-lock.js', () => ({ acquireNodeLock: vi.fn() }));
vi.mock('../src/restart.js', () => ({ assertCleanStartup: vi.fn() }));
vi.mock('../src/qualification-leftovers.js', () => ({ assertNoQualificationLeftovers: vi.fn() }));
vi.mock('../src/qualification-storage.js', () => ({ createQualificationDirectory: () => '/var/lib/builder/qualification/qd-test' }));
vi.mock('../src/data-plane-qualification-node.js', () => ({ qualificationNode: vi.fn() }));
vi.mock('../src/data-plane-qualification-probes.js', () => ({ probeDataPlane: vi.fn() }));
vi.mock('../src/qualification-runtime.js', () => ({ waitForQualificationPort: vi.fn(), qualificationFailureInventory: vi.fn() }));
vi.mock('../src/qualification-certificates.js', () => ({ qualificationCertificates: () => ({}) }));
vi.mock('../src/transport.js', () => ({ createAgentServer: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: (_file: string, args: string[]) => args.includes('execution-node.service') ? 'inactive' : '/dev/loop7' }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(),
  existsSync: () => true, readFileSync: () => 'header\n', mkdtempSync: () => '/run/execution-node/qd-test', rmSync: vi.fn() }));

describe('real-host qualification finalization with fake runtime', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
  it.each(['prepare-failure', 'readiness-failure', 'readiness-SIGTERM', 'SIGTERM', 'cleanup-SIGTERM', 'deadline', 'early-exit', 'probe-failure', 'stuck-close', 'success'])('should close resources, remove private files and release flock on %s', async cause => {
    vi.stubEnv('QUALIFICATION_ONLY', 'isolated'); vi.stubEnv('QUALIFICATION_TIMEOUT_MS', '120000');
    vi.mocked(probeDataPlane).mockClear();
    vi.spyOn(process, 'getuid').mockReturnValue(0);
    const release = vi.fn(), close = vi.fn(async () => {}), lifecycle = vi.fn(async () => {});
    if (cause === 'cleanup-SIGTERM') close.mockImplementation(async () => { process.emit('SIGTERM'); });
    vi.mocked(acquireNodeLock).mockResolvedValue(release);
    vi.mocked(waitForQualificationPort).mockImplementation(async () => {
      if (cause === 'readiness-failure') throw new Error('5173 not listening');
      if (cause === 'readiness-SIGTERM') process.emit('SIGTERM');
    });
    const server = Object.assign(new EventEmitter(), { listen: (_path: string, done: () => void) => done(), close: (done: () => void) => { if (cause !== 'stuck-close') done(); } });
    vi.mocked(createAgentServer).mockReturnValue(server as never);
    const sandbox = { id: 'test', runtimeId: 'fake', state: cause === 'early-exit' ? 'stopped-output-retained' : 'running' };
    vi.mocked(qualificationNode).mockReturnValue({ keys: generateTicketKeyPair(), start: async () => {
      if (cause === 'prepare-failure') throw new Error('tenant volume capacity exhausted');
      return sandbox;
    },
      node: { adapter: { assertRunning() {} } }, close, lifecycle } as never);
    vi.mocked(probeDataPlane).mockImplementation(async () => {
      if (cause === 'SIGTERM') process.emit('SIGTERM');
      if (cause === 'probe-failure') throw new Error('probe failed');
      if (['success', 'stuck-close', 'cleanup-SIGTERM'].includes(cause)) return;
      await new Promise<void>(() => {});
    });
    if (cause === 'deadline' || cause === 'stuck-close') vi.useFakeTimers();
    const result = qualifyDataPlane();
    const assertion = cause === 'success' ? expect(result).resolves.toBeUndefined() : expect(result).rejects.toThrow('qualification failed');
    if (cause === 'deadline') await vi.advanceTimersByTimeAsync(120_000);
    if (cause === 'stuck-close') await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
    if (cause.startsWith('readiness-')) expect(probeDataPlane).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    expect(rmSync).toHaveBeenCalledWith('/run/execution-node/qd-test', { recursive: true, force: true });
    expect(rmSync).toHaveBeenCalledWith('/var/lib/builder/qualification/qd-test', { recursive: true, force: true });
    if (!['success', 'stuck-close', 'cleanup-SIGTERM'].includes(cause)) expect(lifecycle).not.toHaveBeenCalled();
  });
});
