/**
 * L-5d — generic content runtime (spec-v8 §9 5d).
 *
 * Serve current release bytes to authorized readers over injected host
 * ports (no driver imports). Terminal states report instead of serving;
 * digests outside the current manifest never oracle (404); stored bytes
 * are checked against the manifest size before serving.
 */
import type { AclStore } from './access.js';
import type { LifecycleService } from './lifecycle.js';
import type { PublicationBlobStore, PublicationService } from './publication.js';

export interface ContentDeps {
  acls: AclStore;
  lifecycle: LifecycleService;
  publication: PublicationService;
  blobs: PublicationBlobStore;
}

export interface ServeFileInput {
  artifactId: string;
  digest: string;
  actorId: string;
  isApproved?: (principalId: string) => boolean;
}

export interface ServedFile {
  digest: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
}

interface ManifestFile {
  digest?: unknown;
  size?: unknown;
  mimeType?: unknown;
}

/** Create the content runtime over injected host ports. */
export function createContentRuntime(deps: ContentDeps) {
  return {
    async serveFile(input: ServeFileInput): Promise<ServedFile> {
      const isApproved = input.isApproved ?? (() => false);
      const acl = await deps.acls.getArtifactAcl(input.artifactId);
      if (acl === undefined) throw new Error(`unknown artifact: ${input.artifactId}`);
      if (acl.storageScopeId === undefined) {
        throw new Error('invalid request: missing storage scope');
      }
      const state = await deps.lifecycle.stateOf(input.artifactId);
      if (state === 'deleted' || state === 'purged') {
        throw new Error(`cannot serve ${state} artifact: terminal ${input.artifactId}`);
      }
      const readable = deps.lifecycle.canRead(
        { artifactId: input.artifactId, state },
        acl,
        input.actorId,
        'read',
        isApproved,
      );
      if (!readable) {
        throw new Error(`access denied: ${input.actorId} cannot read ${input.artifactId}`);
      }
      const current = await deps.publication.getCurrent(input.artifactId);
      if (current === undefined) throw new Error(`no release to serve for ${input.artifactId}`);
      const manifest = JSON.parse(current.manifest) as { files?: ManifestFile[] };
      const file = (manifest.files ?? []).find((entry) => entry.digest === input.digest);
      if (file === undefined || typeof file.digest !== 'string') {
        throw new Error(`unknown blob: ${input.digest} for ${input.artifactId}`);
      }
      const hex = file.digest.startsWith('sha256:') ? file.digest.slice('sha256:'.length) : file.digest;
      const key = `artifacts/${acl.storageScopeId}/blobs/sha256/${hex}`;
      const bytes = await deps.blobs.getBlob(key);
      if (bytes === undefined) throw new Error(`unknown blob: ${file.digest} for ${input.artifactId}`);
      if (typeof file.size === 'number' && bytes.length !== file.size) {
        throw new Error(`size mismatch for ${file.digest}: manifest ${file.size}, stored ${bytes.length}`);
      }
      return {
        digest: file.digest,
        mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
        size: bytes.length,
        bytes,
      };
    },
  };
}
