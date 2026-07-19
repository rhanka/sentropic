/** @experimental — published but NOT frozen; no semver guarantee. */

/**
 * BR-72 Wave-2 Lot 2 — Google Drive connector EXPERIMENTAL write surface.
 *
 * Mirrors `@sentropic/mcp-platform`'s own root/experimental split: the
 * read-only Wave-1 root (`./index.ts`) stays FROZEN and mutation-free; every
 * write capability (`files.create`, `files.update`, `files.copy`,
 * `permissions.create`, `files.delete`, `drives.create`) is reachable ONLY
 * from this entry. Every mutation routes through mcp-platform's guarded
 * mutation-gate path (`assertMutationGate` via `invokeGuardedTool`) before
 * running; synthetic fixtures only, no real network call.
 */

export { googleDriveWriteAdapter, invokeGoogleDriveWriteTool } from './write-adapter.js';
export type { GoogleDriveWriteInvokeDeps } from './write-adapter.js';

export { googleDriveWriteFixtures, getWriteToolFixture } from './write-fixtures.js';
export type { GoogleDriveWriteToolCapabilityName } from './write-fixtures.js';

export { googleDriveWriteManifest, googleDriveWriteToolsByName } from './write-manifest.js';
