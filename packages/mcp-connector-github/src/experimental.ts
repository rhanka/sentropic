/** @experimental — published but NOT frozen; no semver guarantee. */

/**
 * BR-72 Wave-2 Lot 1 — GitHub connector EXPERIMENTAL write surface.
 *
 * Mirrors `@sentropic/mcp-platform`'s own root/experimental split: the
 * read-only Wave-1 root (`./index.ts`) stays FROZEN and mutation-free; every
 * write capability (`create_repository`, `create_issue`, `update_issue`,
 * `create_or_update_file`, `delete_file`, `dispatch_workflow`,
 * `delete_repository`) is reachable ONLY from this entry. Every mutation
 * routes through mcp-platform's guarded mutation-gate path
 * (`assertMutationGate` via `invokeGuardedTool`) before running; synthetic
 * fixtures only, no real network call.
 */

export { githubWriteAdapter, invokeGithubWriteTool } from './write-adapter.js';
export type { GithubWriteInvokeDeps } from './write-adapter.js';

export { githubWriteFixtures, getWriteToolFixture } from './write-fixtures.js';
export type { GithubWriteToolCapabilityName } from './write-fixtures.js';

export { githubWriteManifest, githubWriteToolsByName } from './write-manifest.js';
