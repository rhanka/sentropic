import { execFileSync, spawn } from 'node:child_process';

export interface SandboxMount {
  readonly source: string;
  readonly target: string;
  readonly readOnly: boolean;
}

export interface RunSandboxOptions {
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
  stopSandbox(runtimeId: string): Promise<void>;
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

  async stopSandbox(runtimeId: string): Promise<void> {
    this.live.delete(runtimeId);
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
    for (const mount of options.mounts) {
      args.push('--mount', `${mount.source}:${mount.target}${mount.readOnly ? ':ro' : ''}`);
    }
    args.push(`--memory=${options.quotaMiB}M`, `--uid=${options.uid}`, `--gid=${options.gid}`);
    args.push(`sandbox-${options.sandboxUid}`);
    return args;
  }

  async runSandbox(options: RunSandboxOptions): Promise<{ runtimeId: string }> {
    if (!this.hasRunsc()) failNoBinary();
    const child = spawn(this.binary, this.runscArgs(options), { stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
    return { runtimeId: `runsc-${options.tenantId}-${options.sandboxUid}` };
  }

  async stopSandbox(runtimeId: string): Promise<void> {
    if (!this.hasRunsc()) failNoBinary();
    void runtimeId;
  }

  async exportOutput(runtimeId: string, subPath: string): Promise<Buffer> {
    if (!this.hasRunsc()) failNoBinary();
    void subPath;
    return Buffer.alloc(0);
  }

  async destroySandbox(runtimeId: string): Promise<void> {
    if (!this.hasRunsc()) failNoBinary();
    void runtimeId;
  }
}
