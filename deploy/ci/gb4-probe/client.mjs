import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';

const host = process.argv[1];
// Resolve separately: failed DNS must never count as evidence of isolation.
const address = (await lookup(host)).address;
const key = randomBytes(16).toString('base64');
const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
const result = await new Promise((resolve) => {
  const socket = net.connect({ host: address, port: 5173 });
  let pending = Buffer.alloc(0), upgraded = false, connected = false;
  const finish = (value) => { socket.destroy(); resolve(value); };
  const timer = setTimeout(() => finish(connected ? 'PROTOCOL_TIMEOUT' : 'BLOCKED_TIMEOUT'), 3500);
  socket.on('close', () => clearTimeout(timer));
  socket.once('error', (error) => finish(!connected && ['EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EPERM'].includes(error.code) ? `BLOCKED_${error.code}` : `ERROR_${error.code}`));
  socket.once('connect', () => {
    connected = true;
    socket.write(`GET /echo HTTP/1.1\r\nHost: ${host}:5173\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
  socket.on('data', (data) => {
    pending = Buffer.concat([pending, data]);
    if (!upgraded) {
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      const headers = pending.subarray(0, end).toString();
      if (!headers.startsWith('HTTP/1.1 101 ') || !headers.toLowerCase().includes(`sec-websocket-accept: ${accept}`.toLowerCase())) return finish('INVALID_UPGRADE');
      pending = pending.subarray(end + 4); upgraded = true;
      const payload = Buffer.from('gb4-echo'), mask = randomBytes(4);
      const encoded = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
      // Split the masked frame to exercise streaming parsing in the server.
      const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, encoded]);
      socket.write(frame.subarray(0, 3)); setTimeout(() => socket.write(frame.subarray(3)), 10);
    }
    if (pending.length < 10) return;
    finish(pending[0] === 0x81 && pending[1] === 8 && pending.subarray(2, 10).toString() === 'gb4-echo' ? 'ECHO_OK' : 'INVALID_ECHO');
  });
});
console.log(JSON.stringify({ address, result }));
