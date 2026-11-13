import { execFileSync, spawn } from 'node:child_process';
import { boundedRuntimeOutput, type RuntimeDiagnostic } from './qualification-diagnostics.js';

export const qualificationReadyScript = `const n=require('net'),end=Date.now()+4500;
if(Object.keys(require('os').networkInterfaces()).some(name=>name!=='lo'))process.exit(2);
function probe(){const s=n.connect(5173,'127.0.0.1');s.setTimeout(200,()=>s.destroy());
s.once('connect',()=>{s.destroy();console.log('5173 accepted');process.exit(0)});
s.once('close',()=>{if(Date.now()>=end)process.exit(1);else setTimeout(probe,25)});
s.on('error',()=>{});}probe();`;

/** A real TCP accept inside the sandbox, before any mTLS/data-plane probe. */
export async function waitForQualificationPort(uid: string, signal: AbortSignal, diagnostic: RuntimeDiagnostic) {
  signal.throwIfAborted();
  diagnostic('5173 readiness', 'waiting inside sandbox (5000 ms bound)');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('runsc', ['--root=/run/execution-node/runsc', 'exec', `sandbox-${uid}`,
      '/usr/local/bin/node', '-e', qualificationReadyScript], { stdio: ['ignore', 'pipe', 'pipe'] });
    const abort = () => { done(); child.kill('SIGKILL'); reject(signal.reason); };
    const timer = setTimeout(() => { done(); child.kill('SIGKILL'); reject(new Error('5173 readiness deadline exceeded')); }, 5000);
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    boundedRuntimeOutput(child.stdout, '5173 readiness stdout', diagnostic);
    boundedRuntimeOutput(child.stderr, '5173 readiness stderr', diagnostic);
    child.once('error', error => { done(); reject(error); });
    child.once('exit', (code, killed) => {
      done(); diagnostic('5173 readiness exit', `code=${code} signal=${killed ?? 'none'}`);
      if (code === 0) resolve(); else reject(new Error('5173 readiness failed'));
    });
    if (signal.aborted) abort();
  });
}

/** Select only safe inventory fields; do not dump OCI process env or argv. */
export function qualificationFailureInventory(uid: string, diagnostic: RuntimeDiagnostic) {
  try {
    const state = JSON.parse(execFileSync('runsc', ['--root=/run/execution-node/runsc', 'state', `sandbox-${uid}`],
      { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 16384, stdio: ['ignore', 'pipe', 'pipe'] }));
    diagnostic('runsc state at failure', JSON.stringify({ id: state.id, status: state.status, pid: state.pid }));
  } catch { diagnostic('runsc state at failure', 'unavailable or already collected'); }
  try {
    const scope = execFileSync('systemctl', ['show', `builder-sbx-${uid}.scope`,
      '--property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus'],
    { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] });
    diagnostic('scope stop reason', scope.trim().replace(/\n/g, ' '));
  } catch { diagnostic('scope stop reason', 'unavailable or already collected'); }
}
