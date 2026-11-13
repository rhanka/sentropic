/** Executed by the release rootfs's Node inside runsc, never on the host. */
export function isolationProbe(paths: readonly { path: string; directory: boolean }[]): string {
  return `
const fs = require('node:fs'), net = require('node:net'), os = require('node:os');
const checks = [];
function check(name, ok) { checks.push({ name, ok }); }
for (const {path, directory} of ${JSON.stringify(paths)}) {
  let denied = false;
  try { if (directory) fs.readdirSync(path); else fs.readFileSync(path); }
  catch (e) { denied = ['ENOENT', 'EACCES', 'ENOTDIR'].includes(e.code); }
  check('zero read ' + path, denied);
  denied = false;
  try {
    const fd = fs.openSync(directory ? path + '/isolation-write' : path, 'r+');
    fs.closeSync(fd);
  } catch (e) { denied = ['ENOENT', 'EACCES', 'ENOTDIR'].includes(e.code); }
  check('zero write ' + path, denied);
}
for (const path of ['/workspace/isolation-marker', '/workspace/node_modules/isolation-marker']) {
  check('own base readable ' + path, fs.readFileSync(path, 'utf8') === 'isolation fixture');
  let readonly = false;
  try { fs.writeFileSync(path, 'forbidden'); } catch (e) { readonly = e.code === 'EROFS' || e.errno === -30; }
  check('own base read-only ' + path, readonly);
}
check('network interfaces loopback only', Object.keys(os.networkInterfaces()).every(name => name === 'lo'));
async function unreachable(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({host, port});
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(true); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}
(async () => {
  for (const [host, port] of [['1.1.1.1',443], ['169.254.169.254',80], ['127.0.0.1',8443], ['::1',8443]]) {
    check('network none ' + host + ':' + port, await unreachable(host, port));
  }
  process.stdout.write(JSON.stringify(checks));
})().catch(() => process.exitCode = 1);
`;
}

export function requireIsolationResults(text: string, report: (name: string, ok: boolean) => void): void {
  const checks: unknown = JSON.parse(text);
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('missing isolation probe results');
  for (const check of checks) {
    if (!check || typeof check.name !== 'string' || typeof check.ok !== 'boolean') throw new Error('invalid isolation probe result');
    report(check.name, check.ok);
  }
}
