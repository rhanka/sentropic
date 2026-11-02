// ACT-L04 L4-A/L4-B contract tests (make test-security-daily SCOPE=... ENV=test-cyber-L04).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inventorySastRoots } from './inventory.mjs';
import { L04_ACCEPTANCE, validateDisposition } from './acceptance-disposition.mjs';
import { BASELINE_CATEGORIES, loadSastContract, planSastTasks, sastRunner, validateSastReport } from './sast.mjs';
import { loadContract } from './schema.mjs';

const parseYaml = createRequire(join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml').parse;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contract = loadSastContract('.', parseYaml);

function cloneAstGrep(t) {
  const root = mkdtempSync(join(tmpdir(), 'sast-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync('.security/ast-grep', join(root, '.security/ast-grep'), { recursive: true });
  cpSync('scripts/security/daily/fixtures/sast', join(root, 'scripts/security/daily/fixtures/sast'), { recursive: true });
  return root;
}

test('L4-A: every baseline category has frozen local rules with matching hashes and fixtures', () => {
  assert.equal(contract.rules.size, 11);
  for (const category of BASELINE_CATEGORIES) {
    assert.ok([...contract.rules.values()].some((rule) => rule.category === category), category);
  }
  for (const rule of contract.rules.values()) {
    assert.equal(rule.mappedSeverity, contract.manifest.severityMap[rule.severity]);
    assert.ok(readFileSync(rule.positive, 'utf8').length > 0);
    assert.ok(readFileSync(rule.negative, 'utf8').length > 0);
    assert.ok(rule.doc.rule.pattern || rule.doc.rule.any, `rule ${rule.id} needs a pattern`);
  }
  assert.deepEqual([...contract.coveredExtensions].sort(), ['.cjs', '.js', '.mjs', '.ts', '.tsx']);
});

test('L4-A: remote ruleDirs, tampered sgconfig/rule bytes or a missing rule file block admission', (t) => {
  const root = cloneAstGrep(t);
  const reload = () => loadSastContract(root, parseYaml);
  assert.equal(reload().rules.size, 11);
  const configPath = join(root, '.security/ast-grep/sgconfig.yml');
  const manifestPath = join(root, '.security/ast-grep/rules-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(configPath, 'ruleDirs:\n  - https://evil.example/rules\n');
  manifest.config.sha256 = sha256(readFileSync(configPath));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(reload, /runtime rule download/);
  writeFileSync(configPath, 'ruleDirs:\n  - rules\n  - ../escape\n');
  manifest.config.sha256 = sha256(readFileSync(configPath));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(reload, /local relative paths/);
  cpSync('.security/ast-grep/sgconfig.yml', configPath);
  manifest.config.sha256 = sha256(readFileSync(configPath));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const rulePath = join(root, '.security/ast-grep/rules/no-eval.yml');
  writeFileSync(rulePath, readFileSync(rulePath, 'utf8').replace('eval($$$ARGS)', 'eval($$$A)'));
  assert.throws(reload, /rule hash mismatch: no-eval/);
  rmSync(rulePath);
  assert.throws(reload, /missing frozen rule file/);
});

test('L4-A: severity mapping gap, missing fixture, unqualified receipt or parity gap blocks', (t) => {
  const root = cloneAstGrep(t);
  const manifestPath = join(root, '.security/ast-grep/rules-manifest.json');
  const edit = (fn) => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    fn(manifest);
    writeFileSync(manifestPath, JSON.stringify(manifest));
  };
  const reload = () => loadSastContract(root, parseYaml);
  edit((m) => { m.severityMap.error = 'LOW'; });
  assert.throws(reload, /severity mapping gap: no-eval/);
  edit((m) => { m.severityMap.error = 'HIGH'; delete m.rules.find((r) => r.id === 'no-eval').positive; });
  assert.throws(reload, /missing positive fixture for rule: no-eval/);
  edit((m) => { m.rules.find((r) => r.id === 'no-eval').positive = 'scripts/security/daily/fixtures/sast/positive/no-eval.ts'; m.validationReceipt.perRule['no-eval'] = { positive: 1, negative: 1 }; });
  assert.throws(reload, /unqualified rule fixtures: no-eval/);
  edit((m) => { m.validationReceipt.perRule['no-eval'] = { positive: 1, negative: 0 }; m.rules = m.rules.filter((r) => r.id !== 'no-cors-wildcard'); });
  assert.throws(reload, /parity gap.*cors/);
});

test('L4-A: planSastTasks runs every inventoried root and blocks missing roots or uncovered extensions', () => {
  const sast = inventorySastRoots(loadContract(), '.');
  const { tasks, blockers } = planSastTasks('.', contract, sast);
  assert.deepEqual(tasks.map((task) => task.target).sort(), [...sast.roots].sort());
  assert.deepEqual(blockers, []);
  for (const task of tasks) {
    assert.match(task.blocked, /L02/);
    assert.deepEqual(task.args, ['scan', '--config', contract.configPath, '--json=compact', task.target]);
  }
  const fenced = planSastTasks('.', contract, { roots: ['missing/src', 'api/src'], sourceFiles: ['api/src/a.ts', 'api/src/b.jsx'] });
  assert.ok(fenced.blockers.some((b) => b.includes('sast root missing: missing/src')));
  assert.ok(fenced.blockers.some((b) => /uncovered source extensions.*\.jsx/.test(b)));
  assert.equal(fenced.tasks.filter((task) => task.kind === 'sast').length, 1);
});

test('L4-A: validateSastReport maps severity and rejects unknown, drifted, out-of-root or malformed reports', () => {
  const task = { target: 'api/src' };
  const good = JSON.stringify([{ ruleId: 'no-eval', severity: 'error', file: 'api/src/x.ts',
    message: 'Do not use eval().', range: { start: { line: 2 } } }]);
  const findings = validateSastReport(good, contract, task);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'HIGH');
  assert.equal(findings[0].id, 'ast-grep:no-eval');
  assert.equal(findings[0].line, 2);
  for (const bad of ['{not-json', '{}', 'null',
    JSON.stringify([{ ruleId: 'nope', severity: 'error', file: 'api/src/x.ts' }]),
    JSON.stringify([{ ruleId: 'no-eval', severity: 'warning', file: 'api/src/x.ts' }]),
    JSON.stringify([{ ruleId: 'no-eval', severity: 'error', file: 'ui/src/x.ts' }])]) {
    assert.throws(() => validateSastReport(bad, contract, task), /malformed|invalid|unknown|drift|outside/);
  }
});

test('L4-B: toolbox Dockerfile carries the pinned native binary with zero Python and no install hooks', () => {
  const dockerfile = readFileSync('api/Dockerfile', 'utf8');
  const pin = contract.pin;
  assert.ok(dockerfile.includes(pin.origin), 'release asset URL');
  assert.ok(dockerfile.includes(`${pin.sha256}  /tmp/ast-grep.zip`), 'sha256 verification line');
  assert.match(dockerfile, /sha256sum -c -/);
  assert.match(dockerfile, /unzip -q -o \/tmp\/ast-grep\.zip -d \/opt\/ast-grep/);
  assert.ok(dockerfile.includes('COPY --from=ci-tool-base /opt/ast-grep /opt/ast-grep'));
  assert.ok(dockerfile.includes('COPY .security/ast-grep /workspace/.security/ast-grep'));
  for (const forbidden of contract.manifest.toolbox.zeroPython.toolboxDockerfileForbids) {
    assert.ok(!dockerfile.toLowerCase().includes(forbidden), `forbidden token: ${forbidden}`);
  }
  assert.ok(!/ast-grep[^\n]*(npm (install|ci))|(npm (install|ci))[^\n]*ast-grep/i.test(dockerfile), 'no npm install of ast-grep');
  assert.ok(!/postinstall/i.test(dockerfile), 'no install hooks');
});

test('L4-A..E acceptance dispositions are declared with concrete destinations in the required suite', () => {
  assert.deepEqual(validateDisposition(L04_ACCEPTANCE), []);
  assert.deepEqual(L04_ACCEPTANCE.map((row) => row.id), ['L4-A', 'L4-B', 'L4-C', 'L4-D', 'L4-E']);
  assert.ok(L04_ACCEPTANCE.every((row) => row.owner === 'ACT-L04' && row.suite === 'test-security-daily'));
});

test('L4-B: the runner requires the pinned native ELF binary; a Node wrapper never substitutes', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sast-runner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const elf = join(dir, 'ast-grep');
  writeFileSync(elf, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]));
  const wrapper = join(dir, 'sg.js');
  writeFileSync(wrapper, 'console.log("ast-grep 0.51.0");\n');
  const execute = (cmd, args) => ({ status: 0, stdout: args[0] === '--version' ? 'ast-grep 0.51.0\n' : '[]' });
  process.env.AST_GREP_BIN = elf;
  const run = sastRunner('.', contract, execute);
  assert.equal(run({ kind: 'sast', args: ['scan'] }).stdout, '[]');
  assert.throws(() => run({ kind: 'npm', args: [] }), /sast runner only/);
  process.env.AST_GREP_BIN = wrapper;
  assert.throws(() => sastRunner('.', contract, execute), /ELF/);
  process.env.AST_GREP_BIN = elf;
  assert.throws(() => sastRunner('.', contract, () => ({ status: 0, stdout: 'ast-grep 0.50.0\n' })), /version does not match/);
  delete process.env.AST_GREP_BIN;
});
