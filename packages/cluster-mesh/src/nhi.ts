export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunnerPort {
  run(command: 'h2a', args: readonly string[]): Promise<CommandResult>;
}

export interface NhiLifecyclePort {
  attest(input: { instance: string; privateKey: string; root?: string }): Promise<CommandResult>;
  offboard(input: { instance: string; root?: string }): Promise<CommandResult>;
  exportBundle(input: {
    instance: string;
    trustDomain: string;
    root?: string;
  }): Promise<CommandResult>;
}

function withRoot(args: string[], root?: string): readonly string[] {
  return root ? [...args, '--root', root] : args;
}

/** Exact local mapping to the shipped h2a NHI lifecycle; h2a remains the authority. */
export function createH2aNhiLifecycle(runner: CommandRunnerPort): NhiLifecyclePort {
  return {
    attest(input) {
      return runner.run('h2a', withRoot([
        'nhi', 'attest', '--instance', input.instance, '--private-key', input.privateKey,
      ], input.root));
    },
    offboard(input) {
      return runner.run('h2a', withRoot([
        'nhi', 'offboard', '--instance', input.instance,
      ], input.root));
    },
    exportBundle(input) {
      return runner.run('h2a', withRoot([
        'nhi', 'export', '--instance', input.instance, '--trust-domain', input.trustDomain,
      ], input.root));
    },
  };
}
