/**
 * BR14b Lot 14b — chat-session-history thin shim.
 *
 * The pure history projection helpers (`buildChatHistoryTimeline`,
 * `compactChatHistoryTimelineForSummary`, `buildAssistantMessageHistoryDetails`,
 * `projectChatHistorySegments`) and their types (`ChatHistoryStreamEvent`,
 * `ChatHistoryRunSegment`, `ChatHistoryMessage`, `ChatHistoryTimelineItem`)
 * were moved to `packages/chat-core/src/history.ts` as a prerequisite of
 * migrating the 3 read-only composers (`getSessionBootstrap`,
 * `getSessionHistory`, `getMessageRuntimeDetails`) into `ChatRuntime`.
 *
 * This file re-exports the chat-core surface so api-side call sites
 * (chat-service.ts and existing test fixtures) keep their import path
 * stable.
 */
export {
  buildAssistantMessageHistoryDetails,
  buildChatHistoryTimeline,
  compactChatHistoryTimelineForSummary,
  projectChatHistorySegments,
  type ChatHistoryMessage,
  type ChatHistoryRunSegment,
  type ChatHistoryStreamEvent,
  type ChatHistoryTimelineItem,
} from '../../../packages/chat-core/src/history';
