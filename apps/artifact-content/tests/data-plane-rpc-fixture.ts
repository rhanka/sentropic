import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { custodyIssuerFromEnv } from '../src/custody-issuer';
import type { CustodyIssuer, CustodySubject } from '../src/data-plane';
import { CUSTODY_RPC_PATH } from '../src/custody-rpc';

/** Independent HTTP peer implements the published B0a byte-level service authentication contract. */
export async function fakeCustodyApi(issuer: CustodyIssuer) {
  const key = randomBytes(32); const kid = 'controller-test';
  let version = 'a'.repeat(64); let refusal = false; let hang = false; let oversized = false;
  let changeOnIssue = false;
  let invalidField: string | undefined;
  const requests: { operation: string; subject: CustodySubject; authenticated: boolean }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const [id, timestamp, supplied = ''] = String(req.headers['x-custody-rpc']).split(':');
    const message = ['custody-rpc.v1', 'POST', req.url, timestamp, createHash('sha256').update(body).digest('hex')].join('\n');
    const expected = createHmac('sha256', key).update(message).digest(); const actual = Buffer.from(supplied, 'base64url');
    const authenticated = req.method === 'POST' && id === kid && Math.abs(Date.now() - Number(timestamp)) <= 5000
      && expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!authenticated) { res.writeHead(403).end(); return; }
    const { subject } = JSON.parse(body.toString()); const operation = req.url?.slice(CUSTODY_RPC_PATH.length) ?? '';
    requests.push({ operation, subject, authenticated });
    if (refusal) { res.writeHead(403).end(); return; }
    if (hang) return;
    if (oversized) { res.end('x'.repeat(16_385)); return; }
    res.setHeader('cache-control', 'private, no-store'); res.setHeader('content-type', 'application/json');
    if (operation === 'watch') res.end(JSON.stringify({ version }));
    else if (operation === 'issue') {
      const lease = await issuer.issue(subject, new AbortController().signal);
      if (changeOnIssue) version = 'b'.repeat(64);
      res.end(JSON.stringify(invalidField ? { ...lease, [invalidField]: { toString: null } } : lease));
    } else res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { APP_ARTIFACT_SANDBOX_BACKEND: 'execution-node',
    APP_ARTIFACT_CUSTODY_API_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS: kid, APP_ARTIFACT_LIVE_CONTROLLER_KEYS: `${kid}=${key.toString('base64url')}` };
  return { env, requests, replica: () => custodyIssuerFromEnv(env)!,
    revoke() { refusal = true; }, change() { version = 'b'.repeat(64); }, hang() { hang = true; },
    oversized() { oversized = true; }, changeOnIssue() { changeOnIssue = true; },
    invalid(field: string) { invalidField = field; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
