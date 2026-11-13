import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';
import { isIP } from 'node:net';

export type NetworkTarget = readonly [host: string, port: number];
export const hostListeners = () => execFileSync('ss', ['-H', '-ltnup'],
  { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' }).trim().split('\n').sort().join('\n');

export async function kernelNetworkWitness(uid: string, release: string) {
  const { pid } = JSON.parse(execFileSync('runsc', ['--root=/run/execution-node/runsc', 'state', `sandbox-${uid}`],
    { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' }));
  assert.ok(Number.isSafeInteger(pid) && pid > 1, 'missing sentry pid for kernel witness');
  const child = spawn('nsenter', ['-t', String(pid), '-n', '--', join(release, 'network-probe'), 'witness'],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve()); child.once('error', reject);
  });
  void exited.catch(() => {});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('kernel witness readiness deadline')), 1000);
      child.stdout.once('data', data => { clearTimeout(timer); assert.match(String(data), /^READY kernel/); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('kernel witness exited')); });
    });
  } catch (error) { child.kill('SIGKILL'); await exited; throw error; }
  return { async close() { child.kill('SIGKILL'); await exited; } };
}

export function qualificationHostAddresses(): string[] {
  const configured = process.env.QUAL_HOST_PUBLIC_IP;
  if (configured) { assert.ok(isIP(configured), 'QUAL_HOST_PUBLIC_IP must be an IP'); return [configured]; }
  const routes = JSON.parse(execFileSync('ip', ['-j', 'route', 'get', '1.1.1.1'],
    { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' }));
  const discovered = routes[0]?.prefsrc ?? routes[0]?.src;
  assert.ok(isIP(discovered), 'cannot discover host source IP from routing table');
  return [...new Set(['15.235.44.193', discovered])];
}

/** Positive controls on the HOST; binding failure invalidates the gate. */
export async function hostNetworkWitnesses() {
  const servers: Server[] = [];
  try {
    for (const host of ['127.0.0.1', '::1']) {
      const server = createServer(socket => socket.end('HOST-WITNESS'));
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject); server.listen({ host, port: 8443, ipv6Only: true }, resolve);
      });
    }
    return { close: () => Promise.all(servers.map(server => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())))) };
  } catch (error) { for (const server of servers) server.close(); throw error; }
}

export function networkTargets(hosts: string[], otherTenantHost: string): NetworkTarget[] {
  return [['1.1.1.1', 443], ['2606:4700:4700::1111', 443], ['169.254.169.254', 80],
    ['fd00:ec2::254', 80], ...hosts.flatMap(host => [[host, 22], [host, 8443]] as NetworkTarget[]),
    ['127.0.0.1', 8443], ['::1', 8443], ['127.0.0.1', 8444], ['::1', 8444], [otherTenantHost, 5173]];
}

/** Runs in the sandbox. Timeout is not evidence of TCP refusal. */
export function networkIsolationProbe(targets: NetworkTarget[]): string {
  return `const net=require('node:net'),os=require('node:os'),dns=require('node:dns'),cp=require('node:child_process');
const checks=[];function check(name,ok){checks.push({name,ok})}
function refused(host,port){return new Promise(resolve=>{
 const s=net.connect({host,port});s.once('connect',()=>{s.destroy();resolve(false)});
 s.once('error',e=>{s.destroy();resolve(['ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','EACCES','EPERM','EADDRNOTAVAIL'].includes(e.code))});
 s.setTimeout(500,()=>{s.destroy();resolve(false)});
})}
(async()=>{
 const names=Object.keys(os.networkInterfaces());check('only lo exists',names.length===1&&names[0]==='lo');
 for(const [host,port] of ${JSON.stringify(targets)})check('refused '+host+':'+port,await refused(host,port));
 for(const [host,port] of ${JSON.stringify([...targets, ['1.1.1.1', 53], ['2606:4700:4700::1111', 53]])}){
  let ok=false;try{cp.execFileSync('/usr/local/bin/network-probe',['udp',host,String(port)],{timeout:1000,stdio:'pipe'});ok=true}catch{}
  check('UDP refused '+host+':'+port,ok);
 }
 for(const result of JSON.parse(cp.execFileSync('/usr/local/bin/network-probe',['raw'],{timeout:1000,encoding:'utf8'})))check(result.name,result.ok);
 for(const server of ['1.1.1.1','2606:4700:4700::1111']){
  const r=new dns.Resolver({timeout:300,tries:1});r.setServers([server]);
  await new Promise(resolve=>r.resolve4('example.com',(e,addresses)=>{check('no DNS via '+server,!!e&&!addresses?.length);resolve()}));
 }
 const resolver=new dns.Resolver({timeout:300,tries:1});
 await new Promise(resolve=>resolver.resolve4('example.com',(e,addresses)=>{check('no default DNS',!!e&&!addresses?.length);resolve()}));
 process.stdout.write(JSON.stringify(checks));
})().catch(()=>process.exitCode=1);`;
}

export const tenantWitnessHost = (tenant: string) => tenant === 'sentropic' ? '127.77.0.2' : '127.77.0.3';
export const networkProbeCount = (targets: NetworkTarget[]) => targets.length * 2 + 8;
export function tenantWitnessScript(tenant: string): string {
  return `const n=require('node:net');for(const host of ['127.0.0.1','${tenantWitnessHost(tenant)}'])
    n.createServer(s=>s.end('${tenant}')).listen(5173,host);`;
}
