import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// This lane consumes human-prepared, disposable state; it never seeds or manufactures proof.
test.describe('D2 real-source Sessions witness', () => {
  test('reads a post-consent source marker through the delivered page without another consent', async ({ browser }, testInfo) => {
    expect(process.env.SESSION_CONTENT_QUALIFICATION_MODE, 'Explicit real qualification required (CM2-F2, CM2-N5-AUTH/CONTROL); this lane cannot skip or count as CI denial').toBe('real');
    expect(testInfo.config.configFile, 'Use the dedicated configuration without seed/global setup').toMatch(/playwright\.session-content-qualification\.config\.ts$/);
    const manifest = JSON.parse(readFileSync('.auth/session-content-qualification/manifest.json', 'utf8'));
    expect(manifest.appSha).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.runtimeSha).toMatch(/^[0-9a-f]{40}$/);
    // Actual deployed OIDC policy and delivered capsule pins, never local RP enrollment.
    const lock = manifest.fixtureLock;
    expect(lock).toMatchObject({ lockVersion: 1, contentProtocol: 2, archiveVersion: 1 });
    for (const field of ['hostBuildHash', 'exporterBuildHash', 'capsuleManifestSha256', 'oidcPolicyFixtureSha256']) {
      expect(lock[field]).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(lock.h2aGitSha).toBe(manifest.runtimeSha);
    expect(lock.sentropicGitSha).toBe(manifest.appSha);
    expect(lock.h2aPackageVersion).toBe('0.98.10-cm2-f2.1');
    expect(lock.h2aPackageIntegrity).toMatch(/^sha512-/);
    expect(lock.providerTuples.length).toBeGreaterThan(0);
    expect(manifest.oidcPolicy).toMatchObject({ forceReauthEveryAuthorization: true,
      requiredAcr: 'urn:sentropic:loa:passkey-fresh', requiredAmr: ['hwk', 'user', 'mfa'],
      requireUserVerification: true, denyWeakFallback: true, maxConfirmationSeconds: 60, maxClockErrorMs: 5000 });
    expect(manifest.oidcPolicy.sourceClientId).not.toBe(manifest.oidcPolicy.confirmationClientId);
    expect(manifest.oidcPolicy.policyRevision).toBe(lock.oidcPolicyRevision);
    expect(manifest.uiBaseUrl).toBe('http://localhost:5582');
    expect(manifest.apiBaseUrl).toBe('http://localhost:9382');
    for (const name of ['workspaceId', 'bindingId', 'freshMarker', 'priorMarker', 'excludedMarker']) {
      expect(typeof manifest[name]).toBe('string'); expect(manifest[name].length).toBeGreaterThan(0);
    }
    const context = await browser.newContext({ storageState: '.auth/session-content-qualification/viewer.json' });
    try {
      const metadataResponse = await context.request.get(`${manifest.apiBaseUrl}/api/v1/auth/session/content/workspaces/${encodeURIComponent(manifest.workspaceId)}/sessions`,
        { headers: { origin: manifest.uiBaseUrl, 'x-session-content': 'browser' } });
      expect(metadataResponse.ok()).toBeTruthy();
      const metadata = await metadataResponse.json();
      expect(metadata.sourceVerified, 'CM2-F2: qualify the actual authenticated source and native-verified content consent first').toBe(true);
      expect(metadata.items.some((row: { bindingId: string }) => row.bindingId === manifest.bindingId)).toBe(true);
      const page = await context.newPage();
      const activations: string[] = [];
      page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/consent')) activations.push(req.url()); });
      await page.goto(`${manifest.uiBaseUrl}/sessions`);
      await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Lire les copies autorisées', exact: true }).first().click();
      const output = page.getByRole('region', { name: 'Sortie de session', exact: true }).first();
      await expect(output).toContainText(manifest.freshMarker);
      await expect(output).not.toContainText(manifest.priorMarker);
      await expect(output).not.toContainText(manifest.excludedMarker);
      expect(activations).toEqual([]);
    } finally { await context.close(); }
  });
});
