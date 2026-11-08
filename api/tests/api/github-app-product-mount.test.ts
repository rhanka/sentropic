import { afterEach, describe, expect, it, vi } from 'vitest';

// The SG0-app mount composes when the app module loads: provision it first.
vi.hoisted(() => {
  process.env.GITHUB_APP_PUBLIC_BASE_URL = 'https://sentropic.product-mount.example';
  process.env.GITHUB_APP_TARGETS_JSON = JSON.stringify([
    { locator: 'rhanka/radar-immobilier', storageScopeId: 'product-scope-immo', repoId: 'product-repo-immo' },
    { locator: 'rhanka/sentropic', storageScopeId: 'product-scope-app', repoId: 'product-repo-app' },
  ]);
  process.env.SECRET_ENCRYPTION_KEY = 'github-app-product-mount-test-only-key';
});

import { app } from '../../src/app';
import { env } from '../../src/config/env';
import { pool } from '../../src/db/client';
import { createProductGitHubAppRouter } from '../../src/routes/github-app';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

/**
 * A-LIVE W1 — the SG0-app host as the PRODUCT app serves it: mounted under
 * `/api/v1/github-app` (the ui nginx `/api/v1/` proxy), with the product-wide
 * secure headers kept off these paths, an explicit enroll target for both
 * registry repositories, and a mount gate that refuses an unprovisioned
 * custody key.
 */
const BASE = 'https://sentropic.product-mount.example';
const ROOT = '/api/v1/github-app';
const PACKAGE_CSP = "default-src 'none'; form-action https://github.com 'self'; base-uri 'none'; frame-ancestors 'none'";

const expectSg0AppHeaders = (response: Response) => {
  expect(response.headers.get('content-security-policy')).toBe(PACKAGE_CSP);
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('cache-control')).toBe('no-store');
};

describe('SG0-app product mount (A-LIVE W1)', () => {
  const refs: string[] = [];

  afterEach(async () => {
    if (refs.length) {
      await pool.query('DELETE FROM control.github_app_enrollments WHERE installation_ref = ANY($1)', [refs]);
      refs.length = 0;
    }
    await cleanupAuthData();
  });

  it('should keep the router CSP and referrer policy on refusals instead of the product-wide headers', async () => {
    const refused = await app.request(ROOT);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'access_denied' });
    expectSg0AppHeaders(refused);
    const prompt = await app.request(`${ROOT}/enroll_00000000-0000-4000-8000-000000000000`);
    expect(prompt.status).toBe(403);
    expectSg0AppHeaders(prompt);
  });

  it('should enroll both registry targets through the public mount and allow the manifest POST to github.com', async () => {
    const owner = await createAuthenticatedUser('admin_app');
    const cookie = `session=${owner.sessionToken}`;
    const landing = await app.request(ROOT, { headers: { cookie } });
    expect(landing.status).toBe(200);
    expectSg0AppHeaders(landing);
    const html = await landing.text();
    expect(html).toContain(`action="${ROOT}/enroll?target=radar-immobilier"`);
    expect(html).toContain(`action="${ROOT}/enroll?target=sentropic"`);

    const missingTarget = await app.request(`${ROOT}/enroll`, { method: 'POST', headers: { cookie, origin: BASE } });
    expect(missingTarget.status).toBe(403);

    for (const [target, locator] of [['radar-immobilier', 'rhanka/radar-immobilier'], ['sentropic', 'rhanka/sentropic']]) {
      const begin = await app.request(`${ROOT}/enroll?target=${target}`, { method: 'POST', headers: { cookie, origin: BASE } });
      expect(begin.status).toBe(303);
      const location = begin.headers.get('location')!;
      expect(location).toMatch(new RegExp(`^${BASE}${ROOT}/enroll_[0-9a-f-]{36}$`));
      const ref = location.slice(`${BASE}${ROOT}/`.length);
      refs.push(ref);

      const prompt = await app.request(`${ROOT}/${ref}`, { headers: { cookie } });
      expect(prompt.status).toBe(200);
      expectSg0AppHeaders(prompt);
      const page = await prompt.text();
      expect(page).toContain('action="https://github.com/settings/apps/new?state=');
      expect(page).toContain(`Enroll ${locator}`);
      expect(page).toContain(`${BASE}${ROOT}/${ref}/manifest`);
      expect(page).toContain(`${BASE}${ROOT}/${ref}/installation`);
    }
  });

  it('should refuse to mount without a provisioned custody key, including the committed dev seed', () => {
    const provisioned = env.SECRET_ENCRYPTION_KEY;
    try {
      expect(createProductGitHubAppRouter()).not.toBeNull();
      env.SECRET_ENCRYPTION_KEY = undefined;
      expect(createProductGitHubAppRouter()).toBeNull();
      env.SECRET_ENCRYPTION_KEY = '';
      expect(createProductGitHubAppRouter()).toBeNull();
      env.SECRET_ENCRYPTION_KEY = 'dev-secret-key-change-in-production-please';
      expect(createProductGitHubAppRouter()).toBeNull();
    } finally {
      env.SECRET_ENCRYPTION_KEY = provisioned;
    }
  });
});
