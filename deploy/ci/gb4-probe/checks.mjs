import { promises as fs, constants } from 'node:fs';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const writablePaths = ['/tmp', '/home/node/app/node_modules', '/home/node/app/.vite', '/home/node/.npm', '/dev/shm'];
const denied = new Set(['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EPERM']);
export function connect(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (code) => { socket.destroy(); resolve(code); };
    socket.setTimeout(timeout, () => finish('ETIMEDOUT'));
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', (error) => finish(error.code));
  });
}

export async function selfTest() {
  const rows = [];
  const row = (check, pass, evidence) => rows.push({ check, pass, evidence });
  row('non-root UID', process.getuid() !== 0, `uid=${process.getuid()}`);
  try {
    await fs.lstat('/var/run/secrets/kubernetes.io/serviceaccount/token');
    row('no SA token', false, 'token file exists');
  } catch (error) { row('no SA token', error.code === 'ENOENT', error.code); }
  const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map((line) => {
    const [left, right] = line.split(' - ');
    const fields = left.split(' ');
    return { path: fields[4].replace(/\\040/g, ' '), options: fields[5].split(','), type: right.split(' ')[0] };
  });
  let rootError = 'WRITABLE';
  try { await fs.writeFile('/gb4-readonly-check', 'probe', { flag: 'wx' }); await fs.unlink('/gb4-readonly-check'); }
  catch (error) { rootError = error.code; }
  row('root filesystem read-only', mounts.some((m) => m.path === '/' && m.options.includes('ro')) && rootError === 'EROFS', rootError);
  for (const path of writablePaths) {
    try {
      const file = `${path}/.gb4-${process.pid}`;
      await fs.writeFile(file, 'probe', { flag: 'wx' }); await fs.unlink(file);
      row(`emptyDir writable: ${path}`, mounts.some((m) => m.path === path && m.options.includes('rw')), 'write/delete succeeded');
    } catch (error) { row(`emptyDir writable: ${path}`, false, error.code); }
  }
  const unexpected = [];
  for (const mount of mounts) {
    if (writablePaths.includes(mount.path)) continue;
    // Device nodes and kernel pseudo filesystems are not application storage.
    if (['proc', 'sysfs', 'devpts', 'mqueue', 'cgroup2'].includes(mount.type)) continue;
    try {
      const stat = await fs.stat(mount.path);
      if (!(stat.isFile() || stat.isDirectory())) continue;
      await fs.access(mount.path, constants.W_OK);
      if (mount.options.includes('rw')) unexpected.push(mount.path);
    } catch { /* No writable storage at this mount. */ }
  }
  row('only emptyDir storage writable', unexpected.length === 0, JSON.stringify(unexpected));
  let kubeIPs = [];
  try {
    kubeIPs = (await lookup('kubernetes.default.svc.cluster.local', { all: true })).map((r) => r.address);
    row('DNS works', kubeIPs.length > 0, `kubernetes.default resolved: ${kubeIPs.join(',')}`);
  } catch (error) { row('DNS works', false, error.code); }
  const targets = [
    ['internet 1.1.1.1', '1.1.1.1', 443], ['internet 8.8.8.8', '8.8.8.8', 443],
    ['metadata', '169.254.169.254', 80],
    ...kubeIPs.map((ip) => ['kubernetes.default', ip, 443]),
    ...JSON.parse(process.env.GB4_CLUSTER_TARGETS || '[]'),
  ];
  if (!kubeIPs.length) row('kubernetes.default blocked', false, 'DNS prerequisite failed');
  if (!process.env.GB4_CLUSTER_TARGETS) row('other cluster services blocked', false, 'missing live service targets');
  await Promise.all(targets.map(async ([name, host, port]) => {
    const result = await connect(host, port);
    row(`${name} blocked`, denied.has(result), `${host}:${port} ${result}`);
  }));
  return rows;
}
