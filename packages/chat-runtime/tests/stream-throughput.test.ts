import { describe, expect, it, vi } from 'vitest';
import { StreamHistory } from '../src/client/streamHistory.js';
import type { StreamHubEvent } from '../src/client/streamTypes.js';

const contentDelta = (
  sequence: number,
  delta: string,
): StreamHubEvent => ({
  type: 'content_delta',
  streamId: 'stream-large',
  sequence,
