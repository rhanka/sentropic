import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Set by packaging.mk; packaging specs are skipped in the ordinary package test run. */
export const ROOT = process.env.CLUSTER_MESH_PACKAGING_DIR ?? '';
export const enabled = ROOT !== '';

export const fixtureDir = (name: string): string => join(ROOT, name);

let counter = 0;

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Execute an ES module natively (no Vitest resolution) inside a fixture tree. */
export function runNode(dir: string, source: string, file?: string): Run {
  counter += 1;
  const path = join(dir, file ?? `probe-${counter}.mjs`);
  writeFileSync(path, source);
  const result = spawnSync(process.execPath, [path], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Run a script that prints one JSON line and parse it. */
export function nodeJson<T = Record<string, unknown>>(dir: string, source: string): T {
  const run = runNode(dir, source);
  if (run.status !== 0) throw new Error(`node exited ${run.status}: ${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').pop()!) as T;
}

export interface TscCase {
  readonly module: 'NodeNext' | 'Bundler';
  readonly skipLibCheck: boolean;
}

export const TSC_CASES: readonly TscCase[] = [
  { module: 'NodeNext', skipLibCheck: false },
  { module: 'NodeNext', skipLibCheck: true },
  { module: 'Bundler', skipLibCheck: false },
  { module: 'Bundler', skipLibCheck: true },
];

/** Type-check a consumer source file inside a fixture tree with the given resolution flags. */
export function tsc(dir: string, name: string, source: string, options: TscCase): Run {
  const projectDir = join(dir, `tsc-${name}-${options.module}-${options.skipLibCheck}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'consumer.ts'), source);
  writeFileSync(join(projectDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: options.module === 'NodeNext' ? 'NodeNext' : 'ESNext',
      moduleResolution: options.module,
      strict: true,
      noEmit: true,
      skipLibCheck: options.skipLibCheck,
      types: ['node'],
      typeRoots: [join(ROOT, 'tools/node_modules/@types')],
    },
    files: ['consumer.ts'],
  }));
  const result = spawnSync(join(ROOT, 'tools/node_modules/.bin/tsc'), ['-p', projectDir], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function esbuild(dir: string, entry: string, outfile: string, externals: readonly string[]): Run {
  const args = [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${outfile}`,
    ...externals.map((name) => `--external:${name}`)];
  const result = spawnSync(join(ROOT, 'tools/node_modules/.bin/esbuild'), args, { cwd: dir, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Copy a prepared fixture so a negative case can mutate its tree. */
export function cloneFixture(from: string, to: string): string {
  const target = fixtureDir(to);
  cpSync(fixtureDir(from), target, { recursive: true, verbatimSymlinks: true });
  return target;
}

export const read = (path: string): string => readFileSync(path, 'utf8');
