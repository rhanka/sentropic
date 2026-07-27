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
  _propSnapshot?: string;
};
type Manifest = { subpaths: Record<string, ManifestSubpath> };

const pkg = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8')) as PkgJson;
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;

function resolveEntryFile(entry: PkgExportEntry | string): string | undefined {
  if (typeof entry === 'string') return entry;
  return entry['import'] ?? entry['svelte'] ?? entry['types'];
}

describe('export-surface (a): every subpath resolves to an existing file', () => {
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    it(`subpath "${subpath}" resolves to an existing file`, () => {
      const file = resolveEntryFile(entry);
      expect(file, `subpath "${subpath}" has no resolvable file field`).toBeTruthy();
      const abs = path.resolve(PACKAGE_ROOT, file as string);
      expect(fs.existsSync(abs), `"${subpath}" -> "${file}" does not exist`).toBe(true);
    });
  }
});

describe('export-surface (b): no removed or renamed TS exports', () => {
  for (const [subpath, mEntry] of Object.entries(manifest.subpaths)) {
    if (mEntry.kind !== 'ts') continue;
    if (!mEntry.exports || mEntry.exports.length === 0) continue;

    it(`subpath "${subpath}" — all manifest exports still present in source`, () => {
      const pkgEntry = pkg.exports[subpath];
      const file = pkgEntry ? resolveEntryFile(pkgEntry) : undefined;
      expect(file, `package.json missing subpath "${subpath}"`).toBeTruthy();
      const source = fs.readFileSync(path.resolve(PACKAGE_ROOT, file as string), 'utf8');

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

describe('export-surface (c2): placement component contracts stay synchronized', () => {
  const contracts = [
    {
      subpath: './components/ChatDock.svelte',
      source: 'src/components/ChatDock.svelte',
      dts: 'src/components/ChatDock.svelte.d.ts',
      runtimeProps: ['containerStyle', 'dialogId', 'dialogAriaLabel'],
      dtsProps: ['containerStyle?: string', 'dialogId?: string', 'dialogAriaLabel?: string'],
      snapshotTerms: ['containerStyle?', 'dialogId?', 'dialogAriaLabel?'],
    },
    {
      subpath: './components/ChatPlacementMenuButton.svelte',
      source: 'src/components/ChatPlacementMenuButton.svelte',
      dts: 'src/components/ChatPlacementMenuButton.svelte.d.ts',
      runtimeProps: ['dragCallbacks', 'placementMenu', 'onPlacementChange'],
      dtsProps: ['dragCallbacks?', 'placementMenu:', 'onPlacementChange?'],
      snapshotTerms: ['dragCallbacks?', 'Mode + Side', 'Side is absent in Full screen'],
    },
    {
      subpath: './components/ChatPlacementDropZones.svelte',
      source: 'src/components/ChatPlacementDropZones.svelte',
      dts: 'src/components/ChatPlacementDropZones.svelte.d.ts',
      runtimeProps: ['zones', 'hovered', 'labelForPlacement'],
      dtsProps: ['zones?:', 'hovered?:', 'labelForPlacement:'],
      snapshotTerms: ['zones?', 'hovered?', 'labelForPlacement'],
    },
  ];

  for (const contract of contracts) {
    it(`${contract.subpath} has matching runtime props, declaration props, and manifest snapshot`, () => {
      const source = fs.readFileSync(path.join(PACKAGE_ROOT, contract.source), 'utf8');
      const dts = fs.readFileSync(path.join(PACKAGE_ROOT, contract.dts), 'utf8');
      const snapshot = manifest.subpaths[contract.subpath]?._propSnapshot ?? '';

      for (const prop of contract.runtimeProps) {
        expect(source, `${contract.subpath} runtime is missing ${prop}`).toContain(prop);
      }
      for (const prop of contract.dtsProps) {
        expect(dts, `${contract.subpath} declaration is missing ${prop}`).toContain(prop);
      }
      for (const term of contract.snapshotTerms) {
        expect(snapshot, `${contract.subpath} manifest snapshot is missing ${term}`).toContain(term);
      }
    });
  }
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
