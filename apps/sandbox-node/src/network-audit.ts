import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { privateNetworkPostStart } from './private-network.js';
import { ExecutionNodeError } from './errors.js';

export function auditNetworkSpec(args: string[], spec: Record<string, any>, ports: boolean): void {
  const forbidden = /^(--net-raw|--network-proxy-path|--reproduce-nat|--reproduce-nftables|--pcap-log|--allow-packet-socket-write|--allow-flag-override)(=|$)/;
  const fail = () => { throw new ExecutionNodeError('network_isolation_violation'); };
  if (args.some(arg => forbidden.test(arg) || (/^--EXPERIMENTAL-xdp(=|$)/.test(arg) && arg !== '--EXPERIMENTAL-xdp=off'))) fail();
  for (const flag of [`--network=${ports ? 'sandbox' : 'none'}`, '--platform=systrap', '--host-uds=none', '--host-fifo=none']) {
    if (!args.includes(flag) || args.filter(arg => arg.split('=')[0] === flag.split('=')[0]).length !== 1) fail();
  }
  if (Object.keys(spec.annotations ?? {}).some(key => key.startsWith('dev.gvisor.'))
    || !spec.process?.capabilities || ['bounding', 'effective', 'inheritable', 'permitted', 'ambient'].some(key =>
      !Array.isArray(spec.process.capabilities[key]) || spec.process.capabilities[key].length)
    || Object.keys(spec.process.capabilities).length !== 5
    || (spec.linux?.devices ?? []).some((device: { path?: string; major?: number }) =>
      !['/dev/null', '/dev/urandom'].includes(device.path ?? '') || device.major !== 1)
    || JSON.stringify(spec.linux?.namespaces?.filter((ns: { type: string }) => ns.type === 'network'))
      !== JSON.stringify([ports ? { type: 'network', path: '/proc/self/ns/net' } : { type: 'network' }])) fail();
}

/** Compare the sentry's actual namespace with the pre-exec receipt, then inspect it. */
export function auditStartedNetwork(pid: number, receipt: string, others: Iterable<string>): string {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new ExecutionNodeError('network_isolation_violation');
  const inode = String(statSync(`/proc/${pid}/ns/net`).ino);
  if (inode !== readFileSync(receipt, 'utf8').trim() || inode === String(statSync('/proc/1/ns/net').ino)
    || [...others].includes(inode)) throw new ExecutionNodeError('network_isolation_violation');
  execFileSync('nsenter', ['-t', String(pid), '-n', '--', 'sh', '-ec',
    privateNetworkPostStart], { timeout: 1000, killSignal: 'SIGKILL', stdio: 'pipe' });
  return inode;
}
