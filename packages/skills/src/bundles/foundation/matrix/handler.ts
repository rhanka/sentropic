import { createNotBoundHandlers } from '../not-bound.js';

export const matrixToolNames = ['matrix_get', 'matrix_update'] as const;

export const matrixHandlers = createNotBoundHandlers('matrix', matrixToolNames);
