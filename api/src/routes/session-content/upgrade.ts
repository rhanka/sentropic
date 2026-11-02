import type { Context } from 'hono';
import { RELAY_WSS_SUBPROTOCOL, type ReceiverRoute } from './route-table';
import { relayRefusal } from './errors';
import type { SessionContentReceiverPorts } from './ports';

/** Relay upgrade (CHAIN-MOUNT): every tunnel/protocol check refuses before HTTP 101 and before body allocation. */
export const upgradeHandler = (ports: SessionContentReceiverPorts, route: ReceiverRoute) => async (c: Context) => {
  if (c.req.header('cookie') || c.req.header('origin')) throw relayRefusal('relay_origin_refused');
  // Bodyless upgrade (r3 N2): any entity bytes refuse before 101 and before allocation.
  // c.req.header() returns undefined (not null) for absent headers — test with undefined.
  const declared = c.req.header('content-length');
  if ((declared !== undefined && declared !== '0') || c.req.header('transfer-encoding') !== undefined) {
    throw relayRefusal('relay_protocol_refused');
  }
  if (new Uint8Array(await c.req.raw.arrayBuffer()).byteLength > 0) {
    throw relayRefusal('relay_protocol_refused');
  }
  const subprotocols = (c.req.header('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  if (!c.req.header('upgrade') || c.req.header('upgrade')?.toLowerCase() !== 'websocket'
    || subprotocols.length !== 1 || subprotocols[0] !== RELAY_WSS_SUBPROTOCOL) {
    throw relayRefusal('relay_protocol_refused'); // wrong protocol refuses before 101
  }
  if (!ports.endpointAuthority) throw relayRefusal('relay_grant_unavailable', true);
  const caller = await ports.endpointAuthority.authenticateInstallation(c.req.raw);
  if (!caller) throw relayRefusal('relay_auth_required');
  const tunnelId = c.req.param('tunnelId') ?? '';
  const tunnel = ports.tunnels.lookup(tunnelId);
  if (!tunnel) throw relayRefusal('relay_scope_refused'); // foreign/unknown tunnel
  if (tunnel.adjacency.toInstanceId !== caller.instanceId) throw relayRefusal('relay_scope_refused');
  if (tunnel.audience !== caller.audience) throw relayRefusal('relay_auth_required'); // wrong audience
  const consumed = ports.tunnels.consume(tunnelId, ports.now());
  if ('refusal' in consumed) throw relayRefusal(consumed.refusal); // stale (expired) or replayed (consumed) tunnel
  // Admission marker: the actual HTTP 101 is emitted by the WebSocket server layer of the
  // relay adapter (RC2.relay); this route owns every pre-101 fence and never answers 101 itself.
  return c.json({ admitted: true, tunnelId, subprotocol: RELAY_WSS_SUBPROTOCOL }, 200, {
    'x-session-relay-upgrade': 'admitted',
    'sec-websocket-protocol': RELAY_WSS_SUBPROTOCOL,
  });
};
