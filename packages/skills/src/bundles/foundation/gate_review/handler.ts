import { createNotBoundHandlers } from '../not-bound.js';

export const gateReviewToolNames = ['gate_review'] as const;

export const gateReviewHandlers = createNotBoundHandlers(
  'gate_review',
  gateReviewToolNames,
);
