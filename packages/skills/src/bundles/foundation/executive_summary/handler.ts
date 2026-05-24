import { createNotBoundHandlers } from '../not-bound.js';

export const executiveSummaryToolNames = [
  'executive_summary_get',
  'executive_summary_update',
] as const;

export const executiveSummaryHandlers = createNotBoundHandlers(
  'executive_summary',
  executiveSummaryToolNames,
);
