import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { once } from 'node:events';

const binary = '/release/network-probe';
const raw = spawnSync(binary, ['raw'], { encoding: 'utf8', timeout: 1000 });
assert.equal(raw.status, 0);
const results = JSON.parse(raw.stdout);
assert.equal(results.length, 2); assert.ok(results.every(result => result.ok));
for (const host of ['127.0.0.1', '::1']) {
  assert.equal(spawnSync(binary, ['udp', host, '9'], { timeout: 1000 }).status, 0);
  assert.equal(spawnSync(binary, ['udp-egress', host, '9'], { timeout: 1000 }).status, 1,
    'a reachable closed UDP port must not pass an egress-isolation probe');
}
const witness = spawn(binary, ['witness'], { stdio: ['ignore', 'pipe', 'inherit'] });
const exit = once(witness, 'exit');
try {
  const timer = setTimeout(() => witness.kill('SIGKILL'), 1000);
  try {
    const [ready] = await Promise.race([once(witness.stdout, 'data'), exit.then(() => { throw new Error('witness exited before ready'); })]);
    assert.match(String(ready), /^READY kernel/);
  }
  finally { clearTimeout(timer); }
  for (const host of ['127.0.0.1', '::1']) {
    const tcp = connect({ host, port: 8444 });
    try { await once(tcp, 'connect'); } finally { tcp.destroy(); }
    // A positive UDP listener receives the datagram: timeout must never count as refusal.
    assert.equal(spawnSync(binary, ['udp', host, '8444'], { timeout: 1000 }).status, 1);
  }
} finally { witness.kill('SIGKILL'); await exit; }
console.log('PASS native raw/packet denial and IPv4/IPv6 TCP/UDP witness controls');
