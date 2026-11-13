import { describe, expect, it, vi } from 'vitest';
import * as io from 'node:fs/promises';
import { monitorPorts } from '../src/ports-monitor.js';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortsActivation } from '../src/ports-activation.js';
import { fileDigest } from '../src/file-digest.js';

vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof io>();
  return { ...fs, readFile: vi.fn(fs.readFile), stat: vi.fn(fs.stat) };
});

describe('asynchronous production ports observation', () => {
  it.each(['readFile', 'stat'] as const)('should cut an open stream when %s observation hangs and reject its late result', async method => {
    const root = mkdtempSync(join(tmpdir(), 'stale-ports-')), binary = join(root, 'runsc'), config = join(root, 'agent.env');
    writeFileSync(binary, 'qualified');
    writeFileSync(config, `EXECUTION_NODE_PORTS_ENABLED=true\nEXECUTION_NODE_PORTS_RUNSC_SHA256=${fileDigest(binary)}\n`);
    const activation = new PortsActivation(config, binary);
    let release!: () => void;
    let closeMonitor = () => {};
    try {
      await vi.waitFor(() => expect(activation.enabled).toBe(true));
      const original = io[method];
      const spy = vi.spyOn(io, method).mockImplementationOnce((...args: any[]) =>
        new Promise(resolve => { release = () => resolve((original as any)(...args)); }) as never);
      const pending = activation.refresh();
      const cut = vi.fn();
      closeMonitor = monitorPorts(() => activation.enabled, cut, async () => {});
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      await new Promise(resolve => setTimeout(resolve, 210));
      expect(activation.enabled).toBe(false); expect(cut).toHaveBeenCalled();
      release(); await pending;
      expect(activation.enabled).toBe(false);
      spy.mockRestore();
    } finally { closeMonitor(); activation.close(); vi.restoreAllMocks(); rmSync(root, { recursive: true }); }
  });
  it('should close for config replacement, binary replacement and duplicate settings without blocking stream timers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'async-ports-')), binary = join(root, 'runsc'), config = join(root, 'agent.env');
    writeFileSync(binary, 'qualified');
    const open = `EXECUTION_NODE_PORTS_ENABLED=true\nEXECUTION_NODE_PORTS_RUNSC_SHA256=${fileDigest(binary)}\n`;
    writeFileSync(config, open);
    const activation = new PortsActivation(config, binary);
    const wait = async (enabled: boolean) => {
      const deadline = Date.now() + 1000;
      while (activation.enabled !== enabled) {
        expect(Date.now()).toBeLessThan(deadline); await new Promise(resolve => setTimeout(resolve, 5));
      }
    };
    try {
      await wait(true);
      writeFileSync(join(root, 'replacement'), 'EXECUTION_NODE_PORTS_ENABLED=false\n'); renameSync(join(root, 'replacement'), config);
      const closedAt = Date.now(); await wait(false); expect(Date.now() - closedAt).toBeLessThan(250);
      writeFileSync(config, open); await wait(true);
      writeFileSync(join(root, 'new-binary'), 'different'); renameSync(join(root, 'new-binary'), binary);
      const changedAt = Date.now(); await wait(false); expect(Date.now() - changedAt).toBeLessThan(250);
      writeFileSync(binary, 'qualified'); writeFileSync(config, open); await wait(true);
      writeFileSync(config, open + 'EXECUTION_NODE_PORTS_ENABLED=false\n'); await wait(false);
      activation.close(); writeFileSync(config, open); await activation.refresh(); expect(activation.enabled).toBe(false);
    } finally { activation.close(); rmSync(root, { recursive: true }); }
  });
});
