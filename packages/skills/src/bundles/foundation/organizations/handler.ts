import { createNotBoundHandlers } from '../not-bound.js';

export const organizationsToolNames = [
  'organizations_list',
  'organization_get',
  'organization_update',
] as const;

export const organizationsHandlers = createNotBoundHandlers(
  'organizations',
  organizationsToolNames,
);
