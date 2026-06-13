import { env } from '../../config/env';
import type { ArtifactStorePort } from './port';
import { LocalFsArtifactStore } from './local-fs-artifact-store';
import { S3ArtifactStore } from './s3-artifact-store';

export * from './port';
export { S3ArtifactStore } from './s3-artifact-store';
export { LocalFsArtifactStore } from './local-fs-artifact-store';

let singleton: ArtifactStorePort | undefined;

function selectBackend(): 's3' | 'local-fs' {
  const explicit = (env.ARTIFACT_STORE_BACKEND || '').trim().toLowerCase();
  if (explicit === 's3' || explicit === 'local-fs') return explicit;
  // Auto: use S3 when a documents bucket is configured (prod/test), else local-FS (dev/self-host).
  return (env.DOC_STORAGE_BUCKET || '').trim() ? 's3' : 'local-fs';
}

/** Build a fresh artifact store from the current environment (backend auto-selected). */
export function createArtifactStore(): ArtifactStorePort {
  if (selectBackend() === 'local-fs') {
    const root = (env.ARTIFACT_FS_ROOT || '').trim() || '/tmp/sentropic-artifacts';
    const bucket = (env.DOC_STORAGE_BUCKET || '').trim() || 'documents';
    return new LocalFsArtifactStore(root, bucket);
  }
  return new S3ArtifactStore();
}

/** Process-wide singleton artifact store. */
export function getArtifactStore(): ArtifactStorePort {
  if (!singleton) singleton = createArtifactStore();
  return singleton;
}

/** Test seam: override or reset the singleton. */
export function setArtifactStoreForTesting(store: ArtifactStorePort | undefined): void {
  singleton = store;
}
