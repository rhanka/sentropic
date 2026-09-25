// Workflow and Makefile wiring assertions for the publishable manifest guard (make test-publishable-manifests).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BOOTSTRAP_TARGETS, PACK_TARGETS, STEADY_STATE_PUBLISHERS, publishFilter } from './publishable-manifests.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
const jobs = ci.jobs;
const CTX = {
  CI_MANIFEST_CONTEXT: '${{ toJSON(needs.changes.outputs) }}',
  CI_MANIFEST_EVENT: '${{ github.event_name }}',
  CI_MANIFEST_BOOTSTRAP_TARGET: "${{ inputs.bootstrap_publish_target || 'none' }}",
};
// Baseline lint evidence on base 28bfcf9f5 (BUILD Lot G-B0): wire a package lint only when it passed.
const LINT_BASELINE = { 'cluster-mesh': 'pass', 'llm-mesh': 'pass', 'llm-gateway': 'pass' };
const recipe = (target) => {
  const m = makefile.match(new RegExp(`^${target}:[^\\n]*\\n((?:\\t[^\\n]*\\n?)+)`, 'm'));
  return m ? m[1] : null;
};
const needsOf = (job) => [jobs[job].needs ?? []].flat();

test('changes: boolean filter step without file lists plus a separate single-filter JSON list step', () => {
  const steps = jobs.changes.steps;
  const filter = steps.find((s) => s.id === 'filter');
  const files = steps.find((s) => s.id === 'publishable_files');
  assert.equal(filter.uses, 'dorny/paths-filter@v4');
  assert.equal(files.uses, 'dorny/paths-filter@v4');
  assert.equal(filter.with['list-files'], undefined);
  assert.equal(files.with['list-files'], 'json');
  assert.deepEqual(YAML.parse(files.with.filters), { publishable_package_files: ['packages/*/**'] });
  const comparison = (w) => Object.fromEntries(Object.entries(w).filter(([k]) => !['filters', 'list-files'].includes(k)));
  assert.deepEqual(comparison(files.with), comparison(filter.with), 'identical comparison inputs');
  assert.deepEqual(jobs.changes.permissions, { contents: 'read', 'pull-requests': 'read' });
  const out = jobs.changes.outputs;
  assert.equal(out.package_files, '${{ steps.publishable_files.outputs.publishable_package_files_files }}');
  assert.equal(out.matched_filters, '${{ steps.filter.outputs.changes }}');
  assert.equal(out.manifest_guard, '${{ steps.filter.outputs.manifest_guard }}');
});

test('dedicated manifest_guard filter: scripts/ci never fans out through global, api/ui/e2e or _publish', () => {
  const filters = YAML.parse(jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
  assert.deepEqual(filters.manifest_guard, ['scripts/ci/**']);
  for (const [name, globs] of Object.entries(filters)) {
    if (name !== 'manifest_guard') assert.ok(!globs.some((g) => g.startsWith('scripts/ci')), `${name} must not include scripts/ci`);
  }
});

test('inventory job is always scheduled, credential-free and never a publisher/bootstrap dependency', () => {
  const job = jobs['validate-publishable-manifests'];
  assert.deepEqual(needsOf('validate-publishable-manifests'), ['changes']);
  assert.equal(job.if, 'always() && !cancelled()');
  assert.deepEqual(job.permissions, { contents: 'read' });
  assert.equal(job.env.CI_MANIFEST_CHANGES_RESULT, '${{ needs.changes.result }}');
  for (const [k, v] of Object.entries(CTX)) assert.equal(job.env[k], v);
  const runs = job.steps.map((s) => s.run).filter(Boolean);
  assert.ok(runs.includes('make test-publishable-manifests test-qualify-published-install ENV=test-ci-manifests'));
  assert.ok(runs.includes('make check-publishable-manifests ENV=test-ci-manifests'));
  const upload = job.steps.find((s) => s.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with['retention-days'], 7);
  assert.ok(!JSON.stringify(job).includes('secrets.'), 'no registry credentials or OIDC token');
  for (const name of Object.keys(jobs)) {
    assert.ok(!needsOf(name).includes('validate-publishable-manifests'), `${name} must not need the inventory job`);
    assert.ok(!String(jobs[name].if ?? '').includes('validate-publishable-manifests'), `${name} must not gate on the inventory job`);
  }
});

test('publication filters: only packages/<slug>/** triggers a publisher, never root package.json or lockfile', () => {
  const filters = YAML.parse(jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
  const publish = Object.keys(filters).filter((n) => n.endsWith('_publish'));
  assert.ok(publish.length >= STEADY_STATE_PUBLISHERS.length);
  for (const name of publish) {
    const slug = name.slice(0, -'_publish'.length).replace(/_/g, '-');
    assert.deepEqual(filters[name], [`packages/${slug}/**`], name);
  }
  for (const slug of STEADY_STATE_PUBLISHERS) assert.ok(filters[publishFilter(slug)], `${publishFilter(slug)} exists`);
});

test('steady-state publisher mapping and bootstrap expansion match ci.yml', () => {
  const npmPublishers = Object.keys(jobs).filter((n) => /^publish-/.test(n) && !/-image$/.test(n)).map((n) => n.slice('publish-'.length)).sort();
  assert.deepEqual(npmPublishers, [...STEADY_STATE_PUBLISHERS].sort());
  for (const slug of STEADY_STATE_PUBLISHERS) {
    assert.ok(String(jobs[`publish-${slug}`].if).includes(`needs.changes.outputs.${publishFilter(slug)} == 'true'`), `publish-${slug} uses ${publishFilter(slug)}`);
  }
  const bootstrapSteps = jobs['bootstrap-publish'].steps.map((s) => s.run?.match(/^make publish-([a-z-]+)-token /)?.[1]).filter(Boolean);
  assert.deepEqual(bootstrapSteps, BOOTSTRAP_TARGETS);
  const options = ci.on.workflow_dispatch.inputs.bootstrap_publish_target.options.filter((o) => o !== 'none');
  assert.deepEqual([...options].sort(), [...BOOTSTRAP_TARGETS].sort());
  assert.ok(!needsOf('bootstrap-publish').length, 'bootstrap keeps its existing (absent) needs');
});

test('bootstrap publish requires exactly one explicit target: no all option, one declared option per step', () => {
  const input = ci.on.workflow_dispatch.inputs.bootstrap_publish_target;
  assert.ok(!input.options.includes('all'), 'no all option');
  assert.match(input.description, /exactly one explicit package/);
  const declared = input.options.filter((o) => o !== 'none');
  const job = jobs['bootstrap-publish'];
  for (const cond of [job.if, ...job.steps.map((s) => s.if)]) assert.ok(!String(cond ?? '').includes("'all'"), `no condition references all: ${cond}`);
  const guard = job.steps[0];
  assert.equal(guard.name, 'Require one explicit bootstrap target');
  assert.equal(guard.env.BOOTSTRAP_TARGET, '${{ inputs.bootstrap_publish_target }}');
  assert.ok(!guard.run.includes('${{'), 'guard reads the target from env only');
  const allowed = guard.run.match(/^\s*([a-z|-]+)\) ;;$/m)?.[1].split('|');
  assert.deepEqual([...allowed].sort(), [...declared].sort(), 'guard allow-list equals declared options');
  assert.match(guard.run, /\*\) echo "::error[^\n]*exit 1 ;;/);
  const conditioned = job.steps.filter((s) => String(s.if ?? '').includes('bootstrap_publish_target'));
  assert.ok(conditioned.length >= declared.length);
  for (const step of conditioned) {
    const m = String(step.if).match(/^inputs\.bootstrap_publish_target == '([a-z-]+)'$/);
    assert.ok(m, `${step.name}: condition is a single equality`);
    assert.ok(declared.includes(m[1]), `${step.name}: ${m[1]} is a declared option`);
    if (step.run?.startsWith('make publish-')) assert.equal(step.run.match(/^make publish-([a-z-]+)-token /)[1], m[1], `${step.name}: condition matches its target`);
  }
  for (const slug of declared) {
    assert.equal(job.steps.filter((s) => s.if === `inputs.bootstrap_publish_target == '${slug}'` && s.run?.startsWith(`make publish-${slug}-token `)).length, 1, `${slug}: one publish step`);
  }
});

// Owner freeze: these packages must not be published by any path until the owner decides (see rules/workflow.md).
const FROZEN = ['auth-hono', 'build-cli', 'focus'];

test('frozen packages are not bootstrap targets: absent from options, guard allow-list, steps and BOOTSTRAP_TARGETS', () => {
  const job = jobs['bootstrap-publish'];
  const options = ci.on.workflow_dispatch.inputs.bootstrap_publish_target.options;
  const allowed = job.steps[0].run.match(/^\s*([a-z|-]+)\) ;;$/m)?.[1].split('|');
  for (const slug of FROZEN) {
    assert.ok(!options.includes(slug), `${slug}: no dispatch option`);
    assert.ok(!allowed.includes(slug), `${slug}: not in guard allow-list`);
    assert.ok(!BOOTSTRAP_TARGETS.includes(slug), `${slug}: not in BOOTSTRAP_TARGETS`);
    for (const step of job.steps) {
      assert.ok(!String(step.if ?? '').includes(`'${slug}'`), `${slug}: no step condition (${step.name})`);
      assert.ok(!String(step.run ?? '').includes(`publish-${slug}`), `${slug}: no publish step (${step.name})`);
    }
  }
});

test('publisher ordering: gateway waits for mesh; N1 lockstep siblings gate mcp-auth and cluster-mesh', () => {
  const waits = (job, sibling) => {
    assert.ok(needsOf(job).includes(sibling), `${job} needs ${sibling}`);
    assert.ok(jobs[job].if.includes(`(needs.${sibling}.result == 'success' || needs.${sibling}.result == 'skipped')`));
    assert.ok(jobs[job].if.startsWith('always() &&'));
  };
  waits('publish-llm-gateway', 'publish-llm-mesh');
  waits('publish-mcp-auth', 'publish-oauth-verify');
  waits('publish-cluster-mesh', 'publish-events');
  waits('publish-cluster-mesh', 'publish-contracts');
  assert.ok(jobs['publish-mcp-auth'].if.includes("needs.validate-mcp-auth.result == 'success'"));
  assert.ok(jobs['publish-cluster-mesh'].if.includes("needs.validate-cluster-mesh.result == 'success'"));
  for (const slug of STEADY_STATE_PUBLISHERS) {
    assert.deepEqual(jobs[`publish-${slug}`].permissions, { contents: 'read', 'id-token': 'write' });
    assert.ok(needsOf(`publish-${slug}`).includes(`validate-${slug}`));
  }
});

test('every validation pack step receives the CI context and an explicit ENV', () => {
  let count = 0;
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps ?? []) {
      if (!/\bpack-[a-z-]+/.test(step.run ?? '') || !name.startsWith('validate-') || /pack-candidate-siblings/.test(step.run)) continue;
      count += 1;
      for (const [k, v] of Object.entries(CTX)) assert.equal(step.env?.[k], v, `${name}: ${k}`);
      assert.match(step.run, / ENV=test-ci-[a-z-]+$/);
    }
  }
  assert.equal(count, PACK_TARGETS.length);
});

test('lint wiring follows baseline evidence, independently per package, before typecheck', () => {
  for (const [slug, baseline] of Object.entries(LINT_BASELINE)) {
    const steps = jobs[`validate-${slug}`].steps;
    const lint = steps.findIndex((s) => s.run === `make lint-${slug} ENV=test-ci-${slug}`);
    const typecheck = steps.findIndex((s) => /make typecheck-/.test(s.run ?? ''));
    if (baseline === 'pass') {
      assert.ok(lint > 0 && lint < typecheck, `${slug} lint wired before typecheck`);
      assert.equal(steps[lint].env, undefined);
      assert.equal(steps[lint]['continue-on-error'], undefined);
    } else assert.equal(lint, -1, `${slug} failed baseline must stay unwired`);
    assert.ok(new RegExp(`^lint-llm-mesh lint-llm-gateway lint-cluster-mesh: lint-%:`, 'm').test(makefile));
  }
});

test('candidate and post-publication qualification for mcp-auth and cluster-mesh', () => {
  for (const [slug, peers] of [['mcp-auth', ' PEERS=hono@4.10.7'], ['cluster-mesh', '']]) {
    const steps = jobs[`validate-${slug}`].steps;
    const pack = steps.find((s) => s.id === 'pack');
    assert.equal(pack.run, `make pack-${slug} PACK_DESTINATION=tmp/ci-manifest-guard/candidate/${slug} PACK_OUTPUT_FILE="$GITHUB_OUTPUT" ENV=test-ci-${slug}`);
    const gated = steps.filter((s) => s.if === "steps.pack.outputs.manifest_mode == 'block'");
    assert.equal(gated[0].run, `make pack-candidate-siblings PACKAGE=${slug} SIBLING_DIR=tmp/ci-manifest-guard/siblings/${slug} ENV=test-ci-${slug}`);
    assert.equal(gated[1].env.CANDIDATE_TARBALL, '${{ steps.pack.outputs.tarball }}');
    assert.equal(gated[1].run, `make qualify-published-install TARBALL="$CANDIDATE_TARBALL" SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/${slug}/receipts.json${peers} REPORT_DIR=tmp/ci-manifest-guard/qualify-${slug} ENV=test-ci-${slug}`);
    const publish = jobs[`publish-${slug}`].steps;
    const at = publish.findIndex((s) => s.run === `make publish-${slug}`);
    assert.match(publish[at + 1].run, new RegExp(`publish/${slug}\\.publish-output`));
    assert.match(publish[at + 1].run, /if \[ "\$status" != published \]; then .*exit 0; fi\n.*make qualify-published-install/s, 'qualify only a new publication, never a skip');
    assert.match(publish[at + 1].run, new RegExp(`make qualify-published-install PKG="\\$pkg"${peers} QUALIFY_MODE=post-publication`));
    assert.ok(!/SIBLING_ARCHIVES_FILE|TARBALL=/.test(publish[at + 1].run), 'registry-only after publication');
    assert.equal(publish[at + 2].if, 'always()');
  }
});

test('Makefile: every pack lane is a real guarded pack; no dry-run or raw publish remains', () => {
  for (const slug of PACK_TARGETS) assert.match(recipe(`pack-${slug}`) ?? '', new RegExp(`\\$\\(call manifest_guard_pack,${slug}[,)]`), `pack-${slug}`);
  assert.ok(!/npm pack --dry-run/.test(makefile));
  assert.match(recipe('pack-chat-ui'), /manifest_guard_pack,chat-ui,\$\(MANIFEST_DIST_FORM\)/);
  assert.match(recipe('pack-cited-source-viewer'), /manifest_guard_pack,cited-source-viewer,\$\(MANIFEST_DIST_FORM\)/);
  const publishRecipes = [...makefile.matchAll(/^(publish-[a-z-]+):[^\n]*\n((?:\t[^\n]*\n?)+)/gm)].filter(([, n]) => !/-image$/.test(n));
  assert.equal(publishRecipes.length, (STEADY_STATE_PUBLISHERS.length + 1) * 2, 'OIDC + token recipe per package (focus included)');
  for (const [, name, body] of publishRecipes) {
    const slug = name.replace(/^publish-/, '').replace(/-token$/, '');
    assert.match(body, new RegExp(`\\$\\(call manifest_guard_publish,${slug},--access public`), name);
    assert.ok(!/npm publish/.test(body), `${name} never publishes a directory`);
    if (name.endsWith('-token')) assert.match(body, /NPM_TOKEN_FILE/);
    else assert.match(body, /-e ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  }
  assert.match(recipe('publish-cluster-mesh-token'), /--access public --no-provenance\)/);
  assert.match(recipe('publish-auth-hono-token'), /--access public --provenance=false\)/);
  assert.match(recipe('publish-chat-ui'), /make-publish-pkgjson.mjs --write; export MANIFEST_ORIGINAL_SOURCE=/);
});

test('sibling directory guard derives the directory from the slug and rejects anything else before any deletion', () => {
  const script = path.join(root, 'scripts', 'ci', 'check-publishable-manifests.sh');
  const run = (dir, { slug = 'foo', gitIn } = {}) => {
    // Throwaway cwd with a sentinel under tmp/ and a `make` stub that logs and fails (no real make/Docker).
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sibling-guard-'));
    try {
      fs.mkdirSync(path.join(work, 'tmp', 'keep'), { recursive: true });
      fs.writeFileSync(path.join(work, 'tmp', 'keep', 'sentinel'), 'x');
      if (gitIn) fs.mkdirSync(path.join(work, gitIn, '.git'), { recursive: true });
      fs.mkdirSync(path.join(work, 'bin'));
      fs.writeFileSync(path.join(work, 'bin', 'make'), '#!/bin/sh\necho "$*" >> "$MAKE_LOG"\nexit 1\n', { mode: 0o755 });
      const makeLog = path.join(work, 'make.log');
      const r = spawnSync('bash', [script, 'test-env', 'siblings', slug, dir], { cwd: work, encoding: 'utf8', env: { ...process.env, PATH: `${path.join(work, 'bin')}:${process.env.PATH}`, MAKE_LOG: makeLog } });
      return {
        ...r,
        made: fs.existsSync(makeLog) ? fs.readFileSync(makeLog, 'utf8') : '',
        sentinel: fs.existsSync(path.join(work, 'tmp', 'keep', 'sentinel')),
        gitKept: gitIn ? fs.existsSync(path.join(work, gitIn, '.git')) : true,
        receipts: fs.existsSync(path.join(work, 'tmp', 'ci-manifest-guard', 'siblings', 'foo', 'receipts')),
      };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  };
  const rejected = [
    ['tmp/'], ['tmp/.'], ['tmp//'], ['tmp/./x'], ['tmp/../x'], ['/tmp/x'], ['x'], ['tmp'], ['tmp/x/'], ['tmp/.hidden'], ['tmp/a b'],
    ['tmp/keep'], ['tmp/ci-manifest-guard'], ['tmp/cluster-mesh-lazy-surface'], ['tmp/ci-manifest-guard/siblings/bar'],
    ['tmp/\ntmp/x'], ['tmp/x\n/'], ['/\ntmp/x'], ['tmp/a*b'], ['tmp/a?x'], ['tmp/a[x]'],
    ['tmp/ci-manifest-guard/siblings/foo\n', { slug: 'foo\n' }], ['tmp/ci-manifest-guard/siblings/foo\ntmp', { slug: 'foo\ntmp' }],
    ['tmp/ci-manifest-guard/siblings/foo', { gitIn: 'tmp/ci-manifest-guard/siblings/foo' }],
  ];
  for (const [dir, opts] of rejected) {
    const label = JSON.stringify([dir, opts]);
    const r = run(dir, opts);
    assert.equal(r.status, 1, `${label} must be rejected`);
    assert.match(r.stdout, /ERROR: (sibling directory|invalid package slug)/, label);
    assert.ok(r.sentinel, `${label}: tmp/ must be untouched`);
    assert.ok(r.gitKept, `${label}: a checkout with .git must be untouched`);
    assert.equal(r.made, '', `${label}: rejected before any make call`);
  }
  const ok = run('tmp/ci-manifest-guard/siblings/foo');
  assert.equal(ok.status, 1, 'stubbed make fails after the guard');
  assert.doesNotMatch(ok.stdout, /ERROR: sibling directory/);
  assert.ok(ok.receipts);
  assert.ok(ok.sentinel);
  assert.match(ok.made, /^publishable-sibling-plan PACKAGE=foo SIBLING_DIR=tmp\/ci-manifest-guard\/siblings\/foo ENV=test-env$/m);
});

test('sibling Make targets gate PACKAGE/SIBLING_DIR on the host before docker and pass them as container env', () => {
  assert.match(makefile, /^SIBLING_ARGS_GATE = \$\(if \$\(and \$\(filter 1,\$\(words \$\(PACKAGE\)\)\),.*\$\(error /m);
  for (const target of ['pack-candidate-siblings', 'publishable-sibling-plan']) {
    assert.match(recipe(target).split('\n')[0], /^\t\$\(SIBLING_ARGS_GATE\)$/, `${target}: host gate is the first recipe line`);
  }
  assert.match(recipe('pack-candidate-siblings'), /siblings '\$\(PACKAGE\)' '\$\(SIBLING_DIR\)'/);
  const r = recipe('publishable-sibling-plan');
  assert.ok(r.indexOf("@case '$(PACKAGE)' in") < r.indexOf('docker run'), 'host slug check before docker run');
  assert.match(r, /-e PACKAGE="\$\(PACKAGE\)" -e SIBLING_DIR="\$\(SIBLING_DIR\)"/);
  const inner = r.slice(r.indexOf("sh -lc '"));
  assert.ok(!/\$\((?:PACKAGE|SIBLING_DIR)\)/.test(inner), 'no Make interpolation inside the container script');
  assert.match(inner, /--slug "\$\$PACKAGE"/);
  assert.match(inner, /\[ "\$\$SIBLING_DIR" = "tmp\/ci-manifest-guard\/siblings\/\$\$PACKAGE" \]/);
});

test('post-publication qualification fails on a missing or status-less receipt', () => {
  const steps = Object.values(jobs).flatMap((j) => j.steps ?? [])
    .filter((s) => /Qualify (published|bootstrap-published)/.test(s.name ?? ''));
  assert.equal(steps.length, 4);
  for (const s of steps) {
    assert.ok(!/:-missing/.test(s.run), s.name);
    assert.match(s.run, /if \[ ! -f "\$receipt" \]; then echo "::error title=Publication qualification::.*"; exit 1; fi/, s.name);
    assert.match(s.run, /if \[ -z "\$status" \]; then echo "::error title=Publication qualification::.*"; exit 1; fi/, s.name);
  }
});
