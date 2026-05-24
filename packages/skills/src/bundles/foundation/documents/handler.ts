import { createNotBoundHandlers } from '../not-bound.js';

export const documentsToolNames = ['documents'] as const;

export const documentsHandlers = createNotBoundHandlers(
  'documents',
  documentsToolNames,
);
