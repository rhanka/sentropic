import type {
    ToolPermissionDecision,
    ToolPermissionEntry,
} from '@sentropic/cowork-bridge/permissions';

/**
 * Per-tool consent for desktop eyes/hands. This is a remote-control surface, so
 * the model is DEFAULT DENY until the user grants. It reuses the portable
 * permission schema/matching from `@sentropic/cowork-bridge` (the same one the
 * Chrome extension uses) so policies are expressed and ranked identically.
 *
 * On a desktop binary there is no browser origin; we use a fixed
 * `DESKTOP_ORIGIN` so the bridge origin-matching machinery still applies.
 */

/**
 * Synthetic origin used for all desktop tool permission entries. Must be a
 * multi-label hostname so the bridge `isValidHostname`/`normalizeOriginPattern`
 * accepts it (single-label names like `desktop` are rejected, which would make
 * `normalizeEntry` drop every persisted consent entry). The manager resolves it
 * as `http://<DESKTOP_ORIGIN>` for the bridge matcher.
 */
export const DESKTOP_ORIGIN = 'desktop.cowork';

/** Outcome of a consent check, before running the executor. */
export type ConsentVerdict =
    | { decision: 'allow'; source: 'allow_once' | 'allow_always' }
    | { decision: 'deny'; source: 'deny_always' | 'default' }
    | { decision: 'needs_consent' };

/**
 * Persistence seam for consent entries (the durable `allow_always` /
 * `deny_always` policies). Mirrors the bridge `StorageAdapter` philosophy: the
 * binary supplies a file/credential-store backed implementation, tests supply
 * an in-memory one.
 */
export interface ConsentStore {
    /** Read all persisted policy entries. */
    readEntries(): Promise<ToolPermissionEntry[]>;
    /** Persist (insert or replace) a single policy entry by `${toolName}::${origin}`. */
    upsertEntry(entry: ToolPermissionEntry): Promise<void>;
    /** Remove a single policy entry by tool name + origin. */
    removeEntry(toolName: string, origin: string): Promise<void>;
    /** Clear all persisted policy entries (used on disconnect/revoke). */
    clear(): Promise<void>;
}

/**
 * Headless decision hook. The runner asks the host how to resolve a tool call
 * that has no persisted policy. A tray UI (Lot 5) implements this by prompting
 * the user; tests/headless runs supply a fixed policy (default deny).
 */
export type ConsentPrompt = (request: {
    toolName: string;
    origin: string;
    details?: Record<string, unknown>;
}) => Promise<ToolPermissionDecision>;
