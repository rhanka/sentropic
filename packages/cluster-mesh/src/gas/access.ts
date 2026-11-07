// Read-path gate: identity -> tenant -> (caller lookup) -> exactly one dossier.view audit event. e.parameter never
// takes part in tenant resolution. Synchronous; every failure path is a fixed refusal with no store access.
import { TenantBoundaryError } from '../errors.js';
import type { MembershipLookup, TenantResidenceContext, ValidatedTenantMembership } from '../boundaries.js';
import type { SyncMembershipPort } from './boundary.js';
import { domainOfIssuer, workspaceIdForDomain, type InspectableViewerIdentityPort, type ViewerIdentity, type ViewerIdentityPort } from './identity.js';

export const ACCESS_REFUSED_HTML = '<!doctype html><html><body><h1>Access refused</h1></body></html>';

/** S1 membership: tenantId fixed per deployment, approved iff the workspace is workspace:<pinned domain> and the user is in it. */
export function createStaticMembership(input: { readonly tenantId: string; readonly domains: readonly string[] }): SyncMembershipPort {
  const domains = input.domains.map((d) => d.toLowerCase());
  return {
    resolveApproved(lookup: MembershipLookup): ValidatedTenantMembership | null {
      const at = lookup.userId.lastIndexOf('@');
      const domain = at < 0 ? '' : lookup.userId.slice(at + 1);
      if (!domain || domains.indexOf(domain) === -1 || lookup.workspaceId !== workspaceIdForDomain(domain)) return null;
      return { tenantId: input.tenantId, userId: lookup.userId, status: 'approved' };
    },
  };
}

export interface LogPort {
  log(event: Record<string, unknown>): void;
}
export interface ReadTarget {
  readonly artifactId: string;
  readonly version: number;
  readonly payloadSha256: string;
}
export type ReadOutcome =
  | { readonly kind: 'view'; readonly identity: ViewerIdentity; readonly context: TenantResidenceContext; readonly target: ReadTarget }
  | { readonly kind: 'not_found'; readonly identity: ViewerIdentity; readonly context: TenantResidenceContext }
  | { readonly kind: 'refused'; readonly html: string; readonly reason: 'no_identity' | 'tenant_membership_required' | 'audit_unavailable' };

export function createDossierAccess(input: {
  readonly identity: ViewerIdentityPort | InspectableViewerIdentityPort;
  readonly boundary: { resolve(lookup: MembershipLookup): TenantResidenceContext };
  readonly log: LogPort;
  readonly clock: () => Date;
}) {
  const inspectable = input.identity as Partial<InspectableViewerIdentityPort>;
  function emit(event: Record<string, unknown>): void {
    input.log.log({ ...event, ts: input.clock().toISOString() });
  }
  function refuse(reason: 'no_identity' | 'tenant_membership_required' | 'audit_unavailable', fields: Record<string, unknown>): ReadOutcome {
    try {
      emit({ event: 'dossier.denied', outcome: reason, ...fields });
    } catch {
      // a refusal never depends on the log succeeding
    }
    return { kind: 'refused', html: ACCESS_REFUSED_HTML, reason };
  }
  return {
    /** `_e` is deliberately unused: the request can never select the tenant. */
    serve(_e: unknown, lookup: (context: TenantResidenceContext) => ReadTarget | null): ReadOutcome {
      let identity: ViewerIdentity | null = null;
      let email: string | null = null;
      try {
        if (inspectable.inspect) {
          const r = inspectable.inspect();
          identity = r.identity;
          email = r.email;
        } else identity = input.identity.current();
      } catch {
        identity = null;
      }
      if (!identity) return refuse('no_identity', email ? { subject: email } : {});
      let context: TenantResidenceContext;
      try {
        context = input.boundary.resolve({ workspaceId: workspaceIdForDomain(domainOfIssuer(identity.issuer)), userId: identity.subject });
      } catch (e) {
        if (e instanceof TenantBoundaryError) return refuse('tenant_membership_required', { issuer: identity.issuer, subject: identity.subject });
        return refuse('tenant_membership_required', { issuer: identity.issuer, subject: identity.subject });
      }
      const target = lookup(context);
      if (!target) return { kind: 'not_found', identity, context };
      try {
        emit({ event: 'dossier.view', issuer: identity.issuer, subject: identity.subject, tid: context.tid, artifactId: target.artifactId, version: target.version, payloadSha256: target.payloadSha256, outcome: 'ok' });
      } catch {
        return refuse('audit_unavailable', { issuer: identity.issuer, subject: identity.subject });
      }
      return { kind: 'view', identity, context, target };
    },
  };
}

/** Index page filter: only dossiers of the viewer's tenant. */
export function listReadable<T extends { readonly tenantId: string }>(context: TenantResidenceContext, entries: readonly T[]): T[] {
  return entries.filter((e) => e.tenantId === context.tid);
}
