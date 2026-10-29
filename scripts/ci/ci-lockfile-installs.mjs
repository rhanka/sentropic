// Fail closed on install commands that can escape a committed dependency graph.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const maintenanceTargets = new Set(['install-ui', 'install-ui-dev', 'install-api', 'install-api-dev',
  'lock-api', 'lock-root', 'lock-e2e', 'lock-idp-web']);
export function violations(file, source) {
  let target = '';
  const problems = [];
  source.split('\n').forEach((line, i) => {
    if (file === 'Makefile') {
      const match = /^([\w-]+):/.exec(line);
      if (match) target = match[1];
    }
    if (/^\s*(#|\/\/|\*)/.test(line)) return;
    if (/^\s*(?:it|test)\(['"]/.test(line) || /problems\.push\(`npm install failed/.test(line)) return;
    if (file === 'Makefile' && maintenanceTargets.has(target)) return;
    // This explicit authoring mode writes a new snapshot; CI uses the checked-in snapshot.
    if (file === 'tools/memory-mcp-l5/pack.mjs' && i >= source.split('\n').findIndex(s => s.startsWith('function refreshToolchainSnapshot'))
      && i < source.split('\n').findIndex(s => s.startsWith('function main'))) return;
    if (/\bnpm\s+(?:install|i|exec)\b/.test(line)
      || /['"]npm['"]\s*,\s*\[\s*['"](?:install|i|exec)['"]/.test(line)
      || /\bnpx\s+(?!--no-install\b)/.test(line)) problems.push(`${file}:${i + 1}: unlocked npm resolution`);
  });
  return problems;
}

export function inspect(root) {
  const problems = [];
  const visit = file => {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file)) {
        if (/^(node_modules|dist|build|\.git|artifacts|archives)$/.test(name) && !file.endsWith('/packages')) continue;
        visit(path.join(file, name));
      }
    } else if (/Makefile$|Dockerfile[^/]*$|\.(?:sh|mk|mjs|ts|ya?ml)$/.test(file)) {
      const relative = path.relative(root, file);
      if (/^scripts\/ci\/ci-lockfile-installs(?:\.test)?\.mjs$/.test(relative)) return;
      problems.push(...violations(relative, fs.readFileSync(file, 'utf8')));
    }
  };
  for (const name of ['Makefile', 'scripts', 'tools', 'packages', 'apps', 'api/Dockerfile', 'ui/Dockerfile', '.github/workflows']) visit(path.join(root, name));
  for (const name of fs.readdirSync(root).filter(name => /^docker-compose.*\.yml$/.test(name))) visit(path.join(root, name));
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = inspect(fileURLToPath(new URL('../../', import.meta.url)));
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('CI installations use committed locks or frozen tarball-consumer inputs');
}
