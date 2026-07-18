/**
 * BR-72 Wave-1 benchmark proof — SYNTHETIC GitHub fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

const README_CONTENT_BASE64 = Buffer.from('# Synthetic demo repository fixture.\n', 'utf8').toString(
  'base64',
);

export const githubFixtures = {
  resources: {
    get_current_user: {
      login: 'sentropic-demo-user',
      id: 1000001,
      name: 'Sentropic Demo User',
      email: 'demo-user@example.invalid',
      type: 'User',
      html_url: 'https://github.com/sentropic-demo-user',
    },
    list_my_repositories: [
      {
        id: 2000001,
        name: 'demo-repo-one',
        full_name: 'sentropic-demo-user/demo-repo-one',
        private: false,
        html_url: 'https://github.com/sentropic-demo-user/demo-repo-one',
        default_branch: 'main',
      },
      {
        id: 2000002,
        name: 'demo-repo-two',
        full_name: 'sentropic-demo-user/demo-repo-two',
        private: true,
        html_url: 'https://github.com/sentropic-demo-user/demo-repo-two',
        default_branch: 'main',
      },
    ],
    get_repository: {
      id: 2000001,
      name: 'demo-repo-one',
      full_name: 'sentropic-demo-user/demo-repo-one',
      private: false,
      description: 'Synthetic demo repository fixture.',
      html_url: 'https://github.com/sentropic-demo-user/demo-repo-one',
      default_branch: 'main',
      stargazers_count: 42,
    },
    get_file_contents: {
      name: 'README.md',
      path: 'README.md',
      sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      size: 38,
      encoding: 'base64',
      content: README_CONTENT_BASE64,
      html_url: 'https://github.com/sentropic-demo-user/demo-repo-one/blob/main/README.md',
    },
  },
  tools: {
    search_repositories: {
      total_count: 1,
      incomplete_results: false,
      items: [
        {
          id: 2000001,
          name: 'demo-repo-one',
          full_name: 'sentropic-demo-user/demo-repo-one',
          html_url: 'https://github.com/sentropic-demo-user/demo-repo-one',
        },
      ],
    },
    check_pull_request_merged: {
      merged: true,
      pull_number: 7,
      repository: 'sentropic-demo-user/demo-repo-one',
    },
    compare_commits: {
      status: 'ahead',
      ahead_by: 3,
      behind_by: 0,
      total_commits: 3,
      base_commit_sha: '1111111111111111111111111111111111aaaa',
      head_commit_sha: '2222222222222222222222222222222222bbbb',
    },
  },
} as const;

export type GithubResourceCapabilityName = keyof typeof githubFixtures.resources;
export type GithubToolCapabilityName = keyof typeof githubFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (githubFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (githubFixtures.tools as Record<string, unknown>)[capabilityRef];
}
