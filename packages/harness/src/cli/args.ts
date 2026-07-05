// Shared, pure argv helpers for the harness CLI driver.

export type FlagValue = string | boolean;

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, FlagValue>;
}

/** Split argv into positionals and `--key [value]` flags (a bare `--key` is boolean true). */
export function parseFlags(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

export function str(v: FlagValue | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function list(v: FlagValue | undefined): string[] {
  const s = str(v);
  return s ? s.split(/[\s,]+/).filter(Boolean) : [];
}
