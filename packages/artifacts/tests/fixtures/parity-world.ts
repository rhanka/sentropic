/**
 * Shared parity-P0 world: the Radar profile with the three new capabilities
 * selected (list_versions, get_source, revert) over the memory transport.
 */
import { expect } from 'vitest';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../../src/profile/index.js';
import { createTransportWorld } from './transport-world.js';

export const PARITY_PROFILE_INPUT = {
  ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities,
    'artifacts_list_versions', 'artifacts_get_source', 'artifacts_revert'],
} as const;

export function parityWorld() {
  return createTransportWorld(['alice', 'bob'], 'scope-l6',
    { profile: PARITY_PROFILE_INPUT as unknown as typeof RADAR_ARTIFACTS_PROFILE });
}

export function parityProfile() {
  return compileArtifactsProfile(PARITY_PROFILE_INPUT as unknown as typeof RADAR_ARTIFACTS_PROFILE);
}

export interface Body { [key: string]: unknown }

export async function ensureSite(w: ReturnType<typeof parityWorld>, key: string,
  metadata?: Record<string, string>) {
  // The key doubles as bindingName so two ensureSite calls in one world create distinct artifacts.
  const res = await w.mcp.invoke({ tool: 'artifacts_ensure', invocation: w.invocation(),
    args: { bindingName: key, idempotencyKey: key, ...(metadata ?? {}) } });
  expect(res.status).toBe(201);
  return (res.body as Body).artifactId as string;
}

export async function publishText(w: ReturnType<typeof parityWorld>, artifactId: string, text: string,
  key: string, extra: Record<string, unknown> = {}) {
  return w.mcp.invoke({ tool: 'artifacts_publish', invocation: w.invocation(), args: {
    artifactId, idempotencyKey: key,
    files: [{ path: 'index.html', mimeType: 'text/html', text }], ...extra } });
}

export async function publish(w: ReturnType<typeof parityWorld>, artifactId: string, key: string,
  args: Record<string, unknown>) {
  return w.mcp.invoke({ tool: 'artifacts_publish', invocation: w.invocation(),
    args: { artifactId, idempotencyKey: key, ...args } });
}

export const listVersions = (w: ReturnType<typeof parityWorld>, artifactId: string, actor = 'alice') =>
  w.mcp.invoke({ tool: 'artifacts_list_versions', invocation: w.invocation(actor), args: { artifactId } });

export const getSource = (w: ReturnType<typeof parityWorld>, artifactId: string, actor = 'alice') =>
  w.mcp.invoke({ tool: 'artifacts_get_source', invocation: w.invocation(actor), args: { artifactId } });

export const getMeta = (w: ReturnType<typeof parityWorld>, artifactId: string) =>
  w.mcp.invoke({ tool: 'artifacts_get', invocation: w.invocation(), args: { artifactId } });

export const listAll = (w: ReturnType<typeof parityWorld>) =>
  w.mcp.invoke({ tool: 'artifacts_list', invocation: w.invocation(), args: {} });

export const revert = (w: ReturnType<typeof parityWorld>, args: Record<string, unknown>) =>
  w.mcp.invoke({ tool: 'artifacts_revert', invocation: w.invocation(), args });
