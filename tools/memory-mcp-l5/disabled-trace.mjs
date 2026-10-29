import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Shared by the preload producer and the gate: declarations and shell dispatch
// cannot establish which executable actually ran.
export function isNativeBuildProcess(executable, argv = []) {
  if (!Array.isArray(argv) || (argv.length === 1 && ['--version', '-v', '--help', '-h'].includes(argv[0]))) return false;
  const basename = String(executable).split(/[/\\]/).at(-1);
  if (/^node-gyp(?:\.cmd)?$/.test(basename)) return argv.some(arg => ['build', 'rebuild'].includes(arg));
  if (/^(?:make|cc|c\+\+|g\+\+|gcc|clang[^/\\]*)$/.test(basename)) return !(basename === 'make' && argv.length === 1 && argv[0] === 'clean');
  return /^node(?:\.exe)?$/.test(basename) &&
    /(?:^|[/\\])node-gyp(?:\.js)?$/.test(String(argv[0])) &&
    argv.some(arg => ['build', 'rebuild'].includes(arg));
}

/** Runs before npm and is inherited by every lifecycle Node process. Both
 * module systems instrument the same concrete initialization boundaries. */
export function createDisabledTrace(directory, { readFile = readFileSync, writeFile = writeFileSync } = {}) {
  const common = String.raw`
const fs = require('node:fs');
const trace = (kind, detail) => fs.appendFileSync(process.env.MCP_L4_TRACE, JSON.stringify({ kind, detail }) + '\n');
const memoryModule = file => /(?:mcp-memory\.(?:js|cjs)|engram-memory\/(?:dist\/)?(?:engine|memory-store|sqlite|postgres|module-storage)|(?:better-sqlite3|fs-ext)(?:\/|$))/.test(file);
const transform = (source, file) => {
  if (!/[/\\]@sentropic[/\\]engram[/\\]/.test(file)) return source;
  const record = (kind, name) => 'require("node:fs").appendFileSync(process.env.MCP_L4_TRACE, JSON.stringify({kind:' + JSON.stringify(kind) + ',detail:' + JSON.stringify(name) + '}) + "\\n");';
  source = source.replace(/(function (openFencedSqliteCanonicalMemoryStoreV1|openReferenceSqliteHandleV1|openModuleStorageCanonicalMemoryStoreV1|openPostgresCanonicalMemoryStoreV1|createInMemoryCanonicalMemoryStoreV1|createCanonicalMemoryStoreFactoryV1)\([^)]*\)\s*\{)/g,
    (whole, _head, name) => whole + record('store-open', name));
  source = source.replace(/(if \(operation\.operation === "bootstrap"\) \{)/g, whole => whole + record('identity-bootstrap', 'admin.bootstrap'));
  return source;
};
`;
  const preload = join(directory, 'trace-preload.cjs');
  writeFile(preload, common + '\nconst isNativeBuildProcess = ' + isNativeBuildProcess.toString() + ';\n' + String.raw`
if (isNativeBuildProcess(process.execPath, process.argv.slice(1))) {
  trace('native-build', { method: 'startup', executable: process.execPath, argv: process.argv.slice(1), cwd: process.cwd() });
}
const Module = require('node:module');
const child = require('node:child_process');
const compile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
  trace('cjs-compile', filename);
  return compile.call(this, transform(content, filename), filename);
};
const load = Module._load;
Module._load = function (request, parent, main) {
  const resolved = Module._resolveFilename(request, parent, main);
  trace('cjs-load', resolved);
  if (memoryModule(resolved)) trace('provider-load', resolved);
  return load.apply(this, arguments);
};
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = child[method];
  child[method] = function (...args) {
    const command = JSON.stringify(args.slice(0, 2));
    const options = args.find(x => x && typeof x === 'object' && !Array.isArray(x)) ?? {};
    const context = String(options.cwd ?? process.cwd()) + ' ' + (options.env?.npm_package_name ?? process.env.npm_package_name ?? '');
    trace('lifecycle', context + ' ' + command);
    const cwd = options.cwd instanceof URL ? require('node:url').fileURLToPath(options.cwd) : require('node:path').resolve(String(options.cwd ?? process.cwd()));
    const nativeCall = ['spawn', 'spawnSync', 'execFile', 'execFileSync'].includes(method) && !options.shell &&
        isNativeBuildProcess(args[0], Array.isArray(args[1]) ? args[1] : []);
    const observed = () => trace('native-build', { method, executable: String(args[0]), argv: Array.isArray(args[1]) ? args[1] : [], cwd });
    if (!nativeCall) return original.apply(this, args);
    try {
      const result = original.apply(this, args);
      if (method.endsWith('Sync')) {
        if (!result?.error) observed();
      } else result.once('spawn', observed);
      return result;
    } catch (error) {
      if (Number.isInteger(error.status) || error.pid > 0) observed();
      throw error;
    }
  };
}
require('node:module').syncBuiltinESMExports();
`);
  // A loader thread sees ESM sources before evaluation. Inject an ESM-safe
  // require only when a measured function body was actually instrumented.
  const loader = join(directory, 'trace-loader.mjs');
  writeFile(loader, "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n" + common + String.raw`
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  trace('esm-load', url);
  if (memoryModule(url)) trace('provider-load', url);
  if (result.format === 'module' && result.source != null) {
    const source = result.source.toString();
    const changed = transform(source, url);
    if (changed !== source) return { ...result, source: 'import {createRequire as __l4Require} from "node:module";const __l4TraceRequire = __l4Require(import.meta.url);\n' + changed.replaceAll('require("node:fs").appendFileSync', '__l4TraceRequire("node:fs").appendFileSync') };
  }
  return result;
}
`);
  const registration = join(directory, 'trace-register.mjs');
  writeFile(registration, "import { register } from 'node:module';\nregister(" + JSON.stringify(loader) + ", import.meta.url);\n");
  const tracePath = join(directory, 'disabled-trace.jsonl');
  writeFile(tracePath, '');
  return {
    env: {
      MCP_L4_TRACE: tracePath,
      NODE_OPTIONS: [process.env.NODE_OPTIONS ?? '', '--require=' + preload, '--import=' + registration].join(' ').trim(),
    },
    read: () => readFile(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    reset: () => writeFile(tracePath, ''),
  };
}
