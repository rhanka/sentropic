/**
 * A0a rung-1 projection parity tests.
 *
 * Golden SSE event sequences are loaded from fixtures/streams/*.ndjson
 * and run through the published projection helpers:
 *   - projectAssistantRunSegments  (utils/chat-run-projection)
 *   - mergeProjectionHistoryEvents / appendLiveProjectionEvent
 *   - buildProjectedTimeline       (state/chatProjection)
 *   - buildFallbackProjectedSegments
 *
 * These tests are the regression oracle for the A1 extraction (WP-CHAT).
 * They run in --environment node with zero browser/Svelte dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  projectAssistantRunSegments,
  countLinkedSteerMessages,
  mergeProjectionHistoryEvents,
  appendLiveProjectionEvent,
  type ProjectionStreamEvent,
} from '../src/utils/chat-run-projection.js';

import {
  buildProjectedTimeline,
  buildFallbackProjectedSegments,
  type ChatProjectionMessage,
  type ChatProjectionComputation,
} from '../src/state/chatProjection.js';

// ---------------------------------------------------------------------------
// Fixture loading helpers
// The Makefile runs vitest from /workspace/packages/chat-ui (process.cwd()).
// ---------------------------------------------------------------------------
const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'streams');

function loadNdjson(filename: string): ProjectionStreamEvent[] {
  const text = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ProjectionStreamEvent);
}

function makeComputation(events: readonly ProjectionStreamEvent[]): ChatProjectionComputation {
  return {
    segments: projectAssistantRunSegments(events),
    linkedSteerCount: countLinkedSteerMessages(events),
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: simple-assistant-response
// status(seq=1) → content_delta(seq=2..4) → done(seq=5)
//
// Observed behavior (golden):
//   - status event → runtime segment
//   - content_delta events → assistant segment
