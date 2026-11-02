import { parseManifest } from '../codecs.js';
import { evaluateAccess, type ArtifactAcl } from './access.js';

export function artifactSummary(input: {
  artifactId: string; acl: ArtifactAcl; actorId: string; state: string;
  current?: { releaseId: string; manifest: string };
  urls?: (artifactId: string, releaseId: string) => { stableUrl: string; pinnedUrl: string };
  approved?: (principalId: string) => boolean;
}) {
  const { artifactId, acl, actorId, state, current } = input;
  const urls = input.urls?.(artifactId, current?.releaseId ?? '');
  const owner = acl.ownerId === actorId;
  return { artifactId, bindingName: acl.bindingName ?? null, ownerId: acl.ownerId,
    storageScopeId: acl.storageScopeId, state, isPublic: acl.isPublic, withdrawn: state === 'withdrawn',
    createdAt: acl.createdAt ?? null, updatedAt: acl.updatedAt ?? null,
    currentReleaseId: current?.releaseId ?? null, digest: current ? parseManifest(current.manifest).digest ?? null : null,
    stableUrl: urls?.stableUrl ?? null, pinnedUrl: current ? urls?.pinnedUrl ?? null : null,
    title: acl.metadata?.title ?? acl.title ?? acl.bindingName ?? artifactId,
    description: acl.metadata?.description ?? acl.description ?? '',
    icon: acl.metadata?.icon !== undefined ? acl.metadata.icon : acl.icon ?? null,
    ...(acl.metadata === undefined ? {} : { metadata: acl.metadata }),
    permissions: { read: evaluateAccess(acl, actorId, 'read', input.approved),
      source: evaluateAccess(acl, actorId, 'source', input.approved), write: owner, manage: owner } };
}
