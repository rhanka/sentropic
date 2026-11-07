// SSO identity port for GAS (spec §3). The identity is ASSERTED by the GAS platform (USER_ACCESSING), not verified here.
// Fail closed: any anomaly yields null. The allowed-domain list is a build-time constant; empty refuses everyone.
export interface ViewerIdentity {
  readonly issuer: string; // "google-workspace:<domain>"
  readonly subject: string; // lower-cased email
}
export interface ViewerIdentityPort {
  current(): ViewerIdentity | null;
}
export interface ViewerInspection {
  readonly identity: ViewerIdentity | null;
  /** Lower-cased email when one was read, even if refused (for the denial audit line). */
  readonly email: string | null;
}
export interface InspectableViewerIdentityPort extends ViewerIdentityPort {
  inspect(): ViewerInspection;
}
export interface SessionLike {
  getActiveUser(): { getEmail(): string };
}

export const ISSUER_PREFIX = 'google-workspace:';

export function createGasViewerIdentity(input: {
  readonly session: SessionLike;
  readonly allowedDomains: readonly string[];
}): InspectableViewerIdentityPort {
  const allowed = input.allowedDomains.map((d) => String(d).trim().toLowerCase()).filter((d) => d.length > 0);
  function inspect(): ViewerInspection {
    let raw: unknown;
    try {
      raw = input.session.getActiveUser().getEmail();
    } catch {
      return { identity: null, email: null };
    }
    if (typeof raw !== 'string') return { identity: null, email: null };
    const email = raw.trim().toLowerCase();
    if (email.length === 0) return { identity: null, email: null };
    const parts = email.split('@');
    const [local, domain] = parts;
    if (parts.length !== 2 || !local || !domain || /\s/.test(email)) return { identity: null, email };
    if (allowed.indexOf(domain) === -1) return { identity: null, email };
    return { identity: { issuer: ISSUER_PREFIX + domain, subject: email }, email };
  }
  return { inspect, current: () => inspect().identity };
}

export function domainOfIssuer(issuer: string): string {
  return issuer.slice(ISSUER_PREFIX.length);
}
export function workspaceIdForDomain(domain: string): string {
  return `workspace:${domain}`;
}
