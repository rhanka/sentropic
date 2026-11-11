import type { AppArtifactsRegistration } from './app-registration';

export const isPanelEnabled = (): boolean => process.env.CM_PANEL_ENABLED === '1';

const isHttpsOrigin = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch { return false; }
};

/** Frame ancestors come only from the registration, exact same-env https origins. */
export function resolvePanelFrameAncestors(registration: AppArtifactsRegistration): string[] {
  const ancestors = registration.embedding?.frameAncestors ?? [];
  if (!ancestors.length || !ancestors.every(isHttpsOrigin)) throw new Error('frame_ancestors_refused');
  return [...ancestors];
}

/** Content-Security-Policy for the embeddable panel host. */
export function buildPanelCsp(registration: AppArtifactsRegistration): string {
  return `default-src 'none'; frame-ancestors ${resolvePanelFrameAncestors(registration).join(' ')}`;
}
