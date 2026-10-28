/**
 * BR14a Lot 2 — @sentropic/chat-ui replay contract tests.
 *
 * Verifies the cursor shape, the `replayFromSeq` async iterable
 * contract, and the close-on-error path through a fake EventSource.
 */
import { describe, expect, it } from 'vitest';

import {
  createReplayClient,
  type ReplayClient,
  type ReplayCursor,
} from '../src/client/replay.js';
import type { ChatCoreTransport } from '../src/client/transport.js';

class FakeEventSource {
