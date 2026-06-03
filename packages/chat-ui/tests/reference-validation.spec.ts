/**
 * reference-validation.spec.ts
 *
 * Anti-orphan guard for @sentropic/chat-ui exported components.
 *
 * Rules enforced:
 *   (a) Every exported `./components/*.svelte` subpath MUST be classified in
 *       `chat-ui-reference-validation.json`. Unknown component → FAIL (forces
 *       a conscious decision before a new component can be published).
 *   (b) Every `assembly`'s `composes` entries must each be `primitive` or
 *       `assembly` (NOT `legacy`), and its `assemblyValidatedBy` file must exist.
 *   (c) Best-effort dogfooding: if `ui/src` is reachable from the test sandbox,
 *       assert each `primitive`'s `dogfoodedBy` files exist. Import presence is
 *       checked as best-effort (warn, do not hard-fail) because some primitives
 *       may be consumed via a thin local wrapper rather than a direct package import.
 *       If `ui/src` is NOT reachable, emit a `console.info` skip note and do NOT fail.
 *
 * This test is intentionally deterministic, network-free, and timeout-free.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = process.cwd();
const REPO_ROOT = (function resolveRepoRoot(): string {
  // Walk up from packages/chat-ui looking for the dir that contains both
  // `ui/` and `packages/` subdirectories.
  let dir = PACKAGE_ROOT;
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    if (
      fs.existsSync(path.join(parent, 'ui')) &&
      fs.existsSync(path.join(parent, 'packages'))
    ) {
      return parent;
    }
    dir = parent;
  }
  return path.resolve(PACKAGE_ROOT, '..', '..');
})();

const PKG_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');
const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'chat-ui-reference-validation.json');
const UI_SRC_ROOT = path.join(REPO_ROOT, 'ui', 'src');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PkgExportEntry = Record<string, string | undefined>;
type PkgJson = { exports: Record<string, PkgExportEntry | string> };

type PrimitiveEntry = {
  class: 'primitive';
  dogfoodedBy: string[];
};
type AssemblyEntry = {
  class: 'assembly';
  composes: string[];
  assemblyValidatedBy: string[];
};
type HeadlessEntry = {
  class: 'headless';
};
type LegacyEntry = {
  class: 'legacy';
  deprecation: { owner: string; note: string };
};
type ComponentEntry = PrimitiveEntry | AssemblyEntry | HeadlessEntry | LegacyEntry;
type Manifest = { components: Record<string, ComponentEntry> };

// ---------------------------------------------------------------------------
// Load fixtures
// ---------------------------------------------------------------------------

const pkg = JSON.parse(fs.readFileSync(PKG_JSON_PATH, 'utf8')) as PkgJson;
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;

/** Extract component names from `./components/*.svelte` export subpaths. */
function extractExportedComponents(exports: Record<string, PkgExportEntry | string>): string[] {
  const names: string[] = [];
  for (const subpath of Object.keys(exports)) {
    const m = subpath.match(/^\.\/components\/(.+\.svelte)$/);
    if (m) names.push(m[1]);
  }
  return names.sort();
}

const exportedComponents = extractExportedComponents(pkg.exports);
const VALID_CLASSES = new Set<string>(['primitive', 'assembly', 'headless', 'legacy']);
const CANONICAL_CLASSES = new Set<string>(['primitive', 'assembly', 'headless']);

const uiSrcReachable = fs.existsSync(UI_SRC_ROOT);

// ---------------------------------------------------------------------------
// (a) Every exported component is classified
// ---------------------------------------------------------------------------

describe('reference-validation (a): every exported component is classified', () => {
  it('manifest file exists', () => {
    expect(
      fs.existsSync(MANIFEST_PATH),
      `manifest not found at ${MANIFEST_PATH}`,
    ).toBe(true);
  });

  it('at least one component is exported', () => {
    expect(exportedComponents.length).toBeGreaterThan(0);
  });

  for (const name of exportedComponents) {
    it(`"${name}" is present in the manifest`, () => {
      expect(
        manifest.components,
        'manifest.components is missing',
      ).toBeTruthy();
      expect(
        manifest.components[name],
        `"${name}" is exported but not classified in chat-ui-reference-validation.json — add it with a valid class`,
      ).toBeTruthy();
    });

    it(`"${name}" has a valid class`, () => {
      const entry = manifest.components[name];
      expect(
        VALID_CLASSES.has(entry?.class),
        `"${name}" has class "${entry?.class}" — must be one of: ${[...VALID_CLASSES].join(', ')}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// (b) Assembly integrity
// ---------------------------------------------------------------------------

describe('reference-validation (b): assembly integrity', () => {
  const assemblyEntries = Object.entries(manifest.components).filter(
    ([, e]) => e.class === 'assembly',
  ) as [string, AssemblyEntry][];

  if (assemblyEntries.length === 0) {
    it('no assembly entries — check passes vacuously', () => {
      // No assemblies currently in the manifest is expected in Wave 1
      // (ChatConversation is classified as legacy until Wave 3).
      expect(true).toBe(true);
    });
  }

  for (const [name, entry] of assemblyEntries) {
    it(`assembly "${name}" has non-empty composes list`, () => {
      expect(Array.isArray(entry.composes) && entry.composes.length > 0).toBe(true);
    });

    it(`assembly "${name}" has non-empty assemblyValidatedBy list`, () => {
      expect(
        Array.isArray(entry.assemblyValidatedBy) && entry.assemblyValidatedBy.length > 0,
      ).toBe(true);
    });

    for (const composed of entry.composes ?? []) {
      it(`assembly "${name}" composes canonical (non-legacy) component "${composed}"`, () => {
        const composedEntry = manifest.components[composed];
        expect(
          composedEntry,
          `"${composed}" (composed by assembly "${name}") is not in the manifest`,
        ).toBeTruthy();
        expect(
          CANONICAL_CLASSES.has(composedEntry?.class),
          `assembly "${name}" composes "${composed}" which is "${composedEntry?.class}" — assemblies must not compose legacy components`,
        ).toBe(true);
      });
    }

    for (const validatedBy of entry.assemblyValidatedBy ?? []) {
      it(`assembly "${name}" validatedBy file exists: "${validatedBy}"`, () => {
        const abs = path.resolve(PACKAGE_ROOT, validatedBy);
        expect(
          fs.existsSync(abs),
          `assemblyValidatedBy file "${validatedBy}" does not exist at "${abs}"`,
        ).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (c) Best-effort dogfooding (primitives only)
// ---------------------------------------------------------------------------

describe('reference-validation (c): primitive dogfooding (best-effort)', () => {
  if (!uiSrcReachable) {
    it('ui/src not reachable — dogfooding check skipped', () => {
      console.info(
        `[reference-validation] ui/src not reachable at "${UI_SRC_ROOT}". Dogfooding check skipped.`,
      );
      expect(true).toBe(true);
    });
  } else {
    const primitiveEntries = Object.entries(manifest.components).filter(
      ([, e]) => e.class === 'primitive',
    ) as [string, PrimitiveEntry][];

    it('ui/src is reachable', () => {
      expect(fs.existsSync(UI_SRC_ROOT)).toBe(true);
    });

    for (const [name, entry] of primitiveEntries) {
      it(`primitive "${name}" has at least one dogfoodedBy path`, () => {
        expect(
          Array.isArray(entry.dogfoodedBy) && entry.dogfoodedBy.length > 0,
          `"${name}" is primitive but has no dogfoodedBy paths`,
        ).toBe(true);
      });

      for (const relPath of entry.dogfoodedBy ?? []) {
        const absPath = path.join(REPO_ROOT, relPath);

        it(`primitive "${name}" dogfoodedBy file exists: "${relPath}"`, () => {
          expect(
            fs.existsSync(absPath),
            `dogfoodedBy file "${relPath}" does not exist at "${absPath}"`,
          ).toBe(true);
        });

        it(`primitive "${name}" dogfoodedBy file "${relPath}" references the component (best-effort)`, () => {
          if (!fs.existsSync(absPath)) {
            // Already caught in previous test; skip gracefully here
            console.info(
              `[reference-validation] Skipping import check for "${name}" — file not found: ${relPath}`,
            );
            return;
          }
          const content = fs.readFileSync(absPath, 'utf8');
          // Best-effort: search for the component filename (covers both direct package
          // imports and local wrapper patterns where the component is referenced by name).
          const componentBase = path.basename(name, '.svelte');
          const appearsInFile =
            content.includes(`/components/${name}`) || content.includes(componentBase);
          if (!appearsInFile) {
            // Warn but do not hard-fail — the component may be consumed indirectly via
            // a local wrapper or the dogfoodedBy path may be aspirational (pre-P7-merge).
            console.warn(
              `[reference-validation] WARN: primitive "${name}" dogfoodedBy "${relPath}" exists but ` +
                `does not reference "${componentBase}". This may indicate the package import ` +
                `is not yet wired (e.g. post-retrofit branch not merged).`,
            );
          }
          // Existence of the file is the hard gate; import presence is advisory.
          expect(
            fs.existsSync(absPath),
            `dogfoodedBy file "${relPath}" must exist`,
          ).toBe(true);
        });
      }
    }
  }
});
