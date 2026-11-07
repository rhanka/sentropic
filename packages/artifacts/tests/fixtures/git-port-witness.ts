/** TEST ONLY: no environment credential discovery, PAT fallback, auto-enrollment or network on import. */
import { createGitHubForge } from '../../src/adapters/github-forge.js';
import { createGitPort } from '../../src/adapters/github-git-port.js';
import type { GitPortOptions } from '../../src/server/git-port-session.js';

export interface WitnessEnrollment {
  ready: boolean;
  storageScopeId: string;
  repoId: string;
  installationRef: string;
  /** Cluster-mesh owner enrollment receipt, not a credential. */
  receiptRef: string;
}
export function createEnrolledWitnessGitPort(input?: {
  enrollment: WitnessEnrollment;
  host: Omit<GitPortOptions, 'forge'>;
}) {
  if (!input?.enrollment.ready || !input.enrollment.receiptRef || !input.host.leases) return undefined;
  const { enrollment, host } = input;
  return createGitPort({ ...host, forge: createGitHubForge(), registry: {
    async get(scope, repoId) {
      if (scope !== enrollment.storageScopeId || repoId !== enrollment.repoId) return undefined;
      const repo = await host.registry.get(scope, repoId);
      return repo?.installationRef === enrollment.installationRef ? repo : undefined;
    },
  } });
}
