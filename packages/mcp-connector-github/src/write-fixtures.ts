/**
 * BR-72 Wave-2 Lot 1 — SYNTHETIC GitHub write-tool fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the write adapter can return a
 * canned "mutation succeeded" output once `assertMutationGate` clears an
 * invocation — no real GitHub API is ever reached.
 */

export const githubWriteFixtures = {
  tools: {
    create_repository: {
      id: 3000001,
      name: 'demo-new-repo',
      full_name: 'sentropic-demo-user/demo-new-repo',
      private: false,
      html_url: 'https://github.com/sentropic-demo-user/demo-new-repo',
      default_branch: 'main',
    },
    create_issue: {
      id: 4000001,
      number: 42,
      title: 'Synthetic demo issue',
      state: 'open',
      html_url: 'https://github.com/sentropic-demo-user/demo-repo-one/issues/42',
    },
    update_issue: {
      id: 4000001,
      number: 42,
      title: 'Synthetic demo issue (updated)',
      state: 'closed',
      html_url: 'https://github.com/sentropic-demo-user/demo-repo-one/issues/42',
    },
    create_or_update_file: {
      content: {
        name: 'NOTES.md',
        path: 'NOTES.md',
        sha: 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1',
        html_url: 'https://github.com/sentropic-demo-user/demo-repo-one/blob/main/NOTES.md',
      },
      commit: {
        sha: '3333333333333333333333333333333333cccc',
        message: 'Synthetic upsert commit',
      },
    },
    delete_file: {
      content: null,
      commit: {
        sha: '4444444444444444444444444444444444dddd',
        message: 'Synthetic delete commit',
      },
    },
    dispatch_workflow: {
      workflow_id: 5000001,
      ref: 'main',
      status: 'queued',
      run_id: 6000001,
      html_url: 'https://github.com/sentropic-demo-user/demo-repo-one/actions/runs/6000001',
    },
    delete_repository: {
      deleted: true,
      full_name: 'sentropic-demo-user/demo-repo-one',
    },
  },
} as const;

export type GithubWriteToolCapabilityName = keyof typeof githubWriteFixtures.tools;

export function getWriteToolFixture(capabilityRef: string): unknown | undefined {
  return (githubWriteFixtures.tools as Record<string, unknown>)[capabilityRef];
}
