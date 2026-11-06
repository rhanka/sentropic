import type { GitBindingStore, GitCodeRightsPort } from './git-contracts.js';

export interface GitProjectionPorts {
  bindings: GitBindingStore;
  codeRights: GitCodeRightsPort;
}
/** Artifact visibility is checked by the caller; repository rights are a separate live host decision. */
export async function projectGitBinding(ports: GitProjectionPorts | undefined,
  input: { storageScopeId: string; artifactId: string; actorId: string; ownerId: string }) {
  if (!ports) return {};
  const binding = await ports.bindings.get(input.storageScopeId, input.artifactId);
  if (!binding || binding.storageScopeId !== input.storageScopeId || binding.artifactId !== input.artifactId) return {};
  let allowed = false;
  try { allowed = await ports.codeRights.canReadCode({ storageScopeId: input.storageScopeId,
    repoId: binding.repoId, actorId: input.actorId }) === true; } catch { /* Fail closed on unavailable rights. */ }
  if (!allowed) return {};
  const projected = structuredClone(binding);
  if (input.actorId !== input.ownerId) delete projected.live;
  return { git: projected };
}
