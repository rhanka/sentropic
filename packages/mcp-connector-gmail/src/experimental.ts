/** @experimental — published but NOT frozen; no semver guarantee. */

/**
 * BR-72 Wave-2 Lot 3 — Gmail connector EXPERIMENTAL write surface.
 *
 * Mirrors `@sentropic/mcp-platform`'s own root/experimental split: the
 * read-only Wave-1 root (`./index.ts`) stays FROZEN and mutation-free; every
 * write capability (send_email, create_draft, update_draft, delete_draft,
 * create_label, add_label_to_email, move_to_trash, create_filter) is reachable
 * ONLY from this entry. Every mutation routes through mcp-platform's guarded
 * mutation-gate path (`assertMutationGate` via `invokeGuardedTool`) before
 * running; synthetic fixtures only, no real network call.
 */

export { gmailWriteAdapter, invokeGmailWriteTool } from './write-adapter.js';
export type { GmailWriteInvokeDeps } from './write-adapter.js';

export { gmailWriteFixtures, getWriteToolFixture } from './write-fixtures.js';
export type { GmailWriteToolCapabilityName } from './write-fixtures.js';

export { gmailWriteManifest, gmailWriteToolsByName } from './write-manifest.js';
