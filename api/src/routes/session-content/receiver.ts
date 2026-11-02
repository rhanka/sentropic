import { Hono, type Context } from 'hono';
import {
  BOOTSTRAP_STAGE_ROUTE_IDS,
  CONTENT_MOUNT,
  CONTRACT_MANIFEST_JSON_SHA256,
  CONTRACT_MANIFEST_SHA256,
  IDP_MOUNT,
  INNER_MOUNT,
  LISTING_STAGE_ROUTE_IDS,
  RELAY_MOUNT,
  RELAY_WSS_SUBPROTOCOL,
  REMOTE_MOUNT,
  RECEIVER_ROUTE_TABLE,
  type ReceiverRoute,
} from './route-table';
import {
  ReceiverRefusal,
  checkRequestMedia,
  rc0Refusal,
  refusalBody,
  refusalStatus,
} from './errors';
import type { SessionContentReceiverPorts } from './ports';
import { ACK_ROUTE_IDS, ackHandler } from './ack';
import { readBody } from './body';
import { guard } from './guard';
import { upgradeHandler } from './upgrade';

export {
  BOOTSTRAP_STAGE_ROUTE_IDS,
  CONTENT_MOUNT,
  CONTRACT_MANIFEST_JSON_SHA256,
  CONTRACT_MANIFEST_SHA256,
  IDP_MOUNT,
  INNER_MOUNT,
  LISTING_STAGE_ROUTE_IDS,
  RELAY_MOUNT,
  RELAY_WSS_SUBPROTOCOL,
  REMOTE_MOUNT,
  RECEIVER_ROUTE_TABLE,
  matchRoute,
  routeById,
} from './route-table';
export { SOURCE_AUTH_HEADER_FIXTURE } from './ports';
export * from './errors';
export type {
  BindingRecord,
  BoundContext,
  EndpointAuthorityPort,
  EventAckStore,
  PreparedTunnel,
  ReceiverHandler,
  SessionContentReceiverPorts,
  SourcePrincipal,
  TunnelRegistry,
} from './ports';
export { SOURCE_AUTH_HEADER_FIXTURE as SOURCE_AUTH_HEADERS } from './ports';

export interface SessionContentReceiver {
  readonly app: Hono;
  readonly routeTable: readonly ReceiverRoute[];
  readonly contractManifestSha256: string;
}

/** Builds the receiver app: exact frozen routes on the four mounts, source/browser/relay middleware separated. */
export const createSessionContentReceiver = (ports: SessionContentReceiverPorts): SessionContentReceiver => {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ReceiverRefusal) {
      return c.json(refusalBody(error), refusalStatus(error.family, error.code) as never);
    }
    return c.json(refusalBody(rc0Refusal('authority_unavailable')), 503);
  });

  for (const route of RECEIVER_ROUTE_TABLE) {
    const handler = async (c: Context): Promise<Response> => {
      if (route.id === 'relay-upgrade') return upgradeHandler(ports, route)(c);
      const g = await guard(c, route, ports);
      const media = checkRequestMedia(route, c.req.raw.headers);
      if (media) throw media;
      if (ACK_ROUTE_IDS.has(route.id)) return ackHandler(ports.eventAckStore, route)(c, g);
      const injected = ports.handlers[route.id];
      if (!injected) {
        throw new ReceiverRefusal(route.refusal, route.refusal === 'view' ? 'view_unavailable'
          : route.refusal === 'rc0-http' ? 'authority_unavailable' : 'relay_unavailable', true);
      }
      return injected(c, { routeId: route.id, params: g.params, body: await readBody(c, route), bound: g.bound, principal: g.principal });
    };
    app.on(route.method, route.path, handler);
  }

  // Unlisted endpoint/method under a receiver mount refuses with the mount family. Scoped per
  // mount — never a root wildcard — so the product app keeps its own 404 handling elsewhere.
  const unlisted = (c: Context): never => {
    const family = c.req.path.startsWith(`${REMOTE_MOUNT}/`) || c.req.path === REMOTE_MOUNT ? 'view'
      : c.req.path.startsWith(`${IDP_MOUNT}/`) || c.req.path === IDP_MOUNT ? 'rc0-http' : 'relay';
    throw new ReceiverRefusal(family, family === 'view' ? 'view_refused'
      : family === 'rc0-http' ? 'authority_unavailable' : 'relay_scope_refused');
  };
  for (const mount of [RELAY_MOUNT, CONTENT_MOUNT, INNER_MOUNT, REMOTE_MOUNT, IDP_MOUNT]) {
    app.all(mount, unlisted);
    app.all(`${mount}/*`, unlisted);
  }

  return { app, routeTable: RECEIVER_ROUTE_TABLE, contractManifestSha256: CONTRACT_MANIFEST_SHA256 };
};

// Product wiring (fail-closed source-gaps) is re-exported here so consumers import one entrypoint.
export { createProductSessionContentReceiver } from './product';
