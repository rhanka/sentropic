import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// CI10-S4 toolbox build. A dependency digest recorded by pull-api-tool-deps-registry makes this a
// thin source-layer build on that pinned base. A recorded miss, or a failed thin build (registry
// auth not reaching BuildKit, unreadable base), rebuilds the full toolbox: same ci-tools target,
// same tag. An absent record is cold mode (no pull attempted). A full-build failure is always fatal.
export const thinArgs = ref => ['--build-arg', `BASE_FROM=${ref}`, '--build-arg', `TOOL_DEPS_IMAGE=${ref}`];

export function depsBase(content) {
  if (content === null) return { ref: null };
  const ref = content.trim();
  if (!ref) return { ref: null, warning: 'No verified toolbox dependency base was pulled (registry miss); building the full toolbox.' };
  return { ref };
}

export function buildToolbox({ ref, build, warn }) {
  if (ref) {
    if (build(thinArgs(ref))) return 'thin';
    warn(`Thin toolbox build on ${ref} failed; rebuilding the full toolbox (same target and tag).`);
  }
  if (!build([])) throw Error('Full toolbox build failed');
  return 'full';
}

const warn = message => console.log(`::warning::${message}`);

export function main([file, separator, ...command]) {
  if (!file || separator !== '--' || command.length < 2) {
    throw Error('Usage: api-tool-build.mjs <deps-ref-file> -- <build command ...> <context>');
  }
  let content = null;
  try { content = readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const base = depsBase(content);
  if (base.warning) warn(base.warning);
  const [program, ...args] = command;
  const context = args.pop();
  const build = extra => spawnSync(program, [...args, ...extra, context], { stdio: 'inherit' }).status === 0;
  console.log(`Toolbox build mode: ${buildToolbox({ ref: base.ref, build, warn })}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
