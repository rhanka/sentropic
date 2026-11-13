import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortsActivation } from '../src/ports-activation.js';
import { fileDigest } from '../src/file-digest.js';

describe('asynchronous production ports observation', () => {
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
