#!/usr/bin/env node
// Zero-Python repository guard (SJ-0s). Checks tracked and non-ignored untracked
// paths, shebangs, and package.json scripts against scripts/no-python-allowlist.json.
import { spawnSync } from 'node:child_process';
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'no-python-allowlist.json');
const PYTHON_CMD = /^(?:pythonw?|pypy|pip)\d*(?:\.\d+)*(?:\.exe)?$|^(?:pipx|uvx?|poetry|pyw?)(?:\.exe)?$/;
const ASSIGNMENT = /^[a-z_][a-z0-9_]*\+?=/i;
const SHELL = /^(?:ba|da|k|z)?sh$/;
const SHELL_PREFIX = new Set(['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', '{', '}']);
const WRAPPERS = new Map([
  ['command', []], ['exec', ['-a']], ['env', ['-u', '--unset', '-C', '--chdir']],
  ['nohup', []], ['nice', ['-n', '--adjustment']], ['time', ['-o', '--output', '-f', '--format']],
  ['sudo', ['-u', '--user', '-g', '--group']], ['timeout', ['-s', '--signal', '-k', '--kill-after']],
  ['xargs', ['-n', '-P', '-I', '-a', '-d', '--max-args', '--max-procs']],
]);

export function loadAllowlist(path = ALLOWLIST_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.allowedPaths)) {
    throw new Error('no-python-allowlist.json must contain an "allowedPaths" array');
  }
  for (const entry of parsed.allowedPaths) {
    if (
      typeof entry !== 'string' || entry.length === 0 || entry.startsWith('/') ||
      entry.includes('\\') || entry.split('/').includes('..') || /[*?[\]{}]/.test(entry)
    ) {
      throw new Error(`invalid allowlist entry (exact relative path required): ${String(entry)}`);
    }
  }
  return new Set(parsed.allowedPaths);
}

export function isPythonPath(rel) {
  if (/\.(py|pyw|pyi|pyx)$/i.test(rel)) return true;
  const base = basename(rel).toLowerCase();
  return base === 'pyproject.toml' || (base.startsWith('requirements') && base.endsWith('.txt'));
}

export function findHits(rels, allowed) {
  return rels.filter((rel) => rel !== '' && !allowed.has(rel) && isPythonPath(rel));
}

function splitEnvWords(text) {
  const words = /(?:'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[\s\S]|[^\s'"\\])+/g;
  return Array.from(text.matchAll(words), (word) =>
    word[0].replace(/'([^']*)'|"((?:\\[\s\S]|[^"\\])*)"|\\([\s\S])/g,
      (_, single, double, escaped) => single ?? double?.replace(/\\([\s\S])/g, '$1') ?? escaped));
}

function commandInvocation(words) {
  let i = 0;
  while (i < words.length) {
    const value = words[i++];
    if (ASSIGNMENT.test(value) || SHELL_PREFIX.has(value)) continue;
    const name = value.split(/[\\/]/).at(-1);
    if (PYTHON_CMD.test(name)) return name;
    if (SHELL.test(name)) {
      let commandString = false;
      while (/^[+-]./.test(words[i] ?? '')) {
        const opt = words[i++];
        if (opt === '--') break;
        const flags = /^[+-]([a-zA-Z]+)$/.exec(opt)?.[1] ?? '';
        if (opt.startsWith('-') && flags.includes('c')) commandString = true;
        if (/[oO]$/.test(flags) || /^(?:--rcfile|--init-file)$/.test(opt)) i++;
      }
      return commandString && words[i] ? shellInvocation(words[i]) : undefined;
    }
    if (name === 'eval') {
      if (words[i] === '--') i++;
      return words.length > i ? shellInvocation(words.slice(i).join(' ')) : undefined;
    }
    const valueOpts = WRAPPERS.get(name);
    if (!valueOpts) return undefined;
    while (words[i]?.startsWith('-')) {
      const opt = words[i++];
      if (opt === '--') break;
      if (name === 'command' && /^-[vV]$/.test(opt)) return undefined;
      const split = name === 'env' && /^(?:-[a-zA-Z]*?S(.*)|--split-string(?:=(.*))?)$/s.exec(opt);
      if (split) {
        const inline = split[2] ?? (split[1] || undefined);
        const arg = inline === undefined ? words[i++] : inline;
        if (!arg) return undefined;
        words = [...splitEnvWords(arg), ...words.slice(i)];
        i = 0;
      }
      if (valueOpts.includes(opt)) i++;
    }
    if (name === 'timeout') i++;
  }
}

export function shellInvocation(source) {
  const parts = /[^\S\n]+|#[^\n]*|\n|[;|&()]|\d*(?:<<<|<<-|<<|>>|<>|>&|<&|>|<)|\$\([^)]*\)|`[^`]*`|(?:'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[\s\S]|[^\s;|&()<>'"`\\])+/g;
  let words = [];
  let redirect = '';
  for (let part; (part = parts.exec(source));) {
    const raw = part[0];
    if (/^[\t \r#]/.test(raw)) continue;
    if (/^[\n;|&()]$/.test(raw)) {
      const hit = commandInvocation(words);
      if (hit) return hit;
      words = [];
      redirect = '';
    } else if (/^\d*[<>]/.test(raw)) {
      redirect = raw;
    } else {
      if (raw.startsWith('$(') || raw.startsWith('`')) {
        const inner = raw.startsWith('$(') ? raw.slice(2, -1) : raw.slice(1, -1);
        const hit = shellInvocation(inner);
        if (hit) return hit;
        if (!redirect) words.push('<subshell>');
        redirect = '';
        continue;
      }
      if (!raw.startsWith("'")) {
        for (const m of raw.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) {
          const hit = shellInvocation(m[1] ?? m[2]);
          if (hit) return hit;
        }
      }
      const value = raw.replace(/'([^']*)'|"((?:\\[\s\S]|[^"\\])*)"|\\([\s\S])/g,
        (_, single, double, escaped) => single ?? double ?? escaped);
      if (!redirect && (value !== '' || /['"]/.test(raw))) words.push(value);
      redirect = '';
    }
  }
  return commandInvocation(words);
}

function scanTrackedFile(rel, report) {
  const full = join(ROOT, rel);
  if (!lstatSync(full, { throwIfNoEntry: false })?.isFile()) return;
  const isPackage = basename(rel) === 'package.json';
  const fd = openSync(full, 'r');
  try {
    const prefix = Buffer.alloc(2);
    const hasShebang = readSync(fd, prefix, 0, prefix.length, 0) === 2 && prefix.toString() === '#!';
    if (!hasShebang && !isPackage) return;
    const content = readFileSync(fd, 'utf8');
    if (hasShebang) {
      const hit = shellInvocation(content.split('\n', 1)[0].slice(2));
      if (hit) report(1, `shebang invokes ${hit}`);
    }
    if (isPackage) {
      const pkg = JSON.parse(content);
      for (const cmd of Object.values(pkg?.scripts ?? {})) {
        if (typeof cmd === 'string') {
          const hit = shellInvocation(cmd);
          if (hit) report(1, `invokes ${hit}`);
        }
      }
    }
  } finally {
    closeSync(fd);
  }
}

function readInventoryFile(filePath) {
  return [...new Set(readFileSync(filePath, 'utf8').split('\0').filter(Boolean))];
}

function listFiles() {
  if (process.env.NO_PYTHON_TRACKED_FILE) {
    const tracked = readInventoryFile(process.env.NO_PYTHON_TRACKED_FILE);
    const untracked = process.env.NO_PYTHON_UNTRACKED_FILE ? readInventoryFile(process.env.NO_PYTHON_UNTRACKED_FILE) : [];
    return { tracked, untracked };
  }
  const runGit = (...opts) => spawnSync('git', ['-C', ROOT, 'ls-files', ...opts, '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const t = runGit('--cached');
  const u = runGit('--others', '--exclude-standard');
  if (t.status !== 0 || u.status !== 0) {
    throw new Error('cannot prove zero-python: git ls-files failed and NO_PYTHON_TRACKED_FILE is unset');
  }
  return {
    tracked: [...new Set(t.stdout.split('\0').filter(Boolean))],
    untracked: [...new Set(u.stdout.split('\0').filter(Boolean))],
  };
}

function main() {
  const allowed = loadAllowlist();
  const { tracked, untracked } = listFiles();
  const hits = findHits([...new Set([...tracked, ...untracked])], allowed);
  const invocations = [];
  for (const rel of tracked) {
    try {
      scanTrackedFile(rel, (line, msg) => invocations.push(`${rel}:${line}: ${msg}`));
    } catch (err) {
      invocations.push(`${rel}:1: cannot scan tracked file (${err.code ?? err.message})`);
    }
  }
  if (hits.length === 0 && invocations.length === 0) {
    console.log(`✓ ZERO PYTHON OK (0 unexcused, ${allowed.size} allowlisted data paths)`);
    return;
  }
  if (hits.length > 0) {
    console.error(`check-no-python: unexcused Python paths (${hits.length}):`);
    for (const hit of hits) console.error(`  ${hit}`);
  }
  if (invocations.length > 0) {
    console.error(`check-no-python: executable context findings (${invocations.length}):`);
    for (const inv of invocations) console.error(`  ${inv}`);
  }
  process.exit(1);
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (err) {
    console.error(`check-no-python: ${err.message}`);
    process.exit(1);
  }
}
