import { createHmac } from 'node:crypto';
import { nodeHash } from './execution-node-adapter';
import { ExecutionNodeRefusal } from './execution-node-transport';
import type { ExecutionNodeTenantId } from '../../../../../apps/sandbox-node/src/contract';

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
/** Credentials stay in this control-plane closure. The agent receives URLs only.
 * Path-style SigV4 uses the configured OVH BHS bucket and exact tenant/environment prefix.
 */
export function executionNodeStorage(env: Readonly<Record<string, string | undefined>>, environment: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(environment)) throw new ExecutionNodeRefusal('invalid_storage_environment');
  function settings(tenant: ExecutionNodeTenantId) {
    if (!['sentropic', 'immo'].includes(tenant)) throw new ExecutionNodeRefusal('invalid_storage_tenant');
    const stem = `SANDBOX_S3_${tenant.toUpperCase()}_`;
    const required = (suffix: string) => {
      const value = env[stem + suffix]; if (!value) throw new ExecutionNodeRefusal(`invalid_config:${stem}${suffix}`); return value;
    };
    const region = required('REGION'); const bucket = required('BUCKET'); const prefix = required('PREFIX');
    let endpoint: URL;
    try { endpoint = new URL(required('ENDPOINT')); } catch { throw new ExecutionNodeRefusal(`invalid_config:${stem}ENDPOINT`); }
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 's3.bhs.io.cloud.ovh.net' || endpoint.port
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/'
      || region.toLowerCase() !== 'bhs' || bucket !== 'sentropic-execution-bhs'
      || prefix !== `tenants/${tenant}/${environment}/`) throw new ExecutionNodeRefusal('invalid_tenant_storage');
    return { endpoint, bucket, prefix, region, access: required('ACCESS_KEY_ID'), secret: required('SECRET_ACCESS_KEY') };
  }
  return {
    presign(tenant: ExecutionNodeTenantId, key: string, method: 'GET' | 'PUT', now = new Date()) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(?:tar\.gz|erofs)$/.test(key) || key.includes('//')) throw new ExecutionNodeRefusal('invalid_storage_key');
      const config = settings(tenant); const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); const date = stamp.slice(0, 8);
      const scope = `${date}/${config.region}/s3/aws4_request`;
      const url = new URL(`/${config.bucket}/${config.prefix}${key}`, config.endpoint);
      const params: Record<string, string> = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${config.access}/${scope}`,
        'X-Amz-Date': stamp, 'X-Amz-Expires': '60', 'X-Amz-SignedHeaders': 'host' };
      const query = Object.keys(params).sort().map(name => `${encode(name)}=${encode(params[name]!)}`).join('&');
      const canonical = `${method}\n${url.pathname}\n${query}\nhost:${url.host}\n\nhost\nUNSIGNED-PAYLOAD`;
      const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secret}`, date), config.region), 's3'), 'aws4_request');
      const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${nodeHash(canonical)}`).toString('hex');
      url.search = `${query}&X-Amz-Signature=${signature}`; return url.href;
    },
    validateUrl(value: string, tenant: string) {
      const config = settings(tenant as ExecutionNodeTenantId); let url: URL;
      try { url = new URL(value); } catch { throw new ExecutionNodeRefusal('invalid_tenant_storage_url'); }
      if (url.origin !== config.endpoint.origin || url.username || url.password || url.hash
        || !url.pathname.startsWith(`/${config.bucket}/${config.prefix}`)
        || /%2f|%2e|%5c/i.test(url.pathname) || !url.searchParams.has('X-Amz-Signature')) {
        throw new ExecutionNodeRefusal('invalid_tenant_storage_url');
      }
    },
  };
}
