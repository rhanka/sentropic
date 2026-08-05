import { createHash, randomBytes } from 'crypto';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import { createServer } from 'http';

const base64Url = (buf: Buffer): string =>
  buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateNonce(): string {
  return base64Url(randomBytes(16));
}

export interface LoopbackCallbackResult {
  code: string;
  state: string;
}

export interface LoopbackServer {
  port: number;
  redirectUri: string;
  waitForCallback(timeoutMs?: number): Promise<LoopbackCallbackResult>;
  close(): Promise<void>;
}

export async function createLoopbackServer(
  expectedState: string,
  preferredPort = 0,
): Promise<LoopbackServer> {
  let server: Server | null = null;
  let resolveCallback: ((res: LoopbackCallbackResult) => void) | null = null;
  let rejectCallback: ((err: Error) => void) | null = null;

  const callbackPromise = new Promise<LoopbackCallbackResult>((res, rej) => {
    resolveCallback = res;
    rejectCallback = rej;
  });

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const addressInfo = server?.address();
      const portNum = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : preferredPort;
      const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${portNum}`);
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');

      if (!state || state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Authentication failed</h1><p>State/nonce mismatch.</p>');
        rejectCallback?.(new Error('State/nonce mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Authentication failed</h1><p>Missing authorization code.</p>');
        rejectCallback?.(new Error('Missing authorization code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Authentication successful</h1><p>You may close this window and return to your terminal.</p>');

      resolveCallback?.({ code, state });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error');
      rejectCallback?.(err instanceof Error ? err : new Error(String(err)));
    }
  });

  await new Promise<void>((res) => {
    server?.listen(preferredPort, '127.0.0.1', () => res());
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : preferredPort;
  const redirectUri = `http://127.0.0.1:${actualPort}/oauth/callback`;

  return {
    port: actualPort,
    redirectUri,
    async waitForCallback(timeoutMs = 5 * 60 * 1000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OAuth loopback callback timed out')), timeoutMs);
      });
      try {
        return await Promise.race([callbackPromise, timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async close() {
      if (server) {
        await new Promise<void>((res) => server?.close(() => res()));
        server = null;
      }
    },
  };
}
