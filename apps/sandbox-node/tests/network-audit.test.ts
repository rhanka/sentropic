import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { auditNetworkSpec, auditStartedNetwork } from '../src/network-audit.js';
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), statSync: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const flags = ['--network=sandbox', '--platform=systrap', '--host-uds=none', '--host-fifo=none'];
const spec = () => ({ process: { capabilities: { bounding: [], effective: [], permitted: [], inheritable: [], ambient: [] } },
  linux: { devices: [], namespaces: [{ type: 'network', path: '/proc/self/ns/net' }] } });
describe('AMD-28 launch audits', () => {
  it('should require all capability sets and the exact network namespace in both modes', () => {
    const missing = spec(); delete (missing.process.capabilities as any).ambient;
    expect(() => auditNetworkSpec(flags, missing, true)).toThrow();
    const noneFlags = flags.map(flag => flag === '--network=sandbox' ? '--network=none' : flag);
    expect(() => auditNetworkSpec(noneFlags, spec(), false)).toThrow();
    const none = spec(); none.linux.namespaces = [{ type: 'network' }] as never;
    expect(() => auditNetworkSpec(noneFlags, none, false)).not.toThrow();
    none.linux.namespaces.push({ type: 'network' } as never);
    expect(() => auditNetworkSpec(noneFlags, none, false)).toThrow();
  });
  it.each(['--net-raw', '--network-proxy-path=/tmp/proxy', '--EXPERIMENTAL-xdp=on', '--reproduce-nat',
    '--reproduce-nftables', '--pcap-log=/tmp/capture', '--allow-packet-socket-write', '--allow-flag-override',
    '--host-uds=all', '--host-fifo=open', '--network=host'])('should reject dangerous runsc flag %s', flag => {
    expect(() => auditNetworkSpec([...flags, flag], spec(), true)).toThrow('network_isolation_violation');
  });
  it('should require explicit host UDS/FIFO denial and reject privileged OCI inputs', () => {
    for (const omit of flags) expect(() => auditNetworkSpec(flags.filter(flag => flag !== omit), spec(), true)).toThrow();
    expect(() => auditNetworkSpec([...flags, '--EXPERIMENTAL-xdp=off'], spec(), true)).not.toThrow();
    expect(() => auditNetworkSpec(flags, { ...spec(), annotations: { 'dev.gvisor.flag': 'true' } }, true)).toThrow();
    const capable = spec(); capable.process.capabilities.bounding = ['CAP_NET_RAW'] as never;
    expect(() => auditNetworkSpec(flags, capable, true)).toThrow();
    const device = spec(); device.linux.devices = [{ path: '/dev/net/tun', major: 10 }] as never;
    expect(() => auditNetworkSpec(flags, device, true)).toThrow();
  });
  it.each(['clean', 'host', 'peer', 'receipt', 'listener', 'missing-pid'])('should compare actual sentry namespace and reject unsafe state (%s)', mode => {
    vi.mocked(statSync).mockImplementation(path => ({ ino: String(path).includes('/1/') ? 1 : mode === 'host' ? 1 : 2 }) as never);
    vi.mocked(readFileSync).mockReturnValue(mode === 'receipt' ? '3' : '2');
    vi.mocked(execFileSync).mockImplementation(() => { if (mode === 'listener') throw new Error('listener detected'); return ''; });
    const audit = () => auditStartedNetwork(mode === 'missing-pid' ? undefined as never : 42, '/receipt', mode === 'peer' ? ['2'] : []);
    if (mode === 'clean') {
      expect(audit()).toBe('2');
      expect(execFileSync).toHaveBeenCalledWith('nsenter', expect.arrayContaining(['-t', '42', '-n']), expect.objectContaining({ timeout: 1000 }));
    } else expect(audit).toThrow();
  });
});
