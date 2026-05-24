import { createNotBoundHandlers } from '../not-bound.js';

export const initiativesToolNames = [
  'initiatives_list',
  'read_initiative',
  'update_initiative',
] as const;

export const initiativesHandlers = createNotBoundHandlers(
  'initiatives',
  initiativesToolNames,
);
