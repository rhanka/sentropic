import { createNotBoundHandlers } from '../not-bound.js';

export const planToolNames = ['plan'] as const;

export const planHandlers = createNotBoundHandlers('plan', planToolNames);
