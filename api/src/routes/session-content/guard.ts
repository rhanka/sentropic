import type { Context } from 'hono';
import {
  BOOTSTRAP_STAGE_ROUTE_IDS,
  LISTING_STAGE_ROUTE_IDS,
  mountOfPath,
  type ReceiverRoute,
} from './route-table';
import {
  ReceiverRefusal,
  type RelayErrorCode,
} from './errors';
import type {
  BindingRecord,
  BoundContext,
  SessionContentReceiverPorts,
  SourcePrincipal,
} from './ports';

export function fail(route: ReceiverRoute, code: RelayErrorCode | string, retryable = false): never {
  throw new ReceiverRefusal(route.refusal, code, retryable);
}

/** Source credential on an exact capsule-pinned header (R-8). Unpinned → fail-closed grant gap. */
const sourcePrincipal = async (
  c: Context,
  ports: SessionContentReceiverPorts,
  route: ReceiverRoute,
): Promise<SourcePrincipal> => {
  const pinned = ports.sourceAuthHeaders;
  if (pinned === null || pinned.length === 0) fail(route, 'relay_grant_unavailable', true);
  for (const name of pinned) {
    const value = c.req.header(name);
    if (value) {
      const principal = await ports.verifySourceCredential(name, value);
      if (!principal) fail(route, 'relay_auth_required');
      return principal;
    }
  }
  fail(route, 'relay_auth_required');
};

export interface GuardOk {
  readonly bound: BoundContext | null;
  readonly principal: SourcePrincipal | null;
  readonly binding: BindingRecord | null;
  readonly params: Record<string, string>;
}

/**
 * Before-body guard (R-2), in the contract model's order: authentication precedes payload
 * acquisition, cursor resolution and dedupe; no body byte is read and no handler runs on refusal.
 */
export const guard = async (c: Context, route: ReceiverRoute, ports: SessionContentReceiverPorts): Promise<GuardOk> => {
  const params = c.req.param() as Record<string, string>;
  const mount = mountOfPath(route.path);

  // Outer relay mount: machine only — cookies, browser Origin, CORS, redirects and URL/query bearers refuse.
  if (route.lane === 'outer') {
    if (c.req.header('cookie') || c.req.header('origin')) fail(route, 'relay_origin_refused');
    const url = new URL(c.req.url);
    for (const [key, value] of url.searchParams) {
      if (/bearer|token|credential/i.test(key) || /bearer|token/i.test(value)) fail(route, 'relay_protocol_refused');
    }
  }

  // Authentication per authority class.
  let principal: SourcePrincipal | null = null;
  let bound: BoundContext | null = null;
  if (route.lane === 'outer') {
    if (!ports.endpointAuthority) fail(route, 'relay_grant_unavailable', true); // DEP-FED source-gap stays fail-closed
    const caller = await ports.endpointAuthority.authenticateInstallation(c.req.raw);
    if (!caller) fail(route, 'relay_auth_required');
  } else if (route.lane === 'browser') {
    const session = await ports.resolveBrowserSession(c);
    // CHAIN-MOUNT: the browser mount rejects source-only credentials — a source-auth
    // header or Bearer token never authenticates a browser route, only the cookie session does.
    const sourceOnly = (ports.sourceAuthHeaders ?? []).some((name) => c.req.header(name))
      || (c.req.header('authorization')?.startsWith('Bearer ') ?? false);
    if (!session || sourceOnly) fail(route, 'authentication_required');
    if (session && !session.originOk) fail(route, 'view_refused');
  } else if (route.lane === 'internal') {
    fail(route, 'authority_unavailable'); // isolated policy workload; SG-R15 stays fail-closed in product
  } else {
    bound = ports.resolveBoundContext(c);
    if (!bound) fail(route, 'relay_auth_required'); // no public direct access to the virtual inner mount
    principal = await sourcePrincipal(c, ports, route);
  }

  // Owner/scope resolution after authenticated identifier resolution; no path may escape its admitted session/scope.
  let binding: BindingRecord | null = null;
  if (params.bindingId !== undefined) {
    binding = await ports.resolveBinding(params.bindingId);
    if (!binding) fail(route, 'relay_scope_refused');
    if (principal && principal.ownerId !== binding.ownerId) fail(route, 'relay_scope_refused'); // owner rejection
    if (principal && params.sourceSessionId !== undefined && binding.sourceSessionId !== params.sourceSessionId) {
      fail(route, 'relay_scope_refused'); // foreign session scope
    }
  }
  if (mount === 'inner' && bound && params.sessionId !== bound.sessionRef.sessionId) {
    fail(route, 'relay_scope_refused'); // :sessionId must match the bound connection
  }

  // Stage/engine/lane admission on the bound carrier (W04 closed route→lane table).
  if (bound) {
    if (bound.stage === 'bootstrap' && bound.engineKind !== 'cli') fail(route, 'relay_scope_refused');
    if (!route.stages.includes(bound.stage)) fail(route, 'relay_scope_refused');
    if (!route.engines.includes(bound.engineKind)) fail(route, 'relay_scope_refused');
    if (route.lane !== bound.lane) fail(route, 'relay_lane_refused'); // wrong-lane refusal before handler/body
    if (bound.stage === 'listing' && !(LISTING_STAGE_ROUTE_IDS as readonly string[]).includes(route.id)) {
      fail(route, 'relay_scope_refused');
    }
    if (bound.stage === 'bootstrap' && !(BOOTSTRAP_STAGE_ROUTE_IDS as readonly string[]).includes(route.id)) {
      fail(route, 'relay_scope_refused');
    }
    if ((route.id === 'listing-publish' || route.id === 'freshness-publish')
      && bound.stage !== 'bound' && bound.visibility !== 'listing') fail(route, 'relay_scope_refused');
    if ((route.id === 'listing-publish' || route.id === 'freshness-publish')
      && bound.visibility !== 'activated' && !bound.sourceAck) fail(route, 'relay_consent_refused');
  }

  // R15 supplement gate on the policy routes: unknown/unaccepted supplement refuses before policy handling.
  if ((route.id === 'policy-intent' || route.id === 'policy-confirm' || route.id === 'policy-idp')
    && !ports.policySupplementAccepted) fail(route, 'unsupported_version');

  // Purpose/consent currency.
  if (binding && !(await ports.purposeCurrent(route.authority, { binding, bound }))) {
    fail(route, route.refusal === 'view' ? 'view_refused' : 'relay_consent_refused');
  }
  return { bound, principal, binding, params };
};
