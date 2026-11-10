import { createHash } from 'node:crypto';

/**
 * CM authority id of a tenant-less OAuth consent. It is disjoint from every tenant-keyed id
 * (`cmOAuthConsentId`: JSON null against a string), and control migration 0022 (A1-REKEY) computes
 * the same digest in SQL.
 */
export const cmTenantlessOAuthConsentId = (userId: string, clientId: string): string =>
  createHash('sha256').update(JSON.stringify(['app-oauth-consent', userId, clientId, null])).digest('hex');
