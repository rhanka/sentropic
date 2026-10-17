/**
 * M6.1 — R1 boundary structural proofs (contract-v8 §3.1): the internal
 * synthetic remote helper is absent from supported exports, unreferenced by
 * the registry/HTTP/stdio import graph, and excluded from the build (hence
 * from dist and the packed tarball). Static file assertions: deterministic,
 * no I/O beyond reading the package's own sources.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ToolConfigurationDiagnosticCode } from '../src/tool-configuration.js';

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

describe('remote-bound boundary structure', () => {
  it('exposes no remote-binding entry in supported exports', () => {
    const pkg = JSON.parse(read('../package.json')) as { exports: Record<string, unknown> };
    expect(Object.keys(pkg.exports).length).toBeGreaterThan(0);
    for (const key of Object.keys(pkg.exports)) {
      expect(key).not.toMatch(/remote-binding/);
    }
  });

  it('is unreferenced by the registry/HTTP/stdio import graph', () => {
    for (const file of [
      '../src/index.ts',
      '../src/registry.ts',
      '../src/hono.ts',
      '../src/transport/bridge.ts',
      '../src/transport/stdio.ts',
      '../src/transport/streamable-http.ts',
      '../src/transport/dispatch.ts',
    ]) {
      expect(read(file)).not.toContain('registry-remote-binding');
    }
  });

  it('is excluded from the build', () => {
    const tsconfig = JSON.parse(read('../tsconfig.json')) as { exclude?: string[] };
    expect(tsconfig.exclude ?? []).toContain('src/registry-remote-binding.ts');
  });

  it('m5 declares every kernel-produced diagnostic code in the public union', () => {
    // Genuine RED while the casts below exist: the kernel must produce only
    // declared codes, never `as never` forgeries of the public union.
    expect(read('../src/registry.ts')).not.toContain('as never');
    const kernelCodes: ToolConfigurationDiagnosticCode[] = [
      'unknown_provider',
      'missing_compatibility',
      'compatibility_mismatch',
      'load_failure',
      'unsupported_definition_kind',
      'missing_handler',
      'duplicate_resource',
      'duplicate_prompt',
      'duplicate_tool',
      'invalid_parameter',
      'unknown_parameter',
    ];
    expect(kernelCodes).toHaveLength(11);
  });
});
