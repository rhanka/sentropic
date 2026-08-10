import { computeDurableWorkspaceId, durableWorkspaceId } from '@sentropic/track';

/**
 * Pure function helper to resolve the durable workspace ID (`ws:sha256`).
 * Shared across sentropic and a2a-cli.
 */
export function getDurableWorkspaceId(cwd: string = process.cwd()): string {
  const resolved = durableWorkspaceId(cwd);
  if (resolved) return resolved;

  return computeDurableWorkspaceId('sentropic-root', '');
}

export { computeDurableWorkspaceId, durableWorkspaceId };
