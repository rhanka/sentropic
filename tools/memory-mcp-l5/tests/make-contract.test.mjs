import { describe, it, expect } from 'vitest';
import { checkMakeCommand } from '../receipt.mjs';

describe('P10.tooling.make-contract — L5 Make command shape and port/ENV isolation contract', () => {
  it('P10.tooling.make-contract: accepts root Make commands with reserved BR-125 slot 0 ports and ENV last', () => {
    expect(
      checkMakeCommand('make test-mcp-broker SCOPE=tests/memory/source-binding.test.ts API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5'),
    ).toEqual([]);
    expect(
      checkMakeCommand('make memory-l5-gate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/candidate-manifest.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=e2e-feat-memory-mcp-l5'),
    ).toEqual([]);
  });

  it('P10.tooling.make-contract: rejects shell-prefix env, make -f bypass, missing port overrides, ENV=dev, and ENV not last', () => {
    expect(checkMakeCommand('ENV=test-feat-memory-mcp-l5 make test-mcp-broker API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725').join(' ')).toMatch(/must start with "make "/);
    expect(checkMakeCommand('make -f tools/memory-mcp-l5/Makefile API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5').join(' ')).toMatch(/-f bypass is forbidden/);
    expect(checkMakeCommand('make test-mcp-broker API_PORT=9625 UI_PORT=5825 ENV=test-feat-memory-mcp-l5').join(' ')).toMatch(/missing MAILDEV_UI_PORT=1725/);
    expect(checkMakeCommand('make test-mcp-broker API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=dev').join(' ')).toMatch(/ENV=<test\|e2e>-feat-memory-mcp-l5 must be last/);
    expect(checkMakeCommand('make test-mcp-broker ENV=test-feat-memory-mcp-l5 API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725').join(' ')).toMatch(/must be last/);
  });
});
