import { createNotBoundHandlers } from '../not-bound.js';

export const solutionsToolNames = ['solutions_list', 'solution_get'] as const;
export const solutionsHandlers = createNotBoundHandlers('solutions', solutionsToolNames);
