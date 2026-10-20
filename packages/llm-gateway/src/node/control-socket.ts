import { createServer, type Server } from 'node:http';
import { chmod, rename, unlink, writeFile } from 'node:fs/promises';
import type { ControlServer } from './control-server.js';
import { closeNodeServer } from './http-server.js';

/** The private socket and its rotating authenticator share the protected parent. */
export const startControlSocket = async (path: string, control: ControlServer, token: string): Promise<() => Promise<void>> => {
  const temporary = `${path}.auth.${process.pid}.tmp`;
  await writeFile(temporary, token, { mode: 0o600, flag: 'wx' });
  await rename(temporary, `${path}.auth`);
  const server: Server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
    };
    if (req.method !== 'POST' || req.url !== '/control') { send(404, { ok: false, code: 'CONTROL-UNKNOWN-OP' }); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 65_536) { send(413, { ok: false, code: 'CONTROL-BAD-BODY' }); return; }
        chunks.push(bytes);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { op: string; args: unknown; token: string };
      const result = await control.invoke(body.op, body.args, body.token);
      send(200, { ok: true, result });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'CONTROL-BAD-BODY';
      send(code === 'CONTROL-UNAUTHENTICATED' ? 401 : 400, { ok: false, code });
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  const mask = process.umask(0o177);
  try {
    await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => { server.removeListener('error', reject); resolve(); });
    });
    await chmod(path, 0o600);
  } catch (error) {
    if (server.listening) await closeNodeServer(server);
    await unlink(`${path}.auth`).catch(() => undefined);
    throw error;
  } finally { process.umask(mask); }
  return async () => {
    await closeNodeServer(server);
    await unlink(path).catch(() => undefined);
    await unlink(`${path}.auth`).catch(() => undefined);
  };
};
