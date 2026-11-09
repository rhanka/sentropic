import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { QUOTA_EXCEEDED, quotaRefusal, type KubernetesCore } from './pods';
import type { BuilderPlacement } from './placement';
import { conflict, LiveError } from './records';

/** Ownerless pod/service deletes never cascade: Background removes the object without the foregroundDeletion
 * finalizer (a Foreground delete on a finalizer-less pod depends on the cluster garbage collector to clear it). */
export function deleteOptions(uid?: string) {
  return { apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background',
    ...(uid ? { preconditions: { uid } } : {}) };
}
/** Uses the API's sentropic-app identity, never mounts or forwards its token to a builder. */
export function createInClusterKubernetes(placement: BuilderPlacement, options: {
  caFile?: string; tokenFile?: string; apiUrl?: string;
} = {}): KubernetesCore {
  const directory = '/var/run/secrets/kubernetes.io/serviceaccount';
  const ca = readFileSync(options.caFile ?? `${directory}/ca.crt`);
  const tokenFile = options.tokenFile ?? `${directory}/token`;
  const base = new URL(options.apiUrl ?? 'https://kubernetes.default.svc');
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') throw new LiveError('builder_unavailable', 'k8s_unconfigured');
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
          if (length > 1024 * 1024) response.destroy(new LiveError('builder_unavailable', 'k8s_response_too_large'));
          else chunks.push(chunk);
        });
        response.on('error', error => reject(error instanceof LiveError ? error
          : new LiveError('builder_unavailable', 'k8s_response_error')));
        response.on('end', () => {
          if (response.statusCode === 404 && ['GET', 'DELETE'].includes(method)) { resolve(undefined); return; }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            const quota = method === 'POST' && resource === 'pods'
              && quotaRefusal(response.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'));
            reject(quota ? new LiveError('builder_unavailable', QUOTA_EXCEEDED)
              : new LiveError('builder_unavailable', `k8s_status_${response.statusCode ?? 'unknown'}`)); return;
          }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T); }
          catch { reject(new LiveError('builder_unavailable', 'k8s_response_invalid')); }
        });
      });
      req.on('timeout', () => req.destroy(new LiveError('builder_unavailable', 'k8s_timeout')));
      req.on('error', error => reject(error instanceof LiveError ? error
        : new LiveError('builder_unavailable', 'k8s_unreachable')));
      req.end(bytes);
    });
  }
  return {
    get: (resource, name) => call('GET', resource, name),
    async create<T>(resource: 'pods' | 'services', body: unknown) {
      const result = await call<T>('POST', resource, undefined, body);
      if (!result) throw new LiveError('builder_unavailable', 'k8s_create_empty');
      return result;
    },
    async delete(resource, name, uid) {
      await call('DELETE', resource, name, deleteOptions(uid));
    },
    async waitDeleted(resource, name, uid) {
      const deadline = Date.now() + 30_000;
      do {
        const current = await call<{ metadata: { uid: string } }>('GET', resource, name);
        if (!current) return;
        if (uid && current.metadata.uid !== uid) conflict('stale_fence');
        await delay(100);
      } while (Date.now() < deadline);
      // A live pod still requires its 404 (the invariant above); a terminal or deleting pod that never leaves etcd
      // (e.g. a stuck foregroundDeletion finalizer) is reported with an explicit reason instead of looping silently.
      throw new LiveError('builder_unavailable', 'k8s_wait_deleted_timeout');
    },
  };
}
