import { createNotBoundHandlers } from '../not-bound.js';

export const proposalsToolNames = ['proposals_list', 'proposal_get'] as const;
export const proposalsHandlers = createNotBoundHandlers('proposals', proposalsToolNames);
