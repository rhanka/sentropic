import { describe, expect, it } from 'vitest';
import {
  getProjectedRunTerminalOutcome,
  projectAssistantRunSegments,
  type ProjectedRunSegment,
  type ProjectionStreamEvent,
} from '../src/utils/chat-run-projection.js';
import {
  buildFallbackProjectedSegments,
  buildProjectedTimeline,
  type ChatMessageAttachment,
  type ChatProjectionComputation,
  type ChatProjectionMessage,
} from '../src/state/chatProjection.js';

type Message = ChatProjectionMessage & {
  sessionId?: string;
  feedbackVote?: number | null;
};

const user = (id: string, content = id): Message => ({
  id,
  role: 'user',
  content,
});

const assistant = (
  id: string,
  input: Partial<Message> = {},
): Message => ({
  id,
  role: 'assistant',
  ...input,
});

const assistantSegment = (
  id: string,
  content: string,
): ProjectedRunSegment => ({
  id,
  kind: 'assistant',
  events: [],
  content,
  steerCountBefore: 0,
});

const runtimeSegment = (
  id: string,
  steerCountBefore = 0,
): ProjectedRunSegment => ({
  id,
  kind: 'runtime',
  events: [],
  content: '',
  steerCountBefore,
});

const computation = (
  segments: ProjectedRunSegment[],
  linkedSteerCount = 0,
  terminalOutcome: ChatProjectionComputation['terminalOutcome'] = null,
): ChatProjectionComputation => ({
  segments,
  linkedSteerCount,
  terminalOutcome,
});

describe('chat projection timeline', () => {
  it('keeps typed message attachments on projected user messages', () => {
    const attachments: ChatMessageAttachment[] = [
      {
        id: 'att_1',
        kind: 'image',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 12_345,
        state: 'ready',
        previewUrl: 'blob:diagram',
      },
    ];
    const message: ChatProjectionMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      attachments,
    };
