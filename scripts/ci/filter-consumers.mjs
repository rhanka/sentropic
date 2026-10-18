// Repaired consumer selection for Lot 1 (plan: ci-optimization-implementation-plan.md).
// Repaired selection is the union of the existing selection and the qualified
// required consumers; unknown input falls back to complete suites (Lot 2 gate).
const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
export const matchGlob = (pattern, path) => {
  const body = esc(pattern).replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${body}$`).test(path);
};
export const selectedFilters = (filters, paths) =>
  Object.entries(filters)
    .filter(([, globs]) => paths.some((p) => globs.some((g) => matchGlob(g, p))))
    .map(([name]) => name);
// Job -> filter keys owning its selection (mirrors the ci.yml step conditions).
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
export const selectedJobs = (filters, paths) => {
  const selected = new Set(selectedFilters(filters, paths));
  return Object.entries(JOB_FILTERS)
    .filter(([, keys]) => keys.some((k) => selected.has(k)))
    .map(([job]) => job);
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
// Jobs that must report success (never skipped/neutral/failed/cancelled) for a
// given changes-output set. A required LLM result that is absent or not green
// cannot satisfy strict green; unaffected jobs skip only with a selection reason.
export const requiredSuccessJobs = (outputs) => {
  const t = (k) => outputs[k] === 'true';
  const req = new Set(['changes', 'validate-publishable-manifests']);
  const api = t('api') || t('global');
  const ui = t('ui') || t('global');
  if (api) ['test-api-unit-integration', 'typecheck-lint-api', 'build-api-image', 'build-api-tool-image', 'smoke-idp-screens', 'security-sast-sca', 'test-smoke-restore'].forEach((j) => req.add(j));
  if (ui) ['typecheck-lint-ui', 'build-ui', 'test-e2e', 'e2e-vscode'].forEach((j) => req.add(j));
  if (api || ui) ['security-container', 'build-e2e'].forEach((j) => req.add(j));
  if (t('global')) req.add('security-iac');
  // validate-idp-sync enumerates its own inputs and stays global-free by design.
  for (const [job, key] of Object.entries(VALIDATE_OUTPUTS)) {
    if (t(key) || (t('global') && key !== 'idp_sync')) req.add(job);
  }
  return [...req].sort();
};
