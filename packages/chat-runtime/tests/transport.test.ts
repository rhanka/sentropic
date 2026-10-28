/**
 * BR14a Lot 2 — @sentropic/chat-ui transport contract tests.
 *
 * Verifies the interface shape of `createDefaultTransport` without
 * touching the network: `fetch` and `EventSource` are replaced by
 * lightweight stubs for the lifetime of each test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
