// r6 §4.1 fixed job → single protected environment map for rhanka/sentropic.
// The only activation repository is rhanka/sentropic; no custody repository or App exists.
export const REPOSITORY = 'rhanka/sentropic';

export const JOB_ENVIRONMENTS: Record<string, string | null> = {
  'scan-supervisor': 'security-daily-control',
  'health-inventory': 'security-daily-control',
  'deadline-inventory': 'security-daily-control',
  'seat-broker': 'security-nightly',
  'native-review-supervisor': 'security-nightly',
  'repair-author-supervisor': 'security-nightly',
  'patch-review-supervisor': 'security-nightly',
  'security-required-ci-supervisor': 'security-nightly',
  'verify-projection': 'security-nightly',
  'enroll-seat': 'security-seat-maintenance',
  'refresh-seat': 'security-seat-maintenance',
  'recover-successor': 'security-seat-maintenance',
  'verify-canonical': 'security-seat-maintenance',
  'state-write-allocate': 'security-seat-writer',
  'state-verify': 'security-seat-writer',
  'review-metadata': 'security-seat-admission',
  'security-admission-plan': 'security-seat-admission',
  'seat-continuation-dispatch': 'security-seat-dispatch',
  'security-dispatch': 'security-seat-dispatch',
  'dispatch-required-ci': 'security-seat-dispatch',
  'dispatch-post-merge': 'security-seat-dispatch',
  'admit-scan': 'security-report-publish',
  'admit-collection': 'security-report-publish',
  'collect': 'security-report-publish',
  'reconcile-pending': 'security-report-publish',
  'health-record': 'security-report-publish',
  'deadline-record': 'security-report-publish',
  'review-record': 'security-report-publish',
  'invalidate': 'security-report-publish',
  'control-receipt': 'security-report-publish',
  'state-intent': 'security-report-publish',
  'state-commit': 'security-report-publish',
  'publish-fix': 'security-repair-publish',
  'merge-fix': 'security-repair-merge',
  'attest-review': 'security-review-attest',
  'source-reader': 'security-source-acquire',
  'target-acquirer': 'security-source-acquire',
  'verify-merged-fix': 'security-source-acquire',
  'observe-release': 'security-source-acquire',
  'ci-status': 'security-ci-status',
  'promotion-control': 'security-promotion-control',
  'qualified-operator-enable-off': 'security-promotion-control',
  'publish-control-image': 'security-control-image-publish',
  'publish-scanner-image': 'security-scanner-image-publish',
  'key-free-scanner-worker': null,
  'key-free-validator': null,
  'key-free-preflight': null,
};

// The twelve environments holding a same-epoch copy of SECURITY_CONTROL_READER_TOKEN (r6 §4.1).
export const READER_TOKEN_ENVIRONMENTS: readonly string[] = [
  'security-daily-control', 'security-nightly', 'security-seat-writer', 'security-seat-admission',
  'security-seat-dispatch', 'security-report-publish', 'security-repair-publish', 'security-repair-merge',
  'security-review-attest', 'security-source-acquire', 'security-ci-status', 'security-promotion-control',
];

const CLIS = ['CODEX', 'VIBE', 'MUSE', 'CLAUDE', 'AGY'] as const;
export const MAX_SLOTS = 40;

export function stateBankNames(): string[] {
  const names: string[] = [];
  for (const bank of ['A', 'B']) for (let i = 0; i < 16; i++) names.push(`SEAT_STATE_${bank}_${String(i).padStart(2, '0')}`);
  return names;
}
export const SEAT_STATE_HEAD = 'SEAT_STATE_HEAD';

export function slotSecretNames(k: number): { canonical: string[]; candidate: string[]; projection: string[] } {
  if (!Number.isSafeInteger(k) || k < 1 || k > MAX_SLOTS) throw new Error('slot-ceiling');
  const canonical: string[] = []; const candidate: string[] = []; const projection: string[] = [];
  let n = 0;
  for (const cli of CLIS) {
    for (let i = 0; i < 8 && n < k; i++, n++) {
      const slot = `${cli}_${String(i).padStart(2, '0')}`;
      canonical.push(`SEAT_${slot}`); candidate.push(`SEAT_CANDIDATE_${slot}`); projection.push(`SEAT_USE_${slot}`);
    }
  }
  return { canonical, candidate, projection };
}

const WRITER_SECRETS = new Set([
  ...stateBankNames(), SEAT_STATE_HEAD, 'SEAT_ENVIRONMENT_WRITER_TOKEN',
  'SEAT_SETTLEMENT_DECRYPTION_KEY', 'SEAT_SUCCESSOR_RECOVERY_KEY', 'SECURITY_CONTROL_READER_TOKEN',
]);
const MAINTENANCE_SECRETS = new Set([
  ...slotSecretNames(MAX_SLOTS).canonical, ...slotSecretNames(MAX_SLOTS).candidate,
]);
const NIGHTLY_SECRETS = new Set([
  ...slotSecretNames(MAX_SLOTS).projection, 'SECURITY_CONTROL_READER_TOKEN',
  'SECURITY_CONTROL_PERMIT_SIGNING_KEY_CUSTODY',
]);
const READER = new Set(['SECURITY_CONTROL_READER_TOKEN']);

export function allowedSecretNames(environment: string): Set<string> {
  switch (environment) {
    case 'security-seat-writer': return WRITER_SECRETS;
    case 'security-seat-maintenance': return MAINTENANCE_SECRETS;
    case 'security-nightly': return NIGHTLY_SECRETS;
    case 'security-daily-control':
      return new Set([...READER, 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC']);
    case 'security-report-publish': return new Set([...READER, 'SECURITY_REPORT_DEPLOY_KEY']);
    case 'security-review-attest': return new Set([...READER, 'SECURITY_REVIEW_ATTESTOR_TOKEN']);
    case 'security-scanner-image-publish': return new Set();
    case 'security-control-image-publish': return new Set();
    default:
      if (READER_TOKEN_ENVIRONMENTS.includes(environment)) return new Set(READER);
      return new Set();
  }
}

export function allowedSecretsForEnvironment(environment: string): Set<string> {
  return allowedSecretNames(environment);
}

export function assertJobEnvironment(jobId: string, declared: (string | null)[]): void {
  const expected = JOB_ENVIRONMENTS[jobId];
  if (expected === undefined) throw new Error(`unknown-job:${jobId}`);
  const present = declared.filter((e): e is string => e !== null && e !== undefined);
  if (expected === null) {
    if (present.length > 0) throw new Error(`environment-forbidden:${jobId}:${present[0]}`);
    return;
  }
  if (present.length !== 1) throw new Error(`single-environment:${jobId}:${present.length}`);
  if (present[0] !== expected) throw new Error(`environment-mismatch:${jobId}:${present[0]}`);
}

export type ParsedWorkflow = {
  jobs: Record<string, { environment: string | null; environmentDeclarations: number; secrets: string[]; uses: string[]; hasPreflight: boolean }>;
};

// Minimal structural scan of a workflow document: enough to enforce the §4.1 invariants
// without a YAML dependency in the pinned key-free lane.
export function parseWorkflowJobs(text: string): ParsedWorkflow {
  const jobs: ParsedWorkflow['jobs'] = {};
  const lines = text.split('\n');
  let inJobs = false; let current: string | null = null;
  for (const line of lines) {
    if (/^jobs:/.test(line)) { inJobs = true; continue; }
    if (inJobs && /^\S/.test(line)) { inJobs = false; current = null; }
    if (!inJobs) continue;
    const jobMatch = /^ {2}([A-Za-z0-9_-]+):/.exec(line);
    if (jobMatch) { current = jobMatch[1]; jobs[current] = { environment: null, environmentDeclarations: 0, secrets: [], uses: [], hasPreflight: false }; continue; }
    if (current === null) continue;
    const job = jobs[current];
    const env = /^ {4,}environment:\s*(.+)$/.exec(line);
    if (env) { job.environment = env[1].trim().replace(/^['"]|['"]$/g, ''); job.environmentDeclarations += 1; }
    const uses = /^\s+uses:\s*(.+)$/.exec(line);
    if (uses) job.uses.push(uses[1].trim());
    const secret = /secrets\.([A-Za-z0-9_]+)/.exec(line);
    if (secret) job.secrets.push(secret[1]);
    if (/Key-free preflight/.test(line)) job.hasPreflight = true;
  }
  return { jobs };
}

export type WorkflowSource = { source: 'push' | 'pr' | 'fork' | 'dispatch' | 'schedule'; ref: string };

export function classifyWorkflow(text: string, src: WorkflowSource): string[] {
  const violations: string[] = [];
  if (src.source === 'pr' || src.source === 'fork') violations.push(`unprotected-ref:${src.source}:${src.ref}`);
  else if (src.source === 'push' && src.ref !== 'refs/heads/main') violations.push(`unprotected-ref:${src.ref}`);
  if (/^\s*on:\s*$/m.test(text) && /pull_request_target/.test(text)) violations.push('pull-request-target');
  if (/^\s*secrets:\s*inherit/m.test(text)) violations.push('secrets-inherit');
  const parsed = parseWorkflowJobs(text);
  for (const [jobId, job] of Object.entries(parsed.jobs)) {
    const declared = job.environment === null ? [] : [job.environment];
    const activationJob = jobId in JOB_ENVIRONMENTS
      || (job.environment !== null && job.environment.startsWith('security-'));
    if (activationJob && job.environment !== null && /\$\{\{/.test(job.environment)) violations.push(`environment-expression:${jobId}`);
    if (job.environmentDeclarations > 1) violations.push(`single-environment:${jobId}:${job.environmentDeclarations}`);
    if (declared.length > 1) violations.push(`single-environment:${jobId}`);
    if (jobId in JOB_ENVIRONMENTS) {
      try { assertJobEnvironment(jobId, declared); }
      catch (error) { violations.push((error as Error).message); }
    }
    for (const name of job.secrets) {
      if (!/^[A-Z0-9_]+$/.test(name)) violations.push(`secret-ref:${jobId}:${name}`);
      else if (activationJob && job.environment && !allowedSecretNames(job.environment).has(name)) {
        violations.push(`secret-not-allowlisted:${jobId}:${name}`);
      }
    }
    for (const use of job.uses) {
      if (use.startsWith('./')) violations.push(`local-indirection:${jobId}:${use}`);
    }
    if (activationJob && job.environment !== null && !job.hasPreflight) violations.push(`preflight-missing:${jobId}`);
  }
  for (const raw of text.matchAll(/secrets\.\$\{\{[^}]*\}\}|secrets\[[^\]]*\]/g)) {
    violations.push(`secret-ref:expression:${raw[0]}`);
  }
  return [...new Set(violations)];
}

// The emitted security job set as a literal protected-main workflow document. L08a/L10a
// materialize the real .github/workflows/security-*.yml from this same map; the scan above
// then applies to the emitted files.
export function emittedSecurityWorkflow(): string {
  const lines = [
    'name: security-seat-custody', 'on:', '  workflow_dispatch:', 'permissions: {}',
    'jobs:',
  ];
  for (const [jobId, env] of Object.entries(JOB_ENVIRONMENTS)) {
    lines.push(`  ${jobId}:`, '    runs-on: ubuntu-latest');
    if (env !== null) {
      lines.push(`    environment: ${env}`, '    steps:', '      - name: Key-free preflight', '        run: echo preflight');
      for (const name of allowedSecretNames(env)) if (!name.startsWith('SEAT_STATE') && !/^SEAT_(CANDIDATE_|USE_)?[A-Z]+_\d{2}$/.test(name)) {
        lines.push(`      - name: Load ${name}`, `        run: echo "\${{ secrets.${name} }}" >/dev/null`);
      }
    } else {
      lines.push('    steps:', '      - name: Key-free preflight', '        run: echo preflight');
    }
  }
  lines.push('  security-seat-bootstrap:', '    runs-on: ubuntu-latest', '    environment: security-promotion-control',
    '    if: github.ref == \'refs/heads/main\'', '    steps:', '      - name: Key-free preflight', '        run: echo preflight',
    '      - name: launch-security-control-root', '        run: echo bootstrap', '        env:', '          ref: refs/heads/main');
  return lines.join('\n') + '\n';
}

export function assertBootstrapPlacement(text: string, opts: { merged681: boolean }): string[] {
  if (opts.merged681 !== true && opts.merged681 !== false) throw new Error('merge-state-unknown');
  const violations: string[] = [];
  if (opts.merged681) violations.push('bootstrap-closed');
  if (!/ref:\s*refs\/heads\/main/.test(text)) violations.push('bootstrap-ref:not-protected-main');
  if (/pull_request/.test(text)) violations.push('bootstrap-ref:pr');
  return violations;
}
