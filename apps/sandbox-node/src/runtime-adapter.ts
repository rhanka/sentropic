import { execFileSync, spawn } from 'node:child_process';
import { SandboxCgroup } from './cgroups.js';

export interface SandboxMount {
  readonly source: string;
  readonly target: string;
  readonly readOnly: boolean;
}

export interface RunSandboxOptions {
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
  readonly kind: string;
  hasRunsc(): boolean;
  runSandbox(options: RunSandboxOptions): Promise<{ runtimeId: string }>;
  stopSandbox(runtimeId: string): Promise<boolean>;
  exportOutput(runtimeId: string, subPath: string): Promise<Buffer>;
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
  readonly kind = 'runsc-systrap';
  private readonly binary: string;
  private readonly scopes = new Map<string, { scope: string; tenantId: string }>();

  constructor(binary = 'runsc') {
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

  runscArgs(options: RunSandboxOptions): string[] {
    const args = ['--network=none', '--platform=systrap', 'run', '--bundle', options.overlayUpper];
    args.push(`sandbox-${options.sandboxUid}`);
    return args;
  }

  async runSandbox(options: RunSandboxOptions): Promise<{ runtimeId: string }> {
    if (!this.hasRunsc()) failNoBinary();
    const scope = `builder-sbx-${options.sandboxUid}.scope`;
    const child = spawn('systemd-run', ['--scope', `--unit=${scope}`,
      `--slice=builder-tenant-${options.tenantId}.slice`,
      `--property=MemoryMax=${options.quotaMiB}M`, '--property=MemorySwapMax=0',
      '--property=MemoryOOMGroup=yes', this.binary, ...this.runscArgs(options)], { stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      let timer: ReturnType<typeof setTimeout>;
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`sandbox launcher exited: ${code}`)));
      const poll = () => {
        try {
          const state = JSON.parse(execFileSync(this.binary, ['state', `sandbox-${options.sandboxUid}`], { encoding: 'utf8', timeout: 1000 }));
          if (state.status === 'running') { resolve(); return; }
        } catch { /* The runtime may not have created its state yet. */ }
        if (Date.now() >= deadline) { fail(new Error('sandbox runtime readiness timeout')); return; }
        timer = setTimeout(poll, 25);
      };
      child.once('spawn', () => { timer = setTimeout(poll, 0); });
    });
    const runtimeId = `runsc-${options.tenantId}-${options.sandboxUid}`;
    this.scopes.set(runtimeId, { scope, tenantId: options.tenantId });
    return { runtimeId };
  }

  async stopSandbox(runtimeId: string): Promise<boolean> {
    if (!this.hasRunsc()) failNoBinary();
    const entry = this.scopes.get(runtimeId);
    if (!entry) throw new Error('unknown sandbox scope');
    return new SandboxCgroup().stop(entry.scope, entry.tenantId);
  }

  async exportOutput(runtimeId: string, subPath: string): Promise<Buffer> {
    if (!this.hasRunsc()) failNoBinary();
    void subPath;
    throw new Error('read-only artifact reader is not installed; export fails closed');
  }

  async destroySandbox(runtimeId: string): Promise<void> {
    if (!this.hasRunsc()) failNoBinary();
    if (!await this.stopSandbox(runtimeId)) throw new Error('sandbox_not_quiesced');
    this.scopes.delete(runtimeId);
  }
}
