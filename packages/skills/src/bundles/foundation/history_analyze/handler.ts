import { createNotBoundHandlers } from '../not-bound.js';

export const historyAnalyzeToolNames = ['history_analyze'] as const;

export const historyAnalyzeHandlers = createNotBoundHandlers(
  'history_analyze',
  historyAnalyzeToolNames,
);
