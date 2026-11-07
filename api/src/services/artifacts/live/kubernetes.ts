import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import type { KubernetesCore } from './pods';
import type { BuilderPlacement } from './placement';
import { conflict, LiveError } from './records';

/** Uses the API's sentropic-app identity, never mounts or forwards its token to a builder. */
export function createInClusterKubernetes(placement: BuilderPlacement, options: {
  caFile?: string; tokenFile?: string; apiUrl?: string;
} = {}): KubernetesCore {
  const directory = '/var/run/secrets/kubernetes.io/serviceaccount';
  const ca = readFileSync(options.caFile ?? `${directory}/ca.crt`);
  const tokenFile = options.tokenFile ?? `${directory}/token`;
  const base = new URL(options.apiUrl ?? 'https://kubernetes.default.svc');
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') throw new LiveError('builder_unavailable');
  async function call<T>(method: string, resource: 'pods' | 'services', name?: string, body?: unknown): Promise<T | undefined> {
    const path = `/api/v1/namespaces/${placement.namespace}/${resource}${name ? `/${encodeURIComponent(name)}` : ''}`;
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise<T | undefined>((resolve, reject) => {
      const req = request(new URL(path, base), { method, ca, timeout: 30_000, headers: {
        authorization: `Bearer ${readFileSync(tokenFile, 'utf8').trim()}`,
        ...(bytes ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}),
      } }, response => {
        const chunks: Buffer[] = []; let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 1024 * 1024) response.destroy(new LiveError('builder_unavailable'));
          else chunks.push(chunk);
        });
        response.on('error', () => reject(new LiveError('builder_unavailable')));
        response.on('end', () => {
          if (response.statusCode === 404 && ['GET', 'DELETE'].includes(method)) { resolve(undefined); return; }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new LiveError('builder_unavailable')); return;
          }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T); }
          catch { reject(new LiveError('builder_unavailable')); }
        });
      });
      req.on('timeout', () => req.destroy(new LiveError('builder_unavailable')));
      req.on('error', () => reject(new LiveError('builder_unavailable')));
      req.end(bytes);
    });
  }
  return {
    get: (resource, name) => call('GET', resource, name),
    async create<T>(resource: 'pods' | 'services', body: unknown) {
      const result = await call<T>('POST', resource, undefined, body);
      if (!result) throw new LiveError('builder_unavailable');
      return result;
    },
    async delete(resource, name, uid) {
      await call('DELETE', resource, name, { apiVersion: 'v1', kind: 'DeleteOptions',
        propagationPolicy: 'Foreground', ...(uid ? { preconditions: { uid } } : {}) });
    },
    async waitDeleted(resource, name, uid) {
      const deadline = Date.now() + 30_000;
      do {
        const current = await call<{ metadata: { uid: string } }>('GET', resource, name);
        if (!current) return;
        if (uid && current.metadata.uid !== uid) conflict('stale_fence');
        await delay(100);
      } while (Date.now() < deadline);
      throw new LiveError('builder_unavailable');
    },
  };
}
