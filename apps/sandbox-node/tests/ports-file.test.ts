import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileDigest } from '../src/file-digest.js';
import { portsEnabled, useK8sPortsSwitch } from '../src/network-policy.js';

describe('k8s-owned ports switch', () => {
  it('should observe atomic config replacement and actual binary replacement without restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'ports-switch-')), config = join(root, 'agent.env'), binary = join(root, 'runsc');
    useK8sPortsSwitch(config);
    try {
      expect(portsEnabled(binary)).toBe(false);
      writeFileSync(binary, 'qualified');
      const digest = fileDigest(binary);
      writeFileSync(config, `EXECUTION_NODE_PORTS_ENABLED=true\nEXECUTION_NODE_PORTS_RUNSC_SHA256=${digest}\n`);
      expect(portsEnabled(binary)).toBe(true);
      writeFileSync(join(root, 'next'), 'EXECUTION_NODE_PORTS_ENABLED=false\n'); renameSync(join(root, 'next'), config);
      expect(portsEnabled(binary)).toBe(false);
      writeFileSync(config, `EXECUTION_NODE_PORTS_ENABLED=true\nEXECUTION_NODE_PORTS_RUNSC_SHA256=${digest}\n`);
      writeFileSync(join(root, 'replacement'), 'upgraded'); renameSync(join(root, 'replacement'), binary);
      expect(portsEnabled(binary)).toBe(false);
    } finally { rmSync(root, { recursive: true }); }
  });
});
