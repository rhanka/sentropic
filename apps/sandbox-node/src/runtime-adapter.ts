import { execFileSync, spawn } from 'node:child_process';
import { SandboxCgroup } from './cgroups.js';
import { prepareBundle, destroyBundle, type Bundle } from './bundle.js';
import { readOutput } from './output.js';
import { writeSource } from './source-write.js';
import { checkWritePath } from './mounts.js';
import { parseRunscList } from './runsc-inventory.js';
import { throwFilesystemError } from './filesystem-errors.js';
import type { ExecutionNodeDevScope } from './contract.js';
import { forwardSandboxPort } from './port-forward.js';

export interface SandboxMount {
  readonly source: string;
  readonly target: string;
  readonly readOnly: boolean;
}

export interface RunSandboxOptions {
  readonly diskQuotaMiB?: number;
  readonly quotaInodes?: number;
  readonly onExit?: (code: number | null) => void;
  readonly command?: readonly string[];
  readonly tenantId: string;
  readonly sandboxUid: string;
  readonly mounts: readonly SandboxMount[];
  readonly overlayUpper: string;
  readonly overlayWork: string;
  readonly quotaMiB: number;
  readonly uid: number;
  readonly gid: number;
}

export interface RuntimeAdapter {
  portTarget?(runtimeId: string, port: number): Promise<{ socketPath: string }>;
  writeFile(runtimeId: string, path: string, bytes: Buffer, scope: ExecutionNodeDevScope): Promise<void>;
  readonly kind: string;
  hasRunsc(): boolean;
  runSandbox(options: RunSandboxOptions): Promise<{ runtimeId: string }>;
  stopSandbox(runtimeId: string): Promise<boolean>;
  exportOutput(runtimeId: string, subPath: string, maxBytes?: number): Promise<Buffer>;
  destroySandbox(runtimeId: string): Promise<void>;
}

function failNoBinary(): never {
  throw new Error('runsc binary not available on this host');
}

/** In-memory fake: hermetic unit tests, no runsc, no mounts. */
export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'fake';
  private readonly live = new Set<string>();
  private readonly outputs = new Map<string, Buffer>();

  hasRunsc(): boolean {
    return false;
  }
  async writeFile(runtimeId: string, path: string, _bytes: Buffer, scope: ExecutionNodeDevScope): Promise<void> {
    if (!this.live.has(runtimeId)) throw new Error('sandbox not running');
    checkWritePath(path, scope);
  }

  async runSandbox(options: RunSandboxOptions): Promise<{ runtimeId: string }> {
    const runtimeId = `fake-${options.tenantId}-${options.sandboxUid}`;
    this.live.add(runtimeId);
    this.outputs.set(runtimeId, Buffer.from(`output:${runtimeId}`, 'utf8'));
    return { runtimeId };
  }

  async stopSandbox(runtimeId: string): Promise<boolean> {
    this.live.delete(runtimeId);
    return true;
  }

  async exportOutput(runtimeId: string, subPath: string): Promise<Buffer> {
    if (this.live.has(runtimeId)) throw new Error('sandbox still running');
    const output = this.outputs.get(runtimeId);
    if (!output) throw new Error(`unknown runtime ${runtimeId}`);
    return Buffer.concat([output, Buffer.from(`:${subPath}`, 'utf8')]);
  }

  async destroySandbox(runtimeId: string): Promise<void> {
    this.live.delete(runtimeId);
    this.outputs.delete(runtimeId);
  }

  isLive(runtimeId: string): boolean {
    return this.live.has(runtimeId);
  }
}

/**
 * Real gVisor adapter. Compiles everywhere; every method fails closed
 * where the `runsc` binary is absent — callers gate on `hasRunsc()`.
 */
export class RunscRuntimeAdapter implements RuntimeAdapter {
  private readonly forwards = new Map<string, Map<number, ReturnType<typeof forwardSandboxPort>>>();
  readonly kind = 'runsc-systrap';
  private readonly binary: string;
  private readonly rootArg = '--root=/run/execution-node/runsc';
  private readonly scopes = new Map<string, { scope: string; tenantId: string; uid: string; bundle: Bundle; stopped: boolean }>();

  constructor(binary = 'runsc', private readonly bundles = { prepare: prepareBundle, destroy: destroyBundle }) {
    this.binary = binary;
  }

  hasRunsc(): boolean {
    try {
      execFileSync(this.binary, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  async writeFile(runtimeId: string, path: string, bytes: Buffer, scope: ExecutionNodeDevScope): Promise<void> {
    const entry = this.scopes.get(runtimeId);
    if (!entry || entry.stopped) throw new Error('sandbox not running');
    writeSource(entry.bundle.workspace, path, bytes, scope);
  }

  async portTarget(runtimeId: string, port: number): Promise<{ socketPath: string }> {
    const entry = this.scopes.get(runtimeId);
    if (!entry || entry.stopped || port !== 5173) throw new Error('sandbox_port_unavailable');
    const ports = this.forwards.get(runtimeId) ?? new Map(); this.forwards.set(runtimeId, ports);
    let forward = ports.get(port);
    if (!forward) {
      forward = forwardSandboxPort(this.binary, this.rootArg, entry.uid, port, `${entry.bundle.path}/port-${port}.sock`);
      ports.set(port, forward);
    }
    try { return await forward.ready; } catch { ports.delete(port); throw new Error('sandbox_port_unavailable'); }
  }

  runscArgs(options: RunSandboxOptions): string[] {
    const args = [this.rootArg, '--network=none', '--platform=systrap', 'run', '--bundle', options.overlayUpper.replace(/\/upper$/, '')];
    args.push(`sandbox-${options.sandboxUid}`);
    return args;
  }

  async runSandbox(options: RunSandboxOptions): Promise<{ runtimeId: string }> {
    if (!this.hasRunsc()) failNoBinary();
    const bundle = this.bundles.prepare(options);
    const scope = `builder-sbx-${options.sandboxUid}.scope`;
    const runtimeId = `runsc-${options.tenantId}-${options.sandboxUid}`;
    this.scopes.set(runtimeId, { scope, tenantId: options.tenantId, uid: options.sandboxUid, bundle, stopped: false });
    // systemd-run uses PID 1's StartTransientUnit D-Bus method; Slice is explicit.
    const child = spawn('systemd-run', ['--scope', `--unit=${scope}`,
      `--slice=builder-tenant-${options.tenantId}.slice`,
      `--property=MemoryMax=${options.quotaMiB}M`, `--property=MemorySwapMax=${options.quotaMiB > 704 ? '256M' : '0'}`,
      `--property=MemoryHigh=${options.quotaMiB > 704 ? '1408M' : '704M'}`,
      `--property=MemoryLow=${options.quotaMiB > 704 ? '0' : '704M'}`,
      `--property=CPUWeight=${options.quotaMiB > 704 ? 100 : 200}`,
      '--property=OOMPolicy=kill', `--property=TasksMax=${options.quotaMiB > 704 ? 1024 : 512}`, this.binary, ...this.runscArgs(options)], { stdio: 'ignore' });
    let ready = false;
    try { await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      let timer: ReturnType<typeof setTimeout>;
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.once('error', fail);
      child.once('exit', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`sandbox launcher exited: ${code}`));
        if (ready || code === 0) options.onExit?.(code);
      });
      const poll = () => {
        try {
          const state = JSON.parse(execFileSync(this.binary, [this.rootArg, 'state', `sandbox-${options.sandboxUid}`], { encoding: 'utf8', timeout: 1000 }));
          if (state.status === 'running') { ready = true; resolve(); return; }
        } catch { /* The runtime may not have created its state yet. */ }
        if (Date.now() >= deadline) { fail(new Error('sandbox runtime readiness timeout')); return; }
        timer = setTimeout(poll, 25);
      };
      child.once('spawn', () => { timer = setTimeout(poll, 0); });
    }); } catch (error) {
      try { throwFilesystemError(error); }
      catch (mapped) { throw Object.assign(mapped as Error, { runtimeId }); }
    }
    return { runtimeId };
  }

  async stopSandbox(runtimeId: string): Promise<boolean> {
    if (!this.hasRunsc()) failNoBinary();
    const entry = this.scopes.get(runtimeId);
    if (!entry) throw new Error('unknown sandbox scope');
    if (entry.stopped) return true;
    try { entry.stopped = await new SandboxCgroup().stop(entry.scope, entry.tenantId); }
    catch (error) {
      if (!this.scopeQuiescent(entry.scope)) throw error;
      entry.stopped = true;
    }
    return entry.stopped;
  }

  private scopeQuiescent(scope: string): boolean {
    const group = execFileSync('systemctl', ['show', scope, '--property=ControlGroup', '--value'], { encoding: 'utf8', timeout: 1000 }).trim();
    const active = execFileSync('systemctl', ['show', scope, '--property=ActiveState', '--value'], { encoding: 'utf8', timeout: 1000 }).trim();
    return group === '' && ['inactive', 'failed'].includes(active);
  }

  async exportOutput(runtimeId: string, subPath: string, maxBytes?: number): Promise<Buffer> {
    if (!this.hasRunsc()) failNoBinary();
    const entry = this.scopes.get(runtimeId);
    if (!entry?.stopped) throw new Error('sandbox_not_quiesced');
    return readOutput(entry.bundle.output, subPath, maxBytes);
  }

  async destroySandbox(runtimeId: string): Promise<void> {
    if (!this.hasRunsc()) failNoBinary();
    if (!await this.stopSandbox(runtimeId)) throw new Error('sandbox_not_quiesced');
    for (const forward of this.forwards.get(runtimeId)?.values() ?? []) forward.stop();
    this.forwards.delete(runtimeId);
    const entry = this.scopes.get(runtimeId)!;
    const runtimes = parseRunscList(execFileSync(this.binary, [this.rootArg, 'list', '--format=json'], { encoding: 'utf8', timeout: 1000 }));
    if (runtimes.some(runtime => runtime.id === `sandbox-${entry.uid}`)) execFileSync(this.binary, [this.rootArg, 'delete', '--force', `sandbox-${entry.uid}`], { timeout: 5000 });
    try { execFileSync('systemctl', ['stop', entry.scope], { timeout: 5000 }); }
    catch (error) { if (!this.scopeQuiescent(entry.scope)) throw error; }
    this.bundles.destroy(entry.bundle);
    this.scopes.delete(runtimeId);
  }
}
