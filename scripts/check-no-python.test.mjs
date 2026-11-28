import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD_PATH = join(REPO_ROOT, 'scripts', 'check-no-python.mjs');

function makeTempTree(trackedFiles, { untrackedFiles = {}, allowlist = [], rawAllowlist } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-no-python-'));
  const invDir = mkdtempSync(join(tmpdir(), 'check-no-python-inv-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(GUARD_PATH, join(dir, 'scripts', 'check-no-python.mjs'));
  writeFileSync(
    join(dir, 'scripts', 'no-python-allowlist.json'),
    rawAllowlist ?? JSON.stringify({ allowedPaths: allowlist }),
  );
  for (const [rel, content] of [...Object.entries(trackedFiles), ...Object.entries(untrackedFiles)]) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const trackedList = ['scripts/check-no-python.mjs', 'scripts/no-python-allowlist.json', ...Object.keys(trackedFiles)];
  const trackedFile = join(invDir, 'tracked.z');
  const untrackedFile = join(invDir, 'untracked.z');
  writeFileSync(trackedFile, `${trackedList.join('\0')}\0`);
  const untrackedKeys = Object.keys(untrackedFiles);
  writeFileSync(untrackedFile, untrackedKeys.length ? `${untrackedKeys.join('\0')}\0` : '');
  return {
    dir,
    guardFile: join(dir, 'scripts', 'check-no-python.mjs'),
    env: { ...process.env, NO_PYTHON_TRACKED_FILE: trackedFile, NO_PYTHON_UNTRACKED_FILE: untrackedFile },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      rmSync(invDir, { recursive: true, force: true });
    },
  };
}

function runGuard(tree) {
  return spawnSync(process.execPath, [tree.guardFile], { cwd: tree.dir, env: tree.env, encoding: 'utf8' });
}

test('t1: a tree with one *.py, *.pyw, *.pyi, or *.pyx outside the allowlist fails and names the path', () => {
  for (const badPath of ['src/bad.py', 'a/b/c/evil.py', 'src/gui.pyw', 'src/types.pyi', 'src/native.pyx']) {
    const tree = makeTempTree({ [badPath]: 'x = 1\n', 'src/clean.ts': 'export const x = 1;\n' });
    try {
      const result = runGuard(tree);
      assert.equal(result.status, 1, `expected failure for ${badPath}`);
      assert.ok(`${result.stdout}\n${result.stderr}`.includes(badPath), `expected output to name ${badPath}`);
    } finally {
      tree.cleanup();
    }
  }
});

test('t1: a tree with pyproject.toml or requirements*.txt outside the allowlist fails and names the path', () => {
  for (const badPath of ['pyproject.toml', 'packages/demo/pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'api/requirements_prod.txt']) {
    const tree = makeTempTree({ [badPath]: 'requests\n', 'src/clean.ts': 'export const x = 1;\n' });
    try {
      const result = runGuard(tree);
      assert.equal(result.status, 1, `expected failure for ${badPath}`);
      assert.ok(`${result.stdout}\n${result.stderr}`.includes(badPath), `expected output to name ${badPath}`);
    } finally {
      tree.cleanup();
    }
  }
});

test('t1: an untracked non-ignored *.py fails and names the path', () => {
  const tree = makeTempTree({ 'src/clean.ts': 'export const x = 1;\n' }, { untrackedFiles: { 'src/untracked.py': 'x = 1\n' } });
  try {
    const result = runGuard(tree);
    assert.equal(result.status, 1);
    assert.ok(`${result.stdout}\n${result.stderr}`.includes('src/untracked.py'));
  } finally {
    tree.cleanup();
  }
});

test('t1: exact allowlist entries pass, while another *.py in the same directory fails', () => {
  const okTree = makeTempTree({ 'fixtures/sample.py': 'x = 1\n' }, { allowlist: ['fixtures/sample.py'] });
  try {
    const ok = runGuard(okTree);
    assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
    assert.match(ok.stdout, /ZERO PYTHON OK \(0 unexcused, 1 allowlisted data paths\)/);
  } finally {
    okTree.cleanup();
  }
  const badTree = makeTempTree({ 'fixtures/sample.py': 'x = 1\n', 'fixtures/other.py': 'x = 2\n' }, { allowlist: ['fixtures/sample.py'] });
  try {
    const bad = runGuard(badTree);
    assert.equal(bad.status, 1);
    assert.ok(`${bad.stdout}\n${bad.stderr}`.includes('fixtures/other.py'));
  } finally {
    badTree.cleanup();
  }
});

test('t1: package.json scripts and shebangs invoking Python fail and name file and line', () => {
  const cases = [
    ['package.json', '{\n  "scripts": {\n    "build": "npm run prepare && python3 build.py"\n  }\n}\n', 'package.json:1:'],
    ['packages/demo/package.json', '{"scripts":{"build":"PATH=/bin env PIP_CONFIG_FILE=/dev/null /usr/bin/pip install demo"}}\n', 'packages/demo/package.json:1:'],
    ['package.json', JSON.stringify({ scripts: { build: 'echo "$(python --version)"' } }), 'package.json:1:'],
    ['package.json', JSON.stringify({ scripts: { build: 'echo `pipx --version`' } }), 'package.json:1:'],
    ['tools/bootstrap', '#!/opt/bin/python3 -u\n', 'tools/bootstrap:1:'],
    ['tools/run.sh', '#!/usr/bin/env -S uv run --script\n', 'tools/run.sh:1:'],
  ];
  for (const [file, content, expected] of cases) {
    const tree = makeTempTree({ [file]: content });
    try {
      const result = runGuard(tree);
      assert.equal(result.status, 1, `expected failure for ${file}`);
      assert.ok(result.stderr.includes(expected), `expected ${expected} in ${result.stderr}`);
    } finally {
      tree.cleanup();
    }
  }
});

test('t1: stays silent on prose, comments, and non-command arguments', () => {
  const tree = makeTempTree({
    'README.md': 'Python projects can run `python3 demo.py`.\n',
    'package.json': JSON.stringify({
      description: 'python3 demo.py',
      scripts: { describe: "echo 'python3 demo.py && $(poetry run demo)'" },
    }),
    'tools/clean.sh': '#!/usr/bin/env bash\necho python3\n',
  });
  try {
    const result = runGuard(tree);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '');
  } finally {
    tree.cleanup();
  }
});

test('t1: fails closed when inventory is missing or allowlist is invalid or uses globs', () => {
  const noInv = makeTempTree({ 'src/clean.ts': 'export const x = 1;\n' });
  try {
    const env = { ...process.env };
    delete env.NO_PYTHON_TRACKED_FILE;
    delete env.NO_PYTHON_UNTRACKED_FILE;
    const result = spawnSync(process.execPath, [noInv.guardFile], { cwd: noInv.dir, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /cannot prove zero-python/);
  } finally {
    noInv.cleanup();
  }
  for (const rawAllowlist of ['not json', '{"allowedPaths":["*.py"]}', '{"allowedPaths":["../a.py"]}']) {
    const badAllow = makeTempTree({ 'src/clean.ts': 'export const x = 1;\n' }, { rawAllowlist });
    try {
      const result = runGuard(badAllow);
      assert.equal(result.status, 1);
    } finally {
      badAllow.cleanup();
    }
  }
});

test('t2: the repository as it is passes', () => {
  const result = spawnSync(process.execPath, [GUARD_PATH], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ZERO PYTHON OK \(0 unexcused, 0 allowlisted data paths\)/);
});
