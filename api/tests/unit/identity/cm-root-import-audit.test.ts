import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * a4-cm-gaps-r2 §2.2 root-import audit, as an executable gate.
 *
 * Method (design §2.2): extract every named import from the exact root
 * specifier `@sentropic/cluster-mesh` across `api/**`, `ui/**`, `e2e/**`,
 * and diff them against the export set reachable from the cluster-mesh root
 * barrel (`packages/cluster-mesh/src/index.ts`). The auth-hono family must
 * be imported from the `@sentropic/cluster-mesh/identity/auth-hono` subpath
 * so the root entry never references the optional peer `@sentropic/auth-hono`.
 */

const repoRoot = resolve(process.cwd(), '..');
const cmSrc = join(repoRoot, 'packages/cluster-mesh/src');
const scanRoots = ['api/src', 'api/tests', 'ui/src', 'ui/tests', 'e2e/tests']
  .map((rel) => join(repoRoot, rel))
  .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory());

const SOURCE_FILE = /\.(ts|mts|svelte)$/;

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'fixtures') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSources(path, out);
    else if (SOURCE_FILE.test(entry.name)) out.push(path);
  }
  return out;
}

function resolveModule(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier.replace(/\.js$/, ''));
  for (const candidate of [base, `${base}.ts`, `${base}.d.ts`, join(base, 'index.ts')]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return undefined;
}

/** Names exported by the cluster-mesh root barrel, following `export *` chains. */
function rootReachableExports(entry = join(cmSrc, 'index.ts'), seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(entry, 'utf8');
  const names = new Set<string>();
  const star = /export\s+\*\s+(?:as\s+(\w+)\s+)?from\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = star.exec(source))) {
    if (match[1]) names.add(match[1]);
    const target = resolveModule(entry, match[2]);
    if (target) for (const name of rootReachableExports(target, seen)) names.add(name);
  }
  const named = /export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*'([^']+)')?/g;
  while ((match = named.exec(source))) {
    for (const part of match[1].split(',')) {
      const cleaned = part.trim().replace(/^type\s+/, '');
      if (!cleaned) continue;
      const alias = cleaned.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  }
  const declarations = /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g;
  while ((match = declarations.exec(source))) names.add(match[1]);
  if (/export\s+default/.test(source)) names.add('default');
  return names;
}

interface Miss {
  file: string;
  names: string[];
}

function audit(): Miss[] {
  const reachable = rootReachableExports();
  const misses: Miss[] = [];
  const importRe = /(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*'@sentropic\/cluster-mesh'/g;
  for (const root of scanRoots) {
    for (const file of listSources(root)) {
      const source = readFileSync(file, 'utf8');
      const names = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = importRe.exec(source))) {
        for (const part of match[1].split(',')) {
          const cleaned = part.trim().replace(/^type\s+/, '');
          if (!cleaned) continue;
          names.add(cleaned.split(/\s+as\s+/)[0].trim());
        }
      }
      const missing = [...names].filter((name) => !reachable.has(name));
      if (missing.length > 0) misses.push({ file, names: missing });
    }
  }
  return misses;
}

describe('root-import audit (a4-cm-gaps-r2 §2.2)', () => {
  it('imports only root-reachable names from the cluster-mesh root specifier', () => {
    const misses = audit();
    const detail = misses
      .map((miss) => `  ${miss.file}: ${miss.names.join(', ')}`)
      .join('\n');
    expect(misses.length, `names not exported by the root barrel must move to a subpath:\n${detail}`).toBe(0);
  });

  it('keeps the auth-hono family on the identity/auth-hono subpath', () => {
    const authHonoNames = [
      'createIdentityAuthHonoTransactionBindingV1', 'runIdentityAuthCompletionV1',
      'IdentityAuthAccountPolicyV1', 'IdentityAuthBusinessHooksV1', 'IdentityAuthCompletionFlowV1',
      'IdentityAuthCompletionOutcomeV1', 'IdentityAuthHonoTransactionBindingV1', 'IdentityAuthRefusalV1',
      'IdentityDeferredMailV1',
    ];
    const reachable = rootReachableExports();
    for (const name of authHonoNames) {
      expect(reachable.has(name), `${name} must stay behind the subpath, not the root barrel`).toBe(false);
    }
    const subpath = readFileSync(join(cmSrc, 'identity/auth-hono.ts'), 'utf8');
    expect(subpath).toContain("export * from '../identity-contracts/custody-auth.js'");
    expect(subpath).toContain("export * from './auth-binding.js'");
    expect(subpath).toContain("export * from './auth-completion.js'");
  });
});
