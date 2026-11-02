import { env } from '../../config/env';
import { isOriginAllowed, parseAllowedOrigins } from '../../utils/cors';
import { authHonoCookiePort, authHonoSessionService } from '../../services/auth/session-adapter';
import { relayRefusal } from './errors';
import { SOURCE_AUTH_HEADER_FIXTURE, type SessionContentReceiverPorts } from './ports';
import { createSessionContentReceiver, type SessionContentReceiver } from './receiver';

/**
 * Product wiring for lot RC2.receiver. Every source-gap stays fail-closed and no
 * source-gap field is filled locally:
 * - approvedTarget: the real RC1 port type, null in product until the native
 *   contribution lands (spec/REMOTE_CONTROL_RC1.md: "The default production target
 *   contribution is unavailable. Tests inject the native port").
 * - endpointAuthority (H2-I / DEP-FED) and the R-8 source-auth header pin: null until
 *   the accepted FED successor and the capsule pin land → relay_grant_unavailable.
 * - No public direct access to the virtual inner mount: resolveBoundContext is null.
 * The h2a native side is faked in tests only, never here.
 */
export const createProductSessionContentReceiver = (): SessionContentReceiver => {
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  const ports: SessionContentReceiverPorts = {
    now: () => Date.now(),
    approvedTarget: null,
    endpointAuthority: null,
    sourceAuthHeaders: SOURCE_AUTH_HEADER_FIXTURE.pinned ? SOURCE_AUTH_HEADER_FIXTURE.acceptedHeaderNames : null,
    verifySourceCredential: async () => null,
    resolveBinding: async () => null,
    resolveBoundContext: () => null,
    tunnels: {
      lookup: () => null,
      consume: () => ({ refusal: 'relay_scope_refused' }),
    },
    resolveBrowserSession: async (c) => {
      const token = authHonoCookiePort.readSessionToken(c.req.raw);
      if (!token) return null;
      const validated = await authHonoSessionService.validateSessionToken(token);
      if (!validated) return null;
      const origin = c.req.header('origin');
      return {
        userId: validated.session.userId,
        sid: validated.sessionRecord.id,
        originOk: !origin || isOriginAllowed(origin, allowedOrigins),
      };
    },
    eventAckStore: {
      commitActivation: () => { throw relayRefusal('relay_unavailable', true); },
      commitEvents: () => { throw relayRefusal('relay_unavailable', true); },
      commitProjection: () => { throw relayRefusal('relay_unavailable', true); },
      commitChat: () => { throw relayRefusal('relay_unavailable', true); },
    },
    registry: null,
    handlers: {},
    purposeCurrent: async () => false,
    policySupplementAccepted: false,
  };
  return createSessionContentReceiver(ports);
};
