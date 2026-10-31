import { createCatalogContextResolver } from '../../../src/services/catalog/request-context';

/** Test-only authority reader. Product callers use the database-backed resolver. */
export const testCatalogContext = (allowedTools: readonly string[]) =>
  createCatalogContextResolver(async () => ({ tenantId: 'tenant-test', membershipRef: 'member-test',
    consentRef: 'first-party-test', policyVersion: 'v1', readOnly: false,
    roles: ['editor'], workspaceType: 'ai-priorities', allowedTools }))({
    kind: 'http', userId: 'user-test', sessionId: 'session-test', workspaceId: 'workspace-test',
  });
