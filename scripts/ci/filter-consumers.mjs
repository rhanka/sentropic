// Repaired consumer selection for Lot 1 (plan: ci-optimization-implementation-plan.md).
// Repaired selection is the union of the existing selection and the qualified
// required consumers; unknown input falls back to complete suites.
const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
export const matchGlob = (pattern, path) => {
  const body = esc(pattern).replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${body}$`).test(path);
};
export const selectedFilters = (filters, paths) =>
  Object.entries(filters)
    .filter(([, globs]) => paths.some((p) => globs.some((g) => matchGlob(g, p))))
    .map(([name]) => name);

export const SAFE_NON_CODE_GLOBS = [
  'BRANCH.md', 'PLAN.md', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.gitignore',
  '.github/REQUIRED_CHECKS.md', 'docs/**', 'spec/**', 'plan/**', 'rules/**', '.cursor/**',
  'reviews/**', 'track/**', 'packages/cli/**', 'packages/build-cli/**', 'packages/focus/**',
];

export const hasUnresolvedInput = (filters, paths) => {
  const allGlobs = [...Object.values(filters).flat(), ...SAFE_NON_CODE_GLOBS];
  return paths.some((p) => !allGlobs.some((g) => matchGlob(g, p)));
};

// Job -> filter keys owning its selection (mirrors the ci.yml step and job conditions).
export const JOB_FILTERS = {
  'build-api-image': ['ui', 'api', 'global'], 'build-api-tool-image': ['api', 'global'],
  'build-e2e': ['ui', 'api', 'global'], 'build-ui': ['ui', 'api', 'global'],
  'e2e-vscode': ['ui', 'api', 'global'], 'security-container': ['api', 'ui', 'global'],
  'security-iac': ['global'], 'security-sast-sca': ['api', 'ui', 'global'],
  'smoke-idp-screens': ['api', 'global'], 'test-api-unit-integration': ['api', 'global'],
  'test-e2e': ['ui', 'api', 'global'], 'test-smoke-restore': ['api', 'global'],
  'typecheck-lint-api': ['api', 'global'], 'typecheck-lint-ui': ['ui', 'global'],
  'validate-cluster-mesh': ['cluster_mesh', 'global'], 'validate-llm-gateway': ['llm_gateway', 'global'],
};

// Validate job -> changes output key (mirrors the ci.yml job conditions).
export const VALIDATE_OUTPUTS = {
  'validate-llm-mesh': 'llm_mesh', 'validate-cluster-mesh': 'cluster_mesh', 'validate-llm-gateway': 'llm_gateway',
  'validate-chat-ui': 'chat_ui', 'validate-cited-source-viewer': 'cited_source_viewer', 'validate-cowork-bridge': 'cowork_bridge',
  'validate-oauth-verify': 'oauth_verify', 'validate-mcp-auth': 'mcp_auth', 'validate-mcp-platform': 'mcp_platform',
  'validate-auth-hono': 'auth_hono', 'validate-auth-client': 'auth_client', 'validate-auth-ui': 'auth_ui',
  'validate-cowork-desktop': 'cowork_desktop', 'validate-contracts': 'contracts', 'validate-events': 'events',
  'validate-chat-core': 'chat_core', 'validate-chat-server': 'chat_server', 'validate-comments': 'comments',
  'validate-flow': 'flow', 'validate-artifacts': 'artifacts', 'validate-harness': 'harness', 'validate-idp-sync': 'idp_sync',
};

export const SELECTION_KEYS = ['api', 'ui', 'global', ...Object.values(VALIDATE_OUTPUTS)];

export const hasValidSelectionOutputs = (outputs) =>
  Boolean(outputs) &&
  typeof outputs === 'object' &&
  SELECTION_KEYS.every((k) => outputs[k] === 'true' || outputs[k] === 'false');

export const selectedJobs = (filters, paths, { eventName = 'pull_request' } = {}) => {
  const selected = new Set(selectedFilters(filters, paths));
  const jobs = new Set(['changes', 'validate-publishable-manifests']);
  if (eventName === 'pull_request') jobs.add('enforce-package-bump');
  for (const [job, keys] of Object.entries(JOB_FILTERS)) {
    if (keys.some((k) => selected.has(k))) jobs.add(job);
  }
  for (const [job, key] of Object.entries(VALIDATE_OUTPUTS)) {
    if (selected.has(key) || (key !== 'idp_sync' && selected.has('global'))) jobs.add(job);
  }
  return [...jobs].sort();
};

// Jobs that must report success (never skipped/neutral/failed/cancelled) for a
// given changes-output set. Mirrors the strict block in .github/workflows/ci.yml.
export const requiredSuccessJobs = (outputs, { eventName = 'pull_request', requireAllKeys = false } = {}) => {
  if (!outputs || typeof outputs !== 'object' || Object.keys(outputs).length === 0) {
    throw new Error('missing selection outputs');
  }
  if (requireAllKeys && !hasValidSelectionOutputs(outputs)) {
    throw new Error('incomplete selection outputs');
  }
  const t = (k) => outputs[k] === 'true';
  const req = new Set(['changes', 'validate-publishable-manifests']);
  if (eventName === 'pull_request') req.add('enforce-package-bump');
  const api = t('api') || t('global');
  const ui = t('ui') || t('global');
  if (api) ['test-api-unit-integration', 'typecheck-lint-api', 'build-api-tool-image', 'smoke-idp-screens', 'test-smoke-restore'].forEach((j) => req.add(j));
  if (ui) req.add('typecheck-lint-ui');
  if (api || ui) ['build-api-image', 'build-ui', 'build-e2e', 'test-e2e', 'e2e-vscode', 'security-sast-sca', 'security-container'].forEach((j) => req.add(j));
  if (t('global')) req.add('security-iac');
  for (const [job, key] of Object.entries(VALIDATE_OUTPUTS)) {
    if (t(key) || (t('global') && key !== 'idp_sync')) req.add(job);
  }
  return [...req].sort();
};

export const qualifyHistoricalExclusion = (job, run, filters) => {
  const matched = new Set(selectedFilters(filters, run.paths));
  if (job === 'build-api-tool-image' && !matched.has('api') && !matched.has('global') && matched.has('ui')) {
    return { rule: 'toolbox-ui-only', job };
  }
  if (job === 'security-iac' && !matched.has('global')) {
    return { rule: 'iac-inputs-untouched', job };
  }
  if (job === 'validate-idp-sync' && !matched.has('idp_sync')) {
    return { rule: 'idp-sync-inputs-untouched', job };
  }
  if (job === 'enforce-package-bump' && run.event === 'push') {
    return { rule: 'push-skips-pr-bump-guard', job };
  }
  const filterKey = job === 'typecheck-lint-ui' ? 'ui' : VALIDATE_OUTPUTS[job];
  if (
    run.fallback === 'unresolved-input' &&
    run.paths.includes('scripts/llm-model-equivalences/council.source.json') &&
    !hasUnresolvedInput(filters, run.paths) &&
    filterKey &&
    !matched.has(filterKey) &&
    !matched.has('global')
  ) {
    return { rule: 'resolved-llm-equivalence-council', job, filterKey };
  }
  return null;
};
