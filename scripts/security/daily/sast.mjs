// S2c (ACT-L04): qualified native ast-grep SAST contract. Live execution stays fenced on L02.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const SAST_CONFIG = '.security/ast-grep/sgconfig.yml';
export const SAST_MANIFEST = '.security/ast-grep/rules-manifest.json';

// Mandatory baseline categories; every one needs at least one frozen local rule.
export const BASELINE_CATEGORIES = ['code-execution', 'command-execution', 'sql-injection', 'xss',
  'secret-management', 'weak-crypto', 'tls', 'path-handling', 'cors'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function yamlTool() {
  const dir = process.env.MANIFEST_GUARD_TOOL_DIR;
  if (!dir) throw new Error('coverage-blocked: yaml tool unavailable (MANIFEST_GUARD_TOOL_DIR)');
  return createRequire(join(dir, 'package.json'))('yaml');
}

const isElf = (path) => {
  const fd = openSync(path, 'r');
  try {
    const magic = Buffer.alloc(4);
    if (readSync(fd, magic, 0, 4, 0) !== 4) return false;
    return magic[0] === 0x7f && magic.toString('latin1', 1, 4) === 'ELF';
  } finally { closeSync(fd); }
};

export function loadSastContract(root = '.', parseYaml) {
  const parse = parseYaml || yamlTool().parse;
  const manifestPath = join(root, SAST_MANIFEST);
  if (!existsSync(manifestPath)) throw new Error('coverage-blocked: sast rules manifest missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 'ast-grep-rules-manifest-v1' || !Array.isArray(manifest.rules) || !manifest.rules.length) {
    throw new Error('coverage-blocked: sast rules manifest schema');
  }
  const configPath = join(root, manifest.config.path);
  const configBytes = readFileSync(configPath);
  if (sha256(configBytes) !== manifest.config.sha256) throw new Error('coverage-blocked: sast sgconfig hash mismatch');
  const configText = configBytes.toString('utf8');
  if (/https?:\/\//i.test(configText)) throw new Error('coverage-blocked: sast runtime rule download (remote reference in sgconfig)');
  const config = parse(configText);
  if (!Array.isArray(config.ruleDirs) || !config.ruleDirs.length ||
    config.ruleDirs.some((dir) => typeof dir !== 'string' || isAbsolute(dir) || /https?:\/\//i.test(dir) || dir.startsWith('..'))) {
    throw new Error('coverage-blocked: sast ruleDirs must be local relative paths');
  }
  for (const dir of config.ruleDirs) {
    if (!existsSync(join(root, manifest.config.path, '..', dir))) throw new Error(`coverage-blocked: sast ruleDir missing: ${dir}`);
  }
  const globs = config.languageGlobs?.TypeScript;
  if (!Array.isArray(globs) || !globs.length) throw new Error('coverage-blocked: sast languageGlobs missing');
  const covered = new Set(globs.map((glob) => glob.replace(/^\*\*\//, '').replace(/^\*/, '')));
  const rules = new Map();
  for (const rule of manifest.rules) {
    const rulePath = join(root, rule.file);
    if (!existsSync(rulePath)) throw new Error(`coverage-blocked: missing frozen rule file: ${rule.file}`);
    const bytes = readFileSync(rulePath);
    if (sha256(bytes) !== rule.sha256) throw new Error(`coverage-blocked: rule hash mismatch: ${rule.id}`);
    const doc = parse(bytes.toString('utf8'));
    if (doc.id !== rule.id || !doc.rule || !['error', 'warning', 'info'].includes(doc.severity) || doc.language !== 'TypeScript') {
      throw new Error(`coverage-blocked: malformed rule document: ${rule.id}`);
    }
    if (manifest.severityMap[doc.severity] !== rule.mappedSeverity) {
      throw new Error(`coverage-blocked: severity mapping gap: ${rule.id}`);
    }
    for (const kind of ['positive', 'negative']) {
      const fixture = rule[kind];
      if (typeof fixture !== 'string' || !existsSync(join(root, fixture))) {
        throw new Error(`coverage-blocked: missing ${kind} fixture for rule: ${rule.id}`);
      }
    }
    const receipt = manifest.validationReceipt?.perRule?.[rule.id];
    if (!receipt || receipt.positive < 1 || receipt.negative !== 0) {
      throw new Error(`coverage-blocked: unqualified rule fixtures: ${rule.id}`);
    }
    rules.set(rule.id, { ...rule, doc });
  }
  const categories = new Set(manifest.rules.map((rule) => rule.category));
  for (const category of BASELINE_CATEGORIES) {
    if (!categories.has(category)) throw new Error(`coverage-blocked: unqualified parity gap, no frozen rule for baseline category: ${category}`);
  }
  const pin = manifest.toolbox?.pin;
  if (!pin || pin.version !== '0.51.0' || !/^[a-f0-9]{64}$/.test(pin.sha256 || '') ||
    !/^https:\/\/github\.com\/ast-grep\/ast-grep\/releases\/download\//.test(pin.origin || '')) {
    throw new Error('coverage-blocked: sast toolbox pin provenance');
  }
  return Object.freeze({ manifest, rules, coveredExtensions: covered, configPath: manifest.config.path, pin });
}

export function planSastTasks(root, contract, sast) {
  const tasks = [];
  const blockers = [];
  for (const rootPath of sast.roots) {
    if (!existsSync(join(root, rootPath))) {
      blockers.push(`sast root missing: ${rootPath}`);
      continue;
    }
    const uncovered = [...new Set((sast.sourceFiles || [])
      .filter((file) => file.startsWith(`${rootPath}/`) || file === rootPath)
      .map((file) => file.slice(file.lastIndexOf('.')))
      .filter((ext) => /\.[cm]?[jt]sx?$/.test(ext) && !contract.coveredExtensions.has(ext)))].sort();
    if (uncovered.length) blockers.push(`sast root ${rootPath}: uncovered source extensions ${uncovered.join(',')}`);
    tasks.push({ kind: 'sast', scanner: 'ast-grep', target: rootPath,
      args: ['scan', '--config', contract.configPath, '--json=compact', rootPath],
      blocked: 'coverage-blocked: sast execution admission pending L02 scanner/toolbox' });
  }
  for (const blocker of blockers) tasks.push({ kind: 'sast-coverage', scanner: 'ast-grep', target: blocker, args: [], blocked: blocker });
  return { tasks, blockers };
}

export function validateSastReport(stdout, contract, task) {
  let findings;
  try { findings = JSON.parse(stdout); } catch { throw new Error('malformed ast-grep report'); }
  if (!Array.isArray(findings)) throw new Error('invalid ast-grep report');
  const normalized = [];
  for (const finding of findings) {
    const rule = contract.rules.get(finding.ruleId);
    if (!rule) throw new Error(`unknown ast-grep rule id: ${finding.ruleId}`);
    if (finding.severity !== rule.severity) throw new Error(`ast-grep severity drift: ${finding.ruleId}`);
    if (typeof finding.file !== 'string' || !finding.file.startsWith(`${task.target}/`)) {
      throw new Error(`ast-grep finding outside scanned root: ${finding.file}`);
    }
    normalized.push({ scanner: 'ast-grep', id: `ast-grep:${finding.ruleId}`, ruleId: finding.ruleId,
      category: rule.category, path: finding.file, severity: rule.mappedSeverity,
      message: finding.message, line: finding.range?.start?.line });
  }
  return normalized;
}

// The runner spawns the pinned native ELF binary directly; a Node wrapper never substitutes.
export function sastRunner(root, contract, execute) {
  const binary = process.env.AST_GREP_BIN || '/opt/ast-grep/ast-grep';
  if (!existsSync(binary) || !isElf(binary)) throw new Error('coverage-blocked: native ast-grep ELF binary required');
  const version = execute(binary, ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (version.status !== 0 || version.stdout.trim() !== `ast-grep ${contract.pin.version}`) {
    throw new Error('coverage-blocked: ast-grep binary version does not match the pinned toolbox');
  }
  return (task) => {
    if (task.kind !== 'sast') throw new Error('coverage-blocked: sast runner only');
    const env = { PATH: '/usr/bin:/bin', HOME: '/tmp', LANG: 'C.UTF-8' };
    return execute(binary, task.args, { cwd: resolve(root), env, shell: false,
      timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  };
}
