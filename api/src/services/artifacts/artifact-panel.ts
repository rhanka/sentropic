import { Hono } from 'hono';
import type { AppArtifactsRegistration } from './app-registration';

export const isPanelEnabled = (): boolean => process.env.CM_PANEL_ENABLED === '1';

export const isStrictHttpsOrigin = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
  } catch { return false; }
};

const isSameEnvironmentHost = (hostname: string, environment: 'preprod' | 'prod'): boolean => {
  if (environment === 'preprod') return hostname.includes('preprod') || hostname === 'localhost' || hostname === '127.0.0.1';
  return !hostname.includes('preprod') && !hostname.includes('preview') && hostname !== 'localhost' && hostname !== '127.0.0.1';
};

/** Frame ancestors come only from the registration, exact same-env https origins. */
export function resolvePanelFrameAncestors(registration: AppArtifactsRegistration): string[] {
  const ancestors = registration.embedding?.frameAncestors ?? [];
  if (!ancestors.length) throw new Error('frame_ancestors_refused');
  for (const ancestor of ancestors) {
    if (!isStrictHttpsOrigin(ancestor)) throw new Error('frame_ancestors_refused');
    if (!isSameEnvironmentHost(new URL(ancestor).hostname, registration.environment)) {
      throw new Error('frame_ancestors_refused');
    }
  }
  return [...ancestors];
}

/** Content-Security-Policy for the embeddable panel host. */
export function buildPanelCsp(registration: AppArtifactsRegistration): string {
  return `default-src 'none'; frame-ancestors ${resolvePanelFrameAncestors(registration).join(' ')}`;
}

/** Additive panel router: CSP per registration behind CM_PANEL_ENABLED. */
export function createPanelRouter(load: (slug: string) => AppArtifactsRegistration | undefined): Hono {
  const router = new Hono();
  router.get('/api/v1/panel/apps/:slug/csp', (c) => {
    if (!isPanelEnabled()) return c.json({ error: 'disabled' }, 404);
    const registration = load(c.req.param('slug'));
    if (!registration) return c.json({ error: 'unknown_app' }, 404);
    try {
      return c.json({ csp: buildPanelCsp(registration) });
    } catch {
      return c.json({ error: 'frame_ancestors_refused' }, 403);
    }
  });
  return router;
}
