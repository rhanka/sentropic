import { InvalidNhiArgumentError } from './errors.js';

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunnerPort {
  run(command: 'h2a', args: readonly string[]): Promise<CommandResult>;
}

export interface NhiLifecyclePort {
  attest(input: { instance: string; privateKey: string; root?: string; role?: string; scope?: string }): Promise<CommandResult>;
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

function requireArgument(argument: 'instance' | 'role' | 'scope', value: string) {
  if (typeof value !== 'string' || !value.trim() || value.trimStart().startsWith('-')) {
    throw new InvalidNhiArgumentError(argument);
  }
}

/** Exact local mapping to the shipped h2a NHI lifecycle; h2a remains the authority. */
export function createH2aNhiLifecycle(runner: CommandRunnerPort): NhiLifecyclePort {
  return {
    async attest(input) {
      requireArgument('instance', input.instance);
      if (input.role !== undefined) requireArgument('role', input.role);
      if (input.scope !== undefined) requireArgument('scope', input.scope);
      return runner.run('h2a', withRoot([
        'nhi', 'attest', '--instance', input.instance, '--private-key', input.privateKey,
        ...(input.role !== undefined ? ['--role', input.role] : []),
        ...(input.scope !== undefined ? ['--scope', input.scope] : []),
      ], input.root));
    },
    async offboard(input) {
      requireArgument('instance', input.instance);
      return runner.run('h2a', withRoot([
        'nhi', 'offboard', '--instance', input.instance,
      ], input.root));
    },
    async exportBundle(input) {
      requireArgument('instance', input.instance);
      return runner.run('h2a', withRoot([
        'nhi', 'export', '--instance', input.instance, '--trust-domain', input.trustDomain,
      ], input.root));
    },
  };
}
