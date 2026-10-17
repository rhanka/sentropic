import { request } from 'node:http';
import type { ControlTransport } from './control-server.js';

export class GatewayControlError extends Error {
  constructor(readonly code: string) { super('gateway control operation refused'); }
}

export const createSocketControlTransport = (controlSocket: string): ControlTransport => ({
  invoke(op, args, token) {
    const body = JSON.stringify({ op, args, token });
    if (Buffer.byteLength(body) > 65_536) return Promise.reject(new GatewayControlError('CONTROL-BAD-BODY'));
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: controlSocket, path: '/control', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 131_072) res.destroy(new GatewayControlError('CONTROL-BAD-BODY'));
          else chunks.push(chunk);
        });
        res.on('error', () => reject(new GatewayControlError('CONTROL-UNAVAILABLE')));
        res.on('end', () => {
          try {
            const envelope = JSON.parse(Buffer.concat(chunks).toString()) as { ok: boolean; result: unknown; code?: string };
            if (res.statusCode !== 200 || envelope.ok !== true) {
              reject(new GatewayControlError(typeof envelope.code === 'string' && /^[A-Z-]{1,64}$/.test(envelope.code) ? envelope.code : 'CONTROL-FAILURE'));
            } else resolve(envelope.result);
          } catch { reject(new GatewayControlError('CONTROL-BAD-BODY')); }
        });
      });
      req.setTimeout(5_000, () => req.destroy());
      req.on('error', () => reject(new GatewayControlError('CONTROL-UNAVAILABLE')));
      req.end(body);
    });
  },
});
