/**
 * BR-72 benchmark proof — SYNTHETIC Linear fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

export const linearFixtures = {
  resources: {
    get_current_user: {
      id: 'usr_demo0001',
      name: 'Sentropic Demo User',
      displayName: 'demo-user',
      email: 'demo-user@example.invalid',
      active: true,
    },
    get_linear_issue: {
      id: 'iss_demo0001',
      identifier: 'DEMO-1',
      title: 'Synthetic demo issue fixture',
      description: 'A synthetic Linear issue used for the BR-72 benchmark proof.',
      state: { id: 'state_demo01', name: 'In Progress' },
      team: { id: 'team_demo01', name: 'Demo Team' },
      url: 'https://linear.app/sentropic-demo/issue/DEMO-1',
    },
    get_linear_project: {
      id: 'proj_demo0001',
      name: 'Demo Roadmap',
      state: 'started',
      url: 'https://linear.app/sentropic-demo/project/demo-roadmap',
      teams: [{ id: 'team_demo01', name: 'Demo Team' }],
    },
    get_attachment: {
      id: 'att_demo0001',
      issueId: 'iss_demo0001',
      title: 'Synthetic attachment fixture',
      subtitle: 'demo-spec.pdf',
      url: 'https://example.invalid/attachments/demo-spec.pdf',
    },
  },
  tools: {
    list_linear_issues: {
      issues: [
        { id: 'iss_demo0001', identifier: 'DEMO-1', title: 'Synthetic demo issue fixture' },
        { id: 'iss_demo0002', identifier: 'DEMO-2', title: 'Second synthetic demo issue fixture' },
      ],
      page_info: { hasNextPage: false, endCursor: null },
    },
    list_linear_teams: {
      teams: [{ id: 'team_demo01', name: 'Demo Team', key: 'DEMO' }],
    },
    search_issues: {
      issues: [{ id: 'iss_demo0001', identifier: 'DEMO-1', title: 'Synthetic demo issue fixture' }],
      total_count: 1,
      page_info: { hasNextPage: false, endCursor: null },
    },
  },
} as const;

export type LinearResourceCapabilityName = keyof typeof linearFixtures.resources;
export type LinearToolCapabilityName = keyof typeof linearFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (linearFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (linearFixtures.tools as Record<string, unknown>)[capabilityRef];
}
