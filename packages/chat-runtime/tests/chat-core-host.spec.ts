/**
 * chat-core-host.spec.ts — compile + runtime proof of the ChatCoreHost contract.
 *
 * Tests:
 * 1. A fake host literal that `satisfies ChatCoreHost` — compile-time proof.
 * 2. Trivial runtime assertion that the fake host methods exist and return
 *    the right shapes.
 * 3. Explicit public subpath registration (package.json).
 * 4. Sentropic-string scan — ZERO domain strings in the contract source file.
 *
 * Environment: node (no DOM, no Svelte rendering).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ChatCoreHost, SessionSummary, RunHandle, ModelCatalog, SendMessagePayload } from '../src/client/chat-core-host.js';
import type { StreamHubClient, StreamHubEventHandler } from '../src/client/streamTypes.js';

// ---------------------------------------------------------------------------
// 1. Fake host — compile proof (satisfies ChatCoreHost)
// ---------------------------------------------------------------------------

/**
 * A minimal fake StreamHubClient — satisfies the StreamHubClient interface
 * with no-op implementations so the fake host can include `streamClient`.
 */
const fakeStreamClient: StreamHubClient = {
  reset() {},
  clearCaches() {},
  set(_key: string, _onEvent: StreamHubEventHandler) {},
  setJobUpdates(_key: string, _onEvent: StreamHubEventHandler) {},
  setStream(_key: string, _streamId: string, _onEvent: StreamHubEventHandler) {},
  delete(_key: string) {},
};

const SESSION_A: SessionSummary = {
  id: 'session-a',
  title: 'Test session',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const RUN_HANDLE: RunHandle = {
