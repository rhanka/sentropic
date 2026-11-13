import { ExecutionNodeError } from './errors.js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let settings = () => process.env;
let cached: { path: string; identity: string; digest: string } | undefined;
export function runscDigest(binary = process.env.EXECUTION_NODE_RUNSC ?? 'runsc'): string {
  const path = binary.includes('/') ? binary : execFileSync('sh', ['-ec', 'command -v runsc'],
    { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' }).trim();
  const s = statSync(path, { bigint: true });
  const identity = `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  if (cached?.path !== path || cached.identity !== identity) {
    cached = { path, identity, digest: createHash('sha256').update(readFileSync(path)).digest('hex') };
  }
  return cached.digest;
}

/** Production reads k8s's root-owned file on every check, including atomic replacement. */
export function useK8sPortsSwitch(path = '/etc/execution-node/agent.env'): void {
  settings = () => Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .filter(line => /^EXECUTION_NODE_PORTS_(ENABLED|RUNSC_SHA256)=/.test(line))
    .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim()]; }));
}

export function portsEnabled(binary?: string): boolean {
  try {
    const config = settings();
    return config.EXECUTION_NODE_PORTS_ENABLED === 'true'
      && /^[a-f0-9]{64}$/.test(config.EXECUTION_NODE_PORTS_RUNSC_SHA256 ?? '')
      && config.EXECUTION_NODE_PORTS_RUNSC_SHA256 === runscDigest(binary);
  } catch { return false; }
}

/** Closed by default; only the qualified binary may expose live/standby ports. */
export function requireNetworkPolicy(network: unknown, profile?: string, binary?: string): void {
  if (network !== undefined && network !== 'none' && network !== 'ports') {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'network must be none or ports');
  }
  if (network === 'ports' && !portsEnabled(binary)) {
    throw new ExecutionNodeError('ports_disabled');
  }
  if (network === 'ports' && !['live', 'standby'].includes(profile ?? '')) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'ports requires live or standby profile');
  }
}
