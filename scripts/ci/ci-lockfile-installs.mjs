// Fail closed on install commands that can escape a committed dependency graph.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const maintenanceTargets = new Set(['install-ui', 'install-ui-dev', 'install-api', 'install-api-dev',
  'lock-api', 'lock-root', 'lock-e2e', 'lock-idp-web']);
export function violations(file, source) {
  source = source.replace(/\\\r?\n/g, ' ');
  const lines = source.split('\n');
  const snapshotStart = lines.findIndex(s => s.startsWith('function refreshToolchainSnapshot'));
  const snapshotEnd = lines.findIndex(s => s.startsWith('function main'));
  let target = '';
  const problems = [];
  lines.forEach((line, i) => {
    if (file === 'Makefile') {
      const match = /^([\w-]+):/.exec(line);
      if (match) target = match[1];
    }
    if (/^\s*(#|\/\/|\*)/.test(line)) return;
    if (/^\s*(?:it|test)\(['"]/.test(line) || /problems\.push\(`npm install failed/.test(line)) return;
    if (file === 'Makefile' && maintenanceTargets.has(target)) return;
    if (file.startsWith('.github/workflows/') && /\bmake\b[^\n]*\b(?:install-(?:ui|api)(?:-dev)?|lock-(?:api|root|e2e|idp-web|ci-tools)|memory-l5-toolchain-snapshot)\b/.test(line)) {
      problems.push(`${file}:${i + 1}: dependency lock authoring is forbidden in CI`);
    }
    // This explicit authoring mode writes a new snapshot; CI uses the checked-in snapshot.
    if (file === 'tools/memory-mcp-l5/pack.mjs' && i >= snapshotStart && i < snapshotEnd) return;
    const span = lines.slice(i, i + 8).join('\n');
    const verb = '(?:install|i|add|exec|x)';
    const call = new RegExp(`['"]npm['"]\\s*,\\s*\\[\\s*(?:['"]--[^'"]+['"]\\s*,\\s*(?:['"][^'"]+['"]\\s*,\\s*)?)*['"]${verb}['"]`).exec(span);
    const npxCall = /['"]npx['"]\s*,\s*\[\s*(?=['"])(?!['"]--no-install['"])/.exec(span);
    if (new RegExp(`(?:\\bnpm|\\$\\(NPM\\))\\s+(?:--[^\\s]+\\s+(?:[^\\s-]+\\s+)?)*${verb}\\b`).test(line)
      || (call && call.index < line.length)
      || (npxCall && npxCall.index < line.length)
      || /(?:^|[;&|"'\s])npx\s+(?!--no-install\b)/.test(line.replace(/command\s+-v\s+npx\b/g, ''))) problems.push(`${file}:${i + 1}: unlocked npm resolution`);
  });
  return problems;
}

export function scannedSources(root) {
  const sources = [];
  const visit = file => {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file)) {
        if (/^(node_modules|dist|build|\.git|artifacts|archives)$/.test(name) && !file.endsWith('/packages')) continue;
        visit(path.join(file, name));
      }
    } else if (/Makefile$|Dockerfile[^/]*$|package\.json$|\.(?:sh|mk|mjs|ts|ya?ml)$/.test(file)) {
      const relative = path.relative(root, file);
      if (/^scripts\/ci\/ci-lockfile-installs(?:\.test)?\.mjs$/.test(relative)) return;
      sources.push([relative, fs.readFileSync(file, 'utf8')]);
    }
  };
  for (const name of ['Makefile', 'scripts', 'tools', 'packages', 'apps', 'api', 'ui', 'e2e', 'deploy', '.github/workflows', '.security/ci-lockfile-installs.mk']) visit(path.join(root, name));
  for (const name of fs.readdirSync(root).filter(name => /^docker-compose.*\.yml$/.test(name))) visit(path.join(root, name));
  return sources;
}

export function inspect(root) {
  return scannedSources(root).flatMap(([file, source]) => violations(file, source));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = inspect(fileURLToPath(new URL('../../', import.meta.url)));
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('CI installations use committed locks or frozen tarball-consumer inputs');
}
