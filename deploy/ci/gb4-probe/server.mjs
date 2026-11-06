import http from 'node:http';
import { createHash } from 'node:crypto';
import { selfTest } from './checks.mjs';

const server = http.createServer(async (request, response) => {
  if (request.url === '/healthz') return response.end('ok');
  if (request.url !== '/self-test') { response.writeHead(404); return response.end(); }
  try {
    const rows = await selfTest();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ pass: rows.every((r) => r.pass), rows }));
  } catch { response.writeHead(500); response.end('self-test failed'); }
});
server.on('upgrade', (request, socket, head) => {
  const key = request.headers['sec-websocket-key'];
  if (request.url !== '/echo' || request.headers['sec-websocket-version'] !== '13' ||
      typeof key !== 'string' || Buffer.from(key, 'base64').length !== 16 ||
      request.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let pending = Buffer.alloc(0);
  socket.setTimeout(5000, () => socket.destroy());
  socket.on('error', () => socket.destroy());
  const receive = (data) => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 2) {
      const opcode = pending[0] & 15;
      const length = pending[1] & 127;
      // The probe implements only final, masked frames with short payloads.
      if ((pending[0] & 0xf0) !== 0x80 || !(pending[1] & 128) || length > 125 ||
          ![1, 2, 8, 9, 10].includes(opcode)) return socket.destroy();
      if (pending.length < 6 + length) return;
      const payload = Buffer.from(pending.subarray(6, 6 + length));
      for (let i = 0; i < length; i++) payload[i] ^= pending[2 + i % 4];
      pending = pending.subarray(6 + length);
      if (opcode === 10) continue;
      const frame = Buffer.concat([Buffer.from([0x80 | (opcode === 9 ? 10 : opcode), length]), payload]);
      if (opcode === 8) return socket.end(frame);
      socket.write(frame);
    }
  };
  socket.on('data', receive);
  if (head.length) receive(head);
});
server.listen(5173, '0.0.0.0');
