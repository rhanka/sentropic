import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { parseContentHost } from '@sentropic/artifacts/content/routing';
import type { LiveProxy } from './live';

/** A raw, credential-free Vite tunnel. No release grant can authorize an upgrade. */
export function createLiveUpgrade(options: { live: LiveProxy; baseDomain: string; enabled(): boolean }) {
  return async (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
    const refuse = () => { if (!socket.destroyed) socket.end('HTTP/1.1 404 Not Found\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n'); };
    let cleanup: (() => void) | undefined;
    try {
      const host = incoming.headers.host ?? '';
      const artifact = parseContentHost(host, options.baseDomain);
      const key = incoming.headers['sec-websocket-key'];
      if (!options.enabled() || !artifact || incoming.method !== 'GET' || !incoming.url?.startsWith('/')
        || incoming.url.startsWith('//') || incoming.headers.upgrade?.toLowerCase() !== 'websocket'
        || incoming.headers['sec-websocket-version'] !== '13' || incoming.headers['sec-websocket-protocol'] !== 'vite-hmr'
        || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)
        || (incoming.headers.cookie?.length ?? 0) > 4096) { refuse(); return; }
      const url = new URL(incoming.url, `https://${host}`);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value);
      const admitted = await options.live.authorize(new Request(url, { headers }), artifact.id, true);
      if (!admitted || socket.destroyed) { refuse(); return; }
      const upstream = httpRequest(new URL(admitted.path, admitted.upstream), { timeout: 10_000, headers: {
        connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
        'sec-websocket-key': key, 'sec-websocket-protocol': 'vite-hmr',
      } });
      let tunnel: Duplex | undefined; let checking = false;
      const close = () => { socket.destroy(); tunnel?.destroy(); upstream.destroy(); cleanup?.(); };
      const unwatch = options.live.watch(admitted.route, close);
      const timer = setInterval(async () => {
        if (checking) return; checking = true;
        try { if (!options.enabled() || !await options.live.valid(admitted.route)) close(); }
        catch { close(); } finally { checking = false; }
      }, 1000);
      timer.unref();
      cleanup = () => { clearInterval(timer); unwatch(); };
      socket.once('close', close); socket.once('error', close);
      upstream.once('timeout', close); upstream.once('error', close);
      upstream.once('response', response => { response.resume(); close(); });
      upstream.once('upgrade', (response, peer, upstreamHead) => {
        tunnel = peer;
        void (async () => {
          const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          if (response.statusCode !== 101 || response.headers['sec-websocket-accept'] !== accept
            || response.headers['sec-websocket-protocol'] !== 'vite-hmr' || socket.destroyed
            || !options.enabled() || !await options.live.valid(admitted.route)) { close(); return; }
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`);
          if (head.length) peer.write(head);
          if (upstreamHead.length) socket.write(upstreamHead);
          peer.once('close', close); peer.once('error', close);
          socket.pipe(peer); peer.pipe(socket);
        })().catch(close);
      });
      upstream.end();
    } catch { cleanup?.(); refuse(); }
  };
}
