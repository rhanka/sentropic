import { GIT_TOOL_DEFINITIONS } from '../git-tool-definitions.js';
import { matchesSchema } from '../profile/validation.js';
import { ArtifactOperationError } from './failures.js';
import { attachGit } from './git-tools-attach.js';
import { fetchAppSource } from './git-tools-fetch.js';
import { publishGit } from './git-tools-publish.js';
import type { GitToolService, GitToolsDeps } from './git-tools-contracts.js';
export type * from './git-tools-contracts.js';

const OPERATIONS = { fetch_app_source: fetchAppSource, git_attach: attachGit, git_publish: publishGit } as const;
/** SG3 executors for the three tools routed by createHttpArtifactApp; every port is injected by the host. */
export function createGitToolService(deps: GitToolsDeps): GitToolService {
  return { async execute(operation, raw, invocation) {
    const run = Object.hasOwn(OPERATIONS, operation) ? OPERATIONS[operation as keyof typeof OPERATIONS] : undefined;
    const args = structuredClone(raw) as Record<string, any>;
    if (!run || !matchesSchema(args, GIT_TOOL_DEFINITIONS[`artifacts_${operation}` as keyof typeof GIT_TOOL_DEFINITIONS].inputSchema)) {
      throw new ArtifactOperationError('invalid_request');
    }
    return run(deps, args, invocation);
  } };
}
