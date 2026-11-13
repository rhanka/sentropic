import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { privateNetworkScript } from './private-network.js';

/** Execute the dependency and netlink probe with the shipped unit's hardening. */
export function qualificationPrerequisites(release: string): void {
  const digest = basename(release);
  assert.match(digest, /^[a-f0-9]{64}$/, 'qualification requires digest-named verified release');
  const run = (file: string, args: string[]) => execFileSync(file, args,
    { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 16384 }).trim();
  const binary = run('sh', ['-ec', 'command -v runsc']);
  assert.ok(binary.startsWith('/'), 'absolute runsc path required');
  console.log(`RECEIPT archive_sha256=${digest} runsc_sha256=${createHash('sha256').update(readFileSync(binary)).digest('hex')}`);
  const unit = readFileSync(join(release, 'execution-node.service'), 'utf8');
  const properties = ['CapabilityBoundingSet', 'SystemCallFilter'].map(name => {
    const line = unit.split('\n').find(line => line.startsWith(`${name}=`));
    assert.ok(line, `missing unit hardening ${name}`);
    return `--property=${line}`;
  });
  try {
    run('systemd-run', ['--wait', '--pipe', '--collect', '--service-type=exec', ...properties,
      '--property=User=root', '--property=UMask=0077',
      'sh', '-ec', 'command -v ip >/dev/null; command -v unshare >/dev/null; command -v nsenter >/dev/null; command -v ss >/dev/null; command -v sh >/dev/null; exec unshare --net -- sh -ec "$1" probe /dev/null true',
      'prerequisites', privateNetworkScript]);
  } catch {
    throw new Error('hardening prerequisite failed: operator must provide iproute2 (ip), util-linux (unshare), and POSIX sh; check unit capabilities/syscalls');
  }
  console.log('PASS iproute2, util-linux, sh and private netns under unit hardening');
  // In-memory gate authorization only. k8s's on-disk production switch stays closed.
  process.env.EXECUTION_NODE_PORTS_RUNSC_SHA256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
}
