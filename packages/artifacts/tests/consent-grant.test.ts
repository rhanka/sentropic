import { describe, expect, it, vi } from 'vitest';
import { createReaderConsentService, consentScreenPath, readerConsentRequired,
  renderConsentScreen } from '../src/server/consent-grant.js';
import { createMemoryReaderConsentStore } from '../src/server/reader-store.js';

const input = { readerAccountId: 'reader', artifactId: 'artifact',
  scopeId: 'reports.read', scopeVersion: 'v1' };
const makeService = () => {
  const store = createMemoryReaderConsentStore();
  return { store, service: createReaderConsentService({ store, storageScopeId: 'acme',
    canReadArtifact: async () => true, isAdmin: async () => false,
    now: () => '2026-11-06T00:00:00.000Z' }) };
};

describe('public generic reader grant contract', () => {
  it('should grant once with fresh rights and open the gate at the accepted version', async () => {
    const { service } = makeService();
    expect(await service.evaluateGate({ ...input, rights: 'ok' })).toEqual({
      allowed: false, refusal: 'reader_consent_required', scopeId: input.scopeId });
    expect(readerConsentRequired(input.scopeId)).toEqual({
      code: 'reader_consent_required', scopeId: input.scopeId, retryable: false });
    const checkRights = vi.fn(async () => true);
    await service.grantWithFreshRights(input, checkRights);
    expect(checkRights).toHaveBeenCalledTimes(1);
    expect(await service.evaluateGate({ ...input, rights: 'ok' })).toEqual({ allowed: true });
    expect(await service.evaluateGate({ ...input, scopeVersion: 'v2', rights: 'ok' }))
      .toMatchObject({ allowed: false, refusal: 'reader_consent_required' });
    expect(await service.evaluateGate({ ...input, rights: 'withdrawn' }))
      .toEqual({ allowed: false, refusal: 'refused', status: 404 });
    await service.revokeOwnConsent(input);
    expect(await service.evaluateGate({ ...input, rights: 'ok' }))
      .toMatchObject({ allowed: false, refusal: 'reader_consent_required' });
  });

  it('should refuse a grant without fresh rights before any store write', async () => {
    const { store, service } = makeService();
    const grant = vi.spyOn(store, 'grantConsent');
    await expect(service.grantWithFreshRights(input, async () => false)).rejects.toThrow('access_denied');
    expect(grant).not.toHaveBeenCalled();
  });

  it('should preserve the workspace and escape host content in the single grant form', () => {
    const path = consentScreenPath('artifact&other', 'reports.read', 'workspace B&other=value');
    const url = new URL(path, 'https://control.example.test/');
    expect(url.searchParams.get('artifactId')).toBe('artifact&other');
    expect(url.searchParams.get('workspace_id')).toBe('workspace B&other=value');
    expect([...url.searchParams.keys()]).toEqual(['artifactId', 'scopeId', 'workspace_id']);
    const html = renderConsentScreen({ ...input, workspaceId: 'workspace B&other=value',
      brand: 'Acme <reader>', title: 'Allow "reports"', supportUrl: 'https://support.test/?a=1&b=2' });
    expect(html).toContain('Acme &lt;reader&gt;');
    expect(html).toContain('Allow &quot;reports&quot;');
    expect(html).toContain('https://support.test/?a=1&amp;b=2');
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain('method="post" action="grant?workspace_id=workspace%20B%26other%3Dvalue"');
    expect(html).toContain('name="scopeVersion" value="v1"');
  });
});
