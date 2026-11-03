/**
 * SNAPSHOT — byte-stable tools/list catalogue for the artifacts provider.
 *
 * Why this file exists: MCP hosts such as claude.ai key per-tool "Always
 * allow" permissions on the exact tool definition bytes (name, description,
 * inputSchema, outputSchema, annotations, _meta). If any of those bytes move
 * between deployments, package versions or profile switches, the owner must
 * re-approve every tool in every session. The rule is therefore: tool
 * definitions are compile-time constants (ARTIFACTS_TOOL_DEFINITIONS in
 * src/mcp-core.ts). The dynamic contract — profile revision, result envelope
 * version, limits — travels in typed results, the API guide and manifest
 * audit metadata, never in a definition.
 *
 * This test serves the manifest over the real MCP SDK bridge (the same
 * registerMcpWireTools path hosts use) for two different compiled profiles
 * (APP-P1 RADAR and a strict r2 profile carrying a profileRevisionId) and
 * compares the full tools/list catalogue against the checked-in snapshot
 * tests/snapshots/tools-list-catalogue.json. It fails on ANY definition
 * change. To deliberately update the snapshot: delete the JSON file and
 * re-run this test once — it rewrites the file and fails, then passes on
 * the next run; commit the result in the same change as the definition.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { registerMcpWireTools, type AppToolResult } from '@sentropic/mcp-platform/transport/bridge';
import { compileMcpToolSchemas, type McpToolValidationLimits } from '@sentropic/mcp-platform/transport/tool-schemas';
import {
  ARTIFACTS_PROVIDER_VERSION,
  ARTIFACTS_TOOL_DEFINITIONS,
  ARTIFACTS_TOOL_NAMES,
  createArtifactsManifest,
  type ArtifactsManifest,
} from '../src/mcp-core.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';

const SNAPSHOT_URL = new URL('./snapshots/tools-list-catalogue.json', import.meta.url);
const LIMITS: McpToolValidationLimits = {
  maxSchemaBytes: 2 ** 21, maxSchemaDepth: 128, maxRequestBytes: 2 ** 25,
  maxArgumentBytes: 2 ** 24, maxArgumentDepth: 64, maxResultBytes: 2 ** 25, maxResultDepth: 64,
};

/** Strict r2 profile: carries a profileRevisionId and the v2 envelope. */
const r2StrictProfile = () => compileArtifactsProfile({
  ...RADAR_ARTIFACTS_PROFILE,
  profileRevisionId: 'immo-artifacts.v2',
  requireExpectedCurrentReleaseId: true,
  resultEnvelopeVersion: 2,
  selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities,
    'artifacts_list_versions', 'artifacts_revert', 'artifacts_get_source',
    'artifacts_set_access', 'artifacts_delete'],
  operations: [...RADAR_ARTIFACTS_PROFILE.operations,
    { operation: 'set_access', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
    { operation: 'delete', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} }],
});

/** Deterministic JSON: sorted keys, undefined dropped, stable formatting. */
function canonical(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, sortKeys(entry)] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  }
  return value;
}

/** The wire projection of one tools/list entry, exactly as hosts receive it. */
function projectTool(tool: Tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    _meta: tool._meta,
  };
}

async function listToolsOverSdk(manifest: ArtifactsManifest): Promise<Tool[]> {
  const tools: Tool[] = manifest.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Tool['inputSchema'],
    outputSchema: tool.outputSchema as Tool['outputSchema'],
  }));
  const schemas = compileMcpToolSchemas(tools, LIMITS);
  const server = new Server({ name: 'artifacts-snapshot-host', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerMcpWireTools(server, tools, {
    run: async (): Promise<AppToolResult> => ({ ok: true, output: {}, auditId: 'audit-snapshot', redactionClass: 'low' }),
  }, {
    schemas,
    limits: LIMITS,
    formatFailure: () => ({ content: [{ type: 'text', text: 'rejected' }], isError: true }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'artifacts-snapshot-client', version: '0.0.0' });
  await client.connect(clientTransport);
  const listed = (await client.listTools()).tools;
  await client.close();
  await server.close();
  return listed;
}

describe('tools/list snapshot (byte-stable tool definitions)', () => {
  it('serves identical definitions across profiles and matches the checked-in snapshot', async () => {
    const manifests: Record<string, ArtifactsManifest> = {
      'app-p1-radar': createArtifactsManifest({ profile: compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE) }),
      'r2-strict-v2': createArtifactsManifest({ profile: r2StrictProfile() }),
    };
    const toolsList: Record<string, ReturnType<typeof projectTool>[]> = {};
    for (const [key, manifest] of Object.entries(manifests)) {
      toolsList[key] = (await listToolsOverSdk(manifest)).map(projectTool);
    }
    const definitions = Object.fromEntries(ARTIFACTS_TOOL_NAMES.map((name) => [name, ARTIFACTS_TOOL_DEFINITIONS[name]]));
    const actual = { definitions, toolsList };
    if (!existsSync(SNAPSHOT_URL)) {
      mkdirSync(dirname(fileURLToPath(SNAPSHOT_URL)), { recursive: true });
      writeFileSync(SNAPSHOT_URL, canonical(actual));
      throw new Error('tools/list snapshot written; re-run this test, then commit the snapshot with the change');
    }
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8')) as typeof actual;
    expect(actual.definitions).toEqual(snapshot.definitions);
    expect(actual.toolsList).toEqual(snapshot.toolsList);

    // Byte-stability across profile switches: shared tools are identical.
    const r2ByName = new Map(toolsList['r2-strict-v2'].map((tool) => [tool.name, tool]));
    for (const tool of toolsList['app-p1-radar']) {
      expect(canonical(tool)).toBe(canonical(r2ByName.get(tool.name)));
    }

    // No per-deployment value may leak into any definition.
    const allDefinitions = canonical(actual);
    expect(allDefinitions).not.toContain('immo-artifacts');
    expect(allDefinitions).not.toContain(ARTIFACTS_PROVIDER_VERSION);
    expect(allDefinitions).not.toContain('resultEnvelopeVersion');
    expect(allDefinitions).not.toContain('profileDigest');
  });
});
