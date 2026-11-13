import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateNetworkScript, privateNetworkPostStart } from '../src/private-network.js';

describe('private namespace launch fence', () => {
  it.each(['clean', 'main-v6', 'interface', 'down', 'route4', 'route6', 'ip-failed', 'address', 'host-netns', 'ss-failed', 'listener', 'post-clean'])('should abort before runsc for invalid inventory (%s)', mode => {
    const directory = mkdtempSync(join(tmpdir(), 'netns-fence-'));
    const links = mode === 'down' ? '1: lo: <LOOPBACK> mtu 65536' : '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536';
    writeFileSync(join(directory, 'stat'), `#!/bin/sh\ncase "$*" in *self*) echo ${mode === 'host-netns' ? 1 : 2};; *) echo 1;; esac`, { mode: 0o700 });
    writeFileSync(join(directory, 'ss'), `#!/bin/sh\n${mode === 'listener' ? 'echo LISTENER' : ':'}\nexit ${mode === 'ss-failed' ? 1 : 0}`, { mode: 0o700 });
    writeFileSync(join(directory, 'ip'), `#!/bin/sh
case "$*" in
 'link set lo up') exit ${mode === 'ip-failed' ? 1 : 0};;
 '-o link show') echo '${links}'; ${mode === 'interface' ? "echo '2: eth0: <UP> mtu 1500'" : ':'};;
 '-o addr show') echo '1: lo inet 127.0.0.1/8'; echo '1: lo inet6 ::1/128'; ${mode === 'address' ? "echo '1: lo inet 10.0.0.1/8'" : ':'};;
 '-o -4 route show table all') echo '${mode === 'route4' ? 'default via 192.0.2.1 dev lo' : 'local 127.0.0.1 dev lo table local'}';;
 '-o -6 route show table all') echo '${mode === 'route6' ? '2001:db8::/32 dev lo' : mode === 'main-v6' ? '::1 dev lo' : 'local ::1 dev lo table local'}';;
 *) exit 2;;
esac`, { mode: 0o700 });
    const post = ['ss-failed', 'listener', 'post-clean'].includes(mode);
    const launch = () => execFileSync('sh', ['-ec', post ? privateNetworkPostStart + '\nexec "$@"' : privateNetworkScript,
      'sandbox-network', ...(post ? [] : [join(directory, 'receipt')]), 'sh', '-c', 'echo RUNSC'],
      { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1000 });
    try {
      if (['clean', 'main-v6', 'post-clean'].includes(mode)) expect(launch()).toBe('RUNSC\n');
      else expect(launch).toThrow();
    } finally { rmSync(directory, { recursive: true }); }
  });
});
