import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { digest, isDigest, policy, requireEvidence } from './toolchain-contract.mjs';

const repositories = Object.freeze({ vulnerability: 'aquasecurity/trivy-db',
  java: 'aquasecurity/trivy-java-db', checks: 'aquasecurity/trivy-checks' });
// Only fixed Aqua GHCR repositories and GHCR's blob delivery host; no mirror or caller URL.
export function createOciClient({ fetcher = fetch, now = Date.now, sleep = setTimeout } = {}) {
  const start = now();
  const remaining = () => policy.acquisition.budgetMs - (now() - start);
  async function request(url, headers = {}) {
    let response;
    for (let attempt = 0; attempt < policy.acquisition.attempts; attempt++) {
      requireEvidence(remaining() > 0, 'OCI acquisition budget exhausted');
      try {
        response = await fetcher(url, { headers, redirect: 'manual',
          signal: AbortSignal.timeout(Math.max(1, Math.min(remaining(), policy.acquisition.requestTimeoutMs))) });
      } catch { throw new Error('coverage-blocked: OCI transport unavailable'); }
      if (response.status !== 429 && response.status < 500) return response;
      const retry = response.headers.get('retry-after');
      const delay = retry === null ? 1000 * (attempt + 1) : /^\d+$/.test(retry)
        ? Number(retry) * 1000 : Date.parse(retry) - now();
      await response.body?.cancel();
      requireEvidence(attempt + 1 < policy.acquisition.attempts && Number.isFinite(delay) && delay >= 0 &&
        delay <= policy.acquisition.maxRetryAfterMs && delay < remaining(), 'OCI rate-limit/retry budget');
      await sleep(delay);
    }
    throw new Error('coverage-blocked: OCI retries exhausted');
  }
  async function consume(response, limit, write) {
    requireEvidence(response.ok, `OCI HTTP ${response.status}`);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      requireEvidence(size <= limit && remaining() > 0, 'OCI byte/time bound');
      hash.update(chunk);
      await write(chunk);
    }
    return { digest: `sha256:${hash.digest('hex')}`, size };
  }
  async function json(response, limit = 1024 * 1024) {
    const chunks = [];
    const identity = await consume(response, limit, async (chunk) => chunks.push(chunk));
    const bytes = Buffer.concat(chunks);
    return { bytes, value: JSON.parse(bytes), ...identity };
  }
  return {
    async resolve(kind) {
      const repo = repositories[kind];
      requireEvidence(repo && policy.data[kind].repository === `ghcr.io/${repo}`, 'untrusted OCI repository');
      const tokenResponse = await json(await request(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`), 16384);
      const token = tokenResponse.value.token;
      requireEvidence(typeof token === 'string' && token.length > 0 && token.length < 12000, 'anonymous GHCR token');
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.manifest.v1+json' };
      const tag = policy.data[kind].tag;
      const manifest = await json(await request(`https://ghcr.io/v2/${repo}/manifests/${tag}`, headers));
      requireEvidence(manifest.value.schemaVersion === 2 && manifest.value.layers?.length === 1, 'OCI artifact manifest');
      const layer = manifest.value.layers[0];
      requireEvidence(isDigest(layer.digest) && Number.isSafeInteger(layer.size) && layer.size > 0 &&
        layer.size <= 512 * 1024 * 1024, 'OCI layer descriptor');
      return { kind, repository: `ghcr.io/${repo}`, manifestDigest: manifest.digest,
        manifestBytes: manifest.bytes, layer,
        async download(path) {
          let response = await request(`https://ghcr.io/v2/${repo}/blobs/${layer.digest}`, headers);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const destination = new URL(response.headers.get('location'));
            requireEvidence(destination.protocol === 'https:' && destination.hostname === 'pkg-containers.githubusercontent.com' &&
              !destination.username && !destination.password && !destination.port, 'untrusted OCI redirect');
            await response.body?.cancel();
            response = await request(destination.href); // Never forward the registry token.
          }
          const file = await open(path, 'wx', 0o600);
          try {
            const actual = await consume(response, layer.size, async (chunk) => file.writeFile(chunk));
            requireEvidence(actual.digest === layer.digest && actual.size === layer.size, 'OCI layer integrity');
            return actual;
          } catch (error) { await rm(path, { force: true }); throw error; }
          finally { await file.close(); }
        },
      };
    },
  };
}

export function verifyManifest(bytes, expected) {
  requireEvidence(isDigest(expected) && digest(bytes) === expected, 'OCI manifest integrity');
  return JSON.parse(bytes);
}
