#!/usr/bin/env node
// Consumer-contract selection for the BR-83 fast path (branch
// feat/ci-consumer-contracts). Pure mapping from a classified change kind to
// the consumer validations that must run before any integration or
// deployment lane is omitted. Omission itself additionally requires
// unchanged installed tuples (installed-tuple.mjs); this module never
// approves an omission on its own.
// Runs behind root Make targets in $(LLM_MESH_NODE_IMAGE); never on the host.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { workflowExpected } from './ci-expected-results.mjs';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const loadYaml = () => {
  const toolDir = process.env.CI_EXPECTED_TOOL_DIR;
  if (!toolDir) throw new Error('CI_EXPECTED_TOOL_DIR is not set: pinned yaml is unavailable');
  return createRequire(path.join(toolDir, 'package.json'))('yaml');
};

// Proves the live workflow actually selects every consumer the change
// requires. Unknown evidence, an unselected required job, an unwired test or
// make lane, or a tuple change behind an omission claim all fail closed.
export function verifyDispatch({ kind, slugs = [], boundaries = null, workflow = null,
  workflowText = null, changes = {}, event = 'pull_request', ref = '', tuples = null,
  expectOmission = false } = {}) {
  const problems = [];
  const verdict = selectConsumers({ kind, slugs, boundaries, ref });
  const jobs = workflow ?? (workflowText !== null ? loadYaml().parse(workflowText) : null);
  if (!jobs?.jobs) problems.push('workflow is missing: cannot prove dispatch');
  const context = { changes, event, ref, inputs: {} };
  let expected = [];
  if (jobs?.jobs) {
    try {
      expected = workflowExpected(jobs, context);
    } catch (error) {
      problems.push(`workflow selection is unreadable: ${error.message}`);
    }
  }
  // Matrix jobs expand to `name (member)` rows; a bare identity matches the
  // job and every member, like the DAG conformance check.
  const membersOf = (identity) => expected.filter((row) => row.job === identity
    || row.job.startsWith(`${identity} (`));
  const text = workflowText ?? '';
  // Full integration omits nothing, so it requires everything the change
  // selects — but every affected component must still own a validation or a
  // contract, otherwise the gap has no lane that could catch it.
  if (verdict.selection === 'full' || verdict.selection === 'adopted') {
    for (const slug of slugs) {
      const component = boundaries.components.find((row) => row.slug === slug);
      const hasValidation = component?.validation !== null && component?.validation !== undefined
        && membersOf(component.validation).length > 0;
      const hasContract = contractTestsFor(slug, boundaries).length > 0;
      if (!hasValidation && !hasContract) {
        problems.push(`no owning validation for ${slug}: full integration cannot prove it`);
      }
    }
  }
  if (verdict.selection === 'full') {
    const mandatory = new Set([...INTEGRATION_LANES,
      ...boundaryValidations(slugs, boundaries).map(item => item.identity)]);
    // Unrelated package validators remain change-scoped; full integration and
    // affected owners are obligations even when dispatch omits or removes them.
    verdict.required = verdict.required.filter((item) => item.kind !== 'job'
      || mandatory.has(item.identity)
      || membersOf(item.identity).some((row) => row.required !== false && row.selected !== false));
  }
  for (const item of verdict.required) {
    if (item.kind === 'job') {
      const members = membersOf(item.identity).filter((row) => row.required !== false);
      if (members.length === 0) problems.push(`required consumer ${item.identity} has no workflow job`);
      else if (members.every((row) => row.selected === false)) {
        problems.push(`required consumer ${item.identity} is not selected for this change`);
      }
    } else if (!text.includes(item.via ?? item.identity)) {
      problems.push(`required consumer ${item.kind} ${item.identity} is not wired in the workflow`);
    }
  }
  // Only selections that omit consumer work need tuple proof: full and
  // adopted selections omit nothing, so their tuple drift is informational.
  // UI/shared dispatch retains its own validation/build policy and requires
  // identical dependency/image inputs. Only the library boundary fast path
  // claims omission based on candidate contracts, so it additionally needs
  // qualified bytes. CI intentionally supplies no candidates for UI/shared.
  const omissionGated = verdict.selection !== 'full' && verdict.selection !== 'adopted';
  if (verdict.selection === 'deployment' && ['before', 'after'].some((side) =>
    !['api', 'ui'].every((app) => isPlainObject(tuples?.[side]?.[app])))) {
    problems.push('installed api/ui tuples are missing: deployment-only selection is unproven');
  }
  if (tuples !== null && tuples !== undefined && omissionGated) {
    if (!isPlainObject(tuples.before) || !isPlainObject(tuples.after)) {
      problems.push('installed tuples are missing: omission is unproven');
    } else {
      const names = [...new Set([...Object.keys(tuples.before), ...Object.keys(tuples.after)])].sort();
      for (const name of names) {
        const a = tuples.before[name];
        const b = tuples.after[name];
        if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
          problems.push(`installed tuple changed for ${name}: omission requires identical tuples`);
        }
      }
      const unqualified = names.filter((name) => {
        const row = tuples.after[name];
        return verdict.fastPath === 'tuple-gated' && row?.closure
          && Object.values(row.closure).some((entry) => entry?.qualified === false);
      });
      for (const name of unqualified) {
        problems.push(`installed tuple for ${name} resolves linked sources without candidate bytes: omission is unproven`);
      }
    }
  }
  if (expectOmission && verdict.fastPath !== 'tuple-gated') {
    problems.push(`omission claimed for ${kind} selection ${verdict.selection}: only tuple-gated boundaries may omit`);
  }
  return { ok: problems.length === 0, problems, selection: verdict.selection, required: verdict.required, fastPath: verdict.fastPath };
}

export function loadBoundaries(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`unreadable consumer boundaries ${file}: ${error.message}`);
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.components) || !Array.isArray(parsed.boundaries)) {
    throw new Error(`invalid consumer boundaries ${file}: components and boundaries are required`);
  }
  return parsed;
}

// Deterministic integration lanes: the complete consumer-side suite. Live
// provider lanes stay change-filter selected and are never implied here.
export const INTEGRATION_LANES = ['test-api-unit-integration', 'test-api-sut', 'test-ui', 'test-e2e',
  'e2e-vscode', 'smoke-idp-screens'];

const CONSUMER_LANES = {
  api: [{ kind: 'job', identity: 'test-api-unit-integration' }, { kind: 'job', identity: 'test-api-sut' }],
  ui: [{ kind: 'job', identity: 'test-ui' }],
  'auth-idp': [{ kind: 'job', identity: 'smoke-idp-screens' }],
  'llm-gateway': [{ kind: 'make', identity: 'test-llm-gateway-process' }],
};

export function contractTestsFor(slug, boundaries) {
  if (!isPlainObject(boundaries)) throw new Error('consumer boundaries are required');
  return boundaries.boundaries.filter((row) => row.package === slug).flatMap((row) => row.contracts ?? []);
}

const boundaryValidations = (slugs, boundaries) => {
  const jobs = new Set();
  for (const slug of slugs) {
    const component = boundaries.components.find((row) => row.slug === slug);
    if (component?.validation) jobs.add(component.validation);
  }
  return [...jobs].map((identity) => ({ kind: 'job', identity }));
};

const fullSelection = (boundaries, reason) => {
  const required = [
    ...boundaries.components.filter((row) => row.validation !== null)
      .map((row) => ({ kind: 'job', identity: row.validation })),
    ...INTEGRATION_LANES.map((identity) => ({ kind: 'job', identity })),
  ];
  return { selection: 'full', required, fastPath: false, reasons: [reason] };
};

export function selectConsumers({ kind, slugs = [], boundaries = null, ref = '' } = {}) {
  if (!isPlainObject(boundaries)) throw new Error('consumer boundaries are required');
  const policy = boundaries.policies?.[kind];
  if (!policy) throw new Error(`unknown change kind: ${kind}`);
  if (policy.selection === 'deployment') {
    return { selection: 'deployment', required: [{ kind: 'job', identity: 'validate-idp-sync' }],
      fastPath: false, reasons: [`${kind}: ${policy.note}`] };
  }
  if (policy.selection === 'documentation') {
    return { selection: 'documentation', required: [], fastPath: false, reasons: [`${kind}: ${policy.note}`] };
  }
  if (policy.selection === 'full') {
    return fullSelection(boundaries, `${kind}: ${policy.note}`);
  }
  if (policy.selection === 'adopted') {
    const edges = boundaries.boundaries.filter((row) => slugs.includes(row.package));
    const required = [
      ...edges.flatMap((row) => (row.contracts ?? []).map((identity) => ({ kind: 'test', identity }))),
      ...boundaryValidations(slugs, boundaries),
      ...edges.flatMap((row) => row.consumers.flatMap((consumer) => CONSUMER_LANES[consumer] ?? [])),
    ];
    return { selection: 'adopted', required, fastPath: false,
      reasons: [`${kind}: ${policy.note}`, `adopted packages: ${slugs.join(', ') || 'none'}`] };
  }
  if (policy.selection === 'boundary') {
    const contracts = slugs.flatMap((slug) => contractTestsFor(slug, boundaries));
    if (slugs.length === 0 || contracts.length === 0) {
      return fullSelection(boundaries, `${kind}: no contract covers ${slugs.join(', ') || 'no packages'}; fail closed to full integration`);
    }
    const lanes = boundaries.contractLanes ?? {};
    const peerQualifications = boundaries.boundaries
      .filter((row) => slugs.includes(row.package) && row.peerQualification)
      .map((row) => ({ kind: 'job', identity: row.peerQualification }));
    return { selection: 'boundary',
      required: [
        ...contracts.map((identity) => ({ kind: 'test', identity, via: lanes[identity] ?? identity })),
        ...boundaryValidations(slugs, boundaries),
        ...peerQualifications,
      ],
      fastPath: 'tuple-gated', reasons: [`${kind}: ${policy.note}`] };
  }
  if (policy.selection === 'ui') {
    return { selection: 'ui',
      required: ['test-ui', 'build-ui', 'smoke-idp-screens', ...(ref === 'refs/heads/main' ? ['deploy-preprod'] : [])]
        .map((identity) => ({ kind: 'job', identity })),
      fastPath: false,
      reasons: [`${kind}: ${policy.note}`, 'API digest unchanged proven by installed-tuple comparison'] };
  }
  if (policy.selection === 'shared') {
    return { selection: 'shared',
      required: ['validate-auth-ui', 'test-ui', 'smoke-idp-screens', 'build-api-image', 'build-ui',
        ...(ref === 'refs/heads/main' ? ['deploy-preprod'] : [])]
        .map((identity) => ({ kind: 'job', identity })),
      fastPath: false, reasons: [`${kind}: ${policy.note}`] };
  }
  throw new Error(`unsupported selection: ${policy.selection}`);
}

if (process.argv[1] && import.meta.url.endsWith('/consumer-contracts.mjs') && process.argv.includes('--select')) {
  const read = (flag) => {
    const at = process.argv.indexOf(flag);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  try {
    const boundaries = loadBoundaries(read('--boundaries') ?? 'scripts/ci/consumer-boundaries.json');
    const verdict = selectConsumers({ kind: read('--kind'), slugs: JSON.parse(read('--slugs') ?? '[]'), boundaries });
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
    if (verdict.selection === 'full') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`::error::consumer-contracts: ${error?.message ?? error}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url.endsWith('/consumer-contracts.mjs') && process.argv.includes('--verify')) {
  const read = (flag) => {
    const at = process.argv.indexOf(flag);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  try {
    const { classifyCompatibility } = await import('./compatibility-classifier.mjs');
    const boundaries = loadBoundaries(read('--boundaries') ?? 'scripts/ci/consumer-boundaries.json');
    const loadJson = (inline, file) => JSON.parse(
      inline !== undefined ? inline : file !== undefined ? fs.readFileSync(file, 'utf8') : '[]');
    const files = loadJson(read('--files'), read('--files-file'));
    const packages = loadJson(read('--packages'), read('--packages-file'));
    const changes = JSON.parse(read('--changes') ?? process.env.VERIFY_CHANGES_JSON ?? '{}');
    const tuplesRaw = read('--tuples') ?? (read('--tuples-file') === undefined
      ? undefined : fs.readFileSync(read('--tuples-file'), 'utf8'));
    const { kind, reasons } = classifyCompatibility({ files, packages });
    const slugs = packages
      .filter((entry) => files.some((file) => file === `packages/${entry.slug}/package.json`
        || file.startsWith(`packages/${entry.slug}/src/`)
        || file === `${entry.slug}/package.json` || file === `apps/${entry.slug}/package.json`)
        || JSON.stringify(entry.published ?? null) !== JSON.stringify(entry.candidate ?? null))
      .map((entry) => entry.slug);
    const workflowPath = read('--workflow') ?? '.github/workflows/ci.yml';
    const workflowText = fs.readFileSync(workflowPath, 'utf8');
    const verdict = verifyDispatch({ kind, slugs, boundaries, workflowText, changes,
      event: read('--event') ?? process.env.VERIFY_EVENT ?? 'pull_request',
      ref: read('--ref') ?? process.env.VERIFY_REF ?? '',
      tuples: tuplesRaw === undefined ? null : JSON.parse(tuplesRaw),
      expectOmission: (read('--expect-omission') ?? process.env.VERIFY_EXPECT_OMISSION ?? 'false') === 'true' });
    process.stdout.write(`${JSON.stringify({ kind, classificationReasons: reasons, ...verdict }, null, 2)}\n`);
    if (!verdict.ok) {
      for (const problem of verdict.problems) process.stderr.write(`::error::consumer-contracts: ${problem}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`::error::consumer-contracts: ${error?.message ?? error}\n`);
    process.exitCode = 2;
  }
}
