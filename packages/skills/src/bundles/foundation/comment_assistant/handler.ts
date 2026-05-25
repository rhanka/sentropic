import { createNotBoundHandlers } from '../not-bound.js';

export const commentAssistantToolNames = ['comment_assistant'] as const;

export const commentAssistantHandlers = createNotBoundHandlers(
  'comment_assistant',
  commentAssistantToolNames,
);
