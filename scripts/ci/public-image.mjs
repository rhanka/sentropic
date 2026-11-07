import { createHash } from 'node:crypto';

export async function publicImage(ref, fetchImpl = fetch) {
  const match = /^ghcr\.io\/(rhanka\/sentropic-(?:api|ui|e2e))(?::([\w.-]+)|@(sha256:[a-f0-9]{64}))$/.exec(ref);
  if (!match) throw Error('Expected a public sentropic GHCR reference');
  const [, repository, tag, pinned] = match;
  const tokenResponse = await fetchImpl(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`);
  if (!tokenResponse.ok) throw Error(`Anonymous GHCR token refused for ${repository}`);
  const { token } = await tokenResponse.json();
  const response = await fetchImpl(`https://ghcr.io/v2/${repository}/manifests/${pinned ?? tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' },
  });
  if (!response.ok) throw Error(`Anonymous GHCR pull refused for ${repository}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (digest !== response.headers.get('docker-content-digest') || (pinned && pinned !== digest)) throw Error('GHCR manifest digest mismatch');
  return { ref, digest, manifest: JSON.parse(bytes) };
}
