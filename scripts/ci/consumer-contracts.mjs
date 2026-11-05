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
  const verdict = selectConsumers({ kind, slugs, boundaries });
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
  const selected = new Map(expected.map((row) => [row.job, row]));
  const text = workflowText ?? '';
  // Full integration omits nothing, so it requires everything the change
  // selects — but every affected component must still own a validation or a
  // contract, otherwise the gap has no lane that could catch it.
  if (verdict.selection === 'full' || verdict.selection === 'adopted') {
    for (const slug of slugs) {
      const component = boundaries.components.find((row) => row.slug === slug);
      const hasValidation = component?.validation !== null && component?.validation !== undefined
        && selected.get(component.validation)?.selected !== false;
      const hasContract = contractTestsFor(slug, boundaries).length > 0;
      if (!hasValidation && !hasContract) {
        problems.push(`no owning validation for ${slug}: full integration cannot prove it`);
      }
    }
  }
  if (verdict.selection === 'full') {
    verdict.required = verdict.required.filter((item) => item.kind !== 'job'
      || selected.get(item.identity)?.selected !== false);
  }
  for (const item of verdict.required) {
    if (item.kind === 'job') {
      const row = selected.get(item.identity);
      if (!row) problems.push(`required consumer ${item.identity} has no workflow job`);
      else if (row.required === false) problems.push(`required consumer ${item.identity} is not a required check`);
      else if (row.selected === false) problems.push(`required consumer ${item.identity} is not selected for this change`);
    } else if (!text.includes(item.via ?? item.identity)) {
      problems.push(`required consumer ${item.kind} ${item.identity} is not wired in the workflow`);
    }
  }
  // Only selections that omit consumer work need tuple proof: full and
  // adopted selections omit nothing, so their tuple drift is informational.
  // Proof is identical tuples with every linked dependency qualified by
  // candidate bytes; unqualified workspace resolution never omits work.
  const omissionGated = verdict.selection !== 'full' && verdict.selection !== 'adopted';
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
        return row?.closure && Object.values(row.closure).some((entry) => entry?.qualified === false);
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
export const INTEGRATION_LANES = ['test-api-unit-integration', 'test-ui', 'test-e2e',
  'e2e-vscode', 'smoke-idp-screens'];

const CONSUMER_LANES = {
  api: [{ kind: 'job', identity: 'test-api-unit-integration' }],
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
