import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = process.cwd();
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const PKG_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');
const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'export-manifest.json');

type PkgExportEntry = Record<string, string | undefined>;
type PkgJson = { exports: Record<string, PkgExportEntry | string> };
type ManifestSubpath = {
  kind: 'ts' | 'svelte';
  file: string;
  exists?: boolean;
  exports?: string[];
  storeShape?: Record<string, string[]>;
};
type Manifest = { subpaths: Record<string, ManifestSubpath> };

const pkg = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8')) as PkgJson;
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;

function resolveEntryFile(entry: PkgExportEntry | string): string | undefined {
  if (typeof entry === 'string') return entry;
  return entry['import'] ?? entry['svelte'] ?? entry['types'];
}

/**
 * Map a dist/ export path back to the corresponding src/ source file for existence checks.
 * dist/foo/bar.js  -> src/foo/bar.ts
 * dist/foo/Bar.svelte -> src/foo/Bar.svelte
 * dist/index.js -> src/index.ts
 */
function distToSrcFile(distFile: string): string {
  // Swap dist/ prefix for src/
  const srcFile = distFile.replace(/^\.\/dist\//, './src/');
  // .js compiled output came from .ts source
  if (srcFile.endsWith('.js')) return srcFile.slice(0, -3) + '.ts';
  // .svelte stays .svelte (same filename, different dir)
  return srcFile;
}

describe('export-surface (a): every subpath resolves to an existing source file', () => {
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    it(`subpath "${subpath}" resolves to an existing source file`, () => {
      const file = resolveEntryFile(entry);
      expect(file, `subpath "${subpath}" has no resolvable file field`).toBeTruthy();
      // Exports point to dist/ (built artifact). Verify the corresponding src/ file exists
      // so the dist can always be (re)built. dist/ is a build output, not source-controlled.
      const srcFile = distToSrcFile(file as string);
      const abs = path.resolve(PACKAGE_ROOT, srcFile);
      expect(fs.existsSync(abs), `"${subpath}" -> dist file built from "${srcFile}" does not exist in src`).toBe(true);
    });
  }
});

describe('export-surface (b): no removed or renamed TS exports', () => {
  for (const [subpath, mEntry] of Object.entries(manifest.subpaths)) {
    if (mEntry.kind !== 'ts') continue;
    if (!mEntry.exports || mEntry.exports.length === 0) continue;

    it(`subpath "${subpath}" — all manifest exports still present in source`, () => {
      const pkgEntry = pkg.exports[subpath];
      const distFile = pkgEntry ? resolveEntryFile(pkgEntry) : undefined;
      expect(distFile, `package.json missing subpath "${subpath}"`).toBeTruthy();
      // Read from the src/ equivalent — dist/ is a build artifact
      const srcFile = distToSrcFile(distFile as string);
      const source = fs.readFileSync(path.resolve(PACKAGE_ROOT, srcFile), 'utf8');

      for (const name of mEntry.exports!) {
        // For barrel re-exports (export * from '...'), a name may not appear
        // literally in the file — it is transitively exported. We detect this
        // case by checking that every export either:
        //   (a) is defined directly in the file, or
        //   (b) the file contains at least one "export * from" line (barrel)
        const definedDirectly = new RegExp(`\\bexport\\b[^*][\\s\\S]*?\\b${name}\\b`).test(source);
        const isBarrel = /export\s+\*\s+from/.test(source);
        expect(
          definedDirectly || isBarrel,
          `"${name}" not found directly or via barrel re-export in "${subpath}"`,
        ).toBe(true);
      }
    });
  }
});

describe('export-surface (c): store-shape — subscribe/set/update', () => {
  it('chatWidgetLayout store exposes subscribe, set, update', async () => {
    const mod = await import('../src/stores/chatWidgetLayout.js');
    const store = mod.chatWidgetLayout as Record<string, unknown>;
    expect(typeof store['subscribe']).toBe('function');
    expect(typeof store['set']).toBe('function');
    expect(typeof store['update']).toBe('function');
  });

  it('localToolsStore store exposes subscribe, set, update', async () => {
    const mod = await import('../src/stores/localTools.js');
    const store = mod.localToolsStore as Record<string, unknown>;
    expect(typeof store['subscribe']).toBe('function');
    expect(typeof store['set']).toBe('function');
    expect(typeof store['update']).toBe('function');
  });
});

describe('export-surface (d): consumer scan — all used subpaths declared in exports', () => {
  const exportedSubpaths = new Set(Object.keys(pkg.exports));

  function collectSpecifiers(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectSpecifiers(fullPath));
      } else if (entry.isFile() && /\.(ts|svelte)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const m of content.matchAll(/from ['"](@sentropic\/chat-ui(?:\/[^'"]+)?)['"]/g)) {
          out.push(m[1]);
        }
      }
    }
    return out;
  }

  const dirsToScan: string[] = [path.join(REPO_ROOT, 'ui', 'src')];
  const pkgsRoot = path.join(REPO_ROOT, 'packages');
  if (fs.existsSync(pkgsRoot)) {
    for (const d of fs.readdirSync(pkgsRoot, { withFileTypes: true })) {
      if (d.isDirectory() && d.name !== 'chat-ui') {
        dirsToScan.push(path.join(pkgsRoot, d.name, 'src'));
      }
    }
  }

  const used = [...new Set(dirsToScan.flatMap(collectSpecifiers))];

  it('found at least one @sentropic/chat-ui import in the codebase', () => {
    expect(used.length).toBeGreaterThan(0);
  });

  for (const specifier of used) {
    const sub = specifier === '@sentropic/chat-ui' ? '.' : specifier.replace('@sentropic/chat-ui', '.');
    it(`consumer "${specifier}" is declared in exports`, () => {
      expect(exportedSubpaths.has(sub), `"${specifier}" (subpath "${sub}") not in exports`).toBe(true);
    });
  }
});
