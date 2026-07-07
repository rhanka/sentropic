import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PURITY GATES — the architect's §S.5 conditions as executable checks.
 *
 * (b) The package stays PURE: no graphify dependency (runtime OR type-time —
 *     the seam types are a LOCAL mirror in src/types.ts), no radar import
 *     (the radar code was the SEED, lifted, not linked), no `$lib`/app-alias
 *     import (the package must never silently re-couple to a host app).
 * (e) v1 ratified deps only: pdf.js (+ the design system + svelte as the
 *     component substrate). Markdown rendering is self-contained (zero dep).
 *
 * These run in the standard package test target, so they gate CI wherever the
 * package tests run.
 */

// vitest runs from the package root (same convention as the graphify interim
// purity test); avoid __dirname (ESM test transform).
const PKG_ROOT = process.cwd();
const SRC_ROOT = path.join(PKG_ROOT, "src");

/** Every import/export-from/dynamic-import specifier in a source text. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticRe = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s+["']([^"']+)["']/g;
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, bareRe, dynamicRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1] as string);
  }
  return specs;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|js|svelte)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const ALLOWED_EXTERNAL = [
  /^svelte(\/|$)/, // the component substrate (peer)
  /^@sentropic\/design-system-svelte(\/|$)/, // REAL DS components (principal requirement)
  /^pdfjs-dist(\/|$)/, // v1 ratified render lib (PDF text-layer)
];

const FORBIDDEN_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /graphify/i, why: "no graphify dependency (S.5(b))" },
  { re: /^\$lib(\/|$)/, why: "no host-app $lib alias import" },
  { re: /^\$app(\/|$)/, why: "no SvelteKit app alias import" },
  { re: /radar/i, why: "radar was the seed, lifted not linked" },
  { re: /^@sentropic\/graph(\/|$)/, why: "no graphify-side package dependency" },
];

describe("purity gates (architect S.5 conditions)", () => {
  const files = listSourceFiles(SRC_ROOT);

  it("scans a non-trivial source tree", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("src imports only svelte, the DS, pdfjs-dist, or package-internal modules", () => {
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const spec of importSpecifiers(source)) {
        for (const { re, why } of FORBIDDEN_PATTERNS) {
          expect(spec, `${file} imports "${spec}" — ${why}`).not.toMatch(re);
        }
        if (spec.startsWith(".")) {
          // Relative imports must stay INSIDE the package src tree.
          const resolved = path.resolve(path.dirname(file), spec);
          expect(
            resolved.startsWith(SRC_ROOT + path.sep) || resolved === SRC_ROOT,
            `${file} imports "${spec}" which escapes src/`,
          ).toBe(true);
        } else {
          const allowed = ALLOWED_EXTERNAL.some((re) => re.test(spec));
          expect(allowed, `${file} imports non-ratified external "${spec}"`).toBe(true);
        }
      }
    }
  });

  it("package.json declares no graphify/radar dependency and only ratified externals", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const runtimeDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    for (const name of [...runtimeDeps, ...Object.keys(pkg.devDependencies ?? {})]) {
      expect(name).not.toMatch(/graphify/i);
      expect(name).not.toMatch(/radar/i);
    }
    // v1 ratified runtime surface, exactly.
    expect(runtimeDeps.sort()).toEqual([
      "@sentropic/design-system-svelte",
      "pdfjs-dist",
      "svelte",
    ]);
  });

  it("the seam types are a LOCAL mirror (types.ts declares the contract itself)", () => {
    const typesSource = fs.readFileSync(path.join(SRC_ROOT, "types.ts"), "utf8");
    expect(typesSource).toContain("export interface CitedSourceRef");
    expect(typesSource).toContain("export interface OntologyCitation");
    // The mirror must be import-free (fully self-contained contract).
    expect(importSpecifiers(typesSource)).toEqual([]);
  });
});
