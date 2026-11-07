import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { INPUTS, satisfies } from './api-tool-deps-key.mjs';

// Oracle: the semver package of the npm bundled with the test image's Node.
const npm = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'package.json');
const semver = createRequire(npm)('semver');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const lockRanges = Object.values(lock.packages).flatMap(entry =>
  ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap(section => Object.values(entry[section] ?? {})));
const VERSIONS = ['0.0.0', '0.0.1-rc.1', '0.0.1', '0.0.3', '0.0.4', '0.1.0', '0.2.0', '0.2.18', '0.2.20', '0.3.0-0', '0.3.0',
  '0.19.2', '0.22.4', '0.26.0-dev.9', '0.26.0-dev.14', '0.26.0-dev.15', '0.26.0', '0.26.1-dev.1', '0.33.0', '0.34.1', '1.0.0-rc.1',
  '1.0.0', '1.0.1', '1.2.3-1', '1.2.3-a-b', '1.2.3-alpha', '1.2.3-alpha.1', '1.2.3-beta.2', '1.2.3-beta.10', '1.2.3', '1.3.0',
  '2.0.0-0', '2.0.0', '4.5.6'];
const RANGES = ['*', '', '^0.0.0', '^0.0.3', '~0.0.1', '^0.0.1-rc.1', '^0.2.0', '~0.2.18', '>=0.2.0 <0.3.0', '^0.26.0-dev.14',
  '>=0.26.0-dev.14 <0.27.0', '0.26.0-dev.14', '^1.0.0', '~1.2.3', '^1.2.3-beta.2', '~1.2.3-beta.2 ^1.2.0', '<=1.2.3-beta.2',
  '>1.2.3-beta.2', '>1.0.0 <=1.3.0', '<1.0.0 || >=2.0.0', '=1.0.0', '^0.34.1 || ^1.0.0', '>=1.2.3-alpha <1.2.3', '<2.0.0-0', '>0.0.0'];

test('should agree with npm semver on every evaluated range of the lock and on prerelease cases', () => {
  let checked = 0;
  for (const range of new Set([...RANGES, ...lockRanges])) {
    for (const version of VERSIONS) {
      const mine = satisfies(version, range);
      if (mine === null) continue;
      checked += 1;
      // npm dep-valid accepts '' and '*' before semver (which would refuse a prerelease).
      assert.equal(mine, range === '' || range === '*' || semver.satisfies(version, range, true), `${version} against ${range}`);
    }
  }
  assert.ok(checked > 10000, `only ${checked} comparisons`);
});

test('should refuse to evaluate a spec outside the full-version subset', () => {
  for (const range of ['1.x', 'x', '1.2', '>= 1.2.3', '1.2.3 - 2.0.0', 'latest', 'npm:left-pad@^1.0.0', 'workspace:*', '^1.2.3 ||',
    '~>1.2.3', 'v1.2.3', '1.2.3+build', '01.2.3', '1.2.3-01', ' ']) assert.equal(satisfies('1.2.3', range), null, range);
  assert.equal(satisfies(undefined, '^1.0.0'), false);
  assert.equal(satisfies(undefined, '*'), true);
});

test('should evaluate every range edge onto a workspace of the current lock', () => {
  const workspaces = new Set(Object.entries(lock.packages).filter(([, entry]) => entry.link).map(([key]) => key.split('node_modules/').pop()));
  const edges = Object.values(lock.packages).flatMap(entry => ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap(section => Object.entries(entry[section] ?? {}))).filter(([name, spec]) => workspaces.has(name) && !spec.startsWith('file:'));
  assert.ok(edges.length > 0);
  for (const [name, spec] of edges) assert.notEqual(satisfies('0.0.0', spec), null, `${name}@${spec}`);
});

// Build-context reads of a Dockerfile target: COPY/ADD sources without --from and bind mounts of
// every stage it reaches. A base outside the file must be digest-pinned (the Dockerfile is hashed).
function contextSources(dockerfile, target) {
  const stages = new Map();
  let stage = null;
  let heredoc = null;
  for (const line of dockerfile.replace(/\\\n/g, ' ').split('\n')) {
    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null;
      continue;
    }
    const [op = '', ...args] = line.trim().split(/\s+/);
    const words = args.filter(arg => !arg.startsWith('--'));
    if (/^FROM$/i.test(op)) {
      stage = { base: words[0], parents: [], sources: [] };
      stages.set(/^as$/i.test(words[1] ?? '') ? words[2] : `#${stages.size}`, stage);
    } else if (/^(COPY|ADD)$/i.test(op)) {
      const from = args.find(arg => arg.startsWith('--from='));
      if (from) stage.parents.push(from.slice('--from='.length));
      else stage.sources.push(...words.slice(0, -1));
    } else if (/^RUN$/i.test(op)) {
      stage.sources.push(...args.filter(arg => arg.startsWith('--mount=') && !/^--mount=type=(cache|secret|tmpfs)\b/.test(arg)));
    }
    heredoc = /<<-?['"]?(\w+)['"]?/.exec(line)?.[1] ?? null;
  }
  const sources = [];
  const seen = new Set();
  for (const queue = [target]; queue.length;) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    assert.ok(stages.has(name), `unknown stage ${name}`);
    sources.push(...stages.get(name).sources);
    for (const parent of [stages.get(name).base, ...stages.get(name).parents]) {
      if (stages.has(parent)) queue.push(parent);
      else assert.match(parent, /@sha256:[a-f0-9]{64}$/, `${name} reads ${parent}`);
    }
  }
  return sources;
}
const covered = path => INPUTS.some(spec => (spec.startsWith(':(glob)')
  ? new RegExp(`^${spec.slice(':(glob)'.length).replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`).test(path) : spec === path));

test('should hash every build-context file the ci-tool-deps stages read', () => {
  const sources = contextSources(readFileSync('api/Dockerfile', 'utf8'), 'ci-tool-deps');
  for (const expected of ['package-lock.json*', 'api/package.json', 'packages/artifacts/package.json', 'scripts/ci/tool-locks.json']) {
    assert.ok(sources.includes(expected), expected);
  }
  for (const source of sources) assert.ok(covered(source.replace(/\*$/, '')), `${source} is read by ci-tool-deps but not hashed`);
  for (const input of ['api/Dockerfile', '.dockerignore', 'scripts/ci/api-tool-deps-key.mjs']) assert.ok(INPUTS.includes(input), input);
  // A plain git pathspec `*` also matches nested fixture manifests, which no deps stage copies.
  assert.ok(INPUTS.every(spec => !spec.includes('*') || spec.startsWith(':(glob)')));
  assert.ok(!covered('packages/cluster-mesh/tests/packaging/fixtures/selected/package.json'));
});
