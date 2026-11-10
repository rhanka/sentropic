import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

// Owner rule (2026-11-08): no change may delete artifact data. Fails on destructive SQL against the
// artifacts schema (or control.artifact_*), on jobs or targets that delete the artifact object store,
// its volume or a bucket, and on rendered tiers that lose the store or the database volume.
const Q = String.raw`"?[a-z_][\w$]*"?\s*\.\s*"?[a-z_][\w$]*"?`;
const ARTIFACT = String.raw`"?(?:artifacts"?\s*\.\s*"?[a-z_]|control"?\s*\.\s*"?artifact_)`;
const KEEP = String.raw`(?!constraint\b|default\b|not\b|identity\b|expression\b|trigger\b)`;
const qualified = [
  ['drop-schema', String.raw`\bdrop\s+schema\s+(?:if\s+exists\s+)?(?:"?\w+"?\s*,\s*)*"?(?:artifacts|control)"?(?![\w.])`],
  ['drop-table', String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?(?:${Q}\s*,\s*)*${ARTIFACT}`],
  ['truncate', String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?(?:${Q}\s*,\s*)*${ARTIFACT}`],
  ['drop-column', String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${ARTIFACT}[^;]*\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?${KEEP}"?[a-z_]`],
  ['delete-all', String.raw`\bdelete\s+from\s+(?:only\s+)?${ARTIFACT}(?![^;]*\bwhere\b)`],
];
// Every table of the artifacts package (Postgres and SQLite) is artifact data.
const packageWide = [
  ['drop-table', String.raw`\bdrop\s+table\b`],
  ['truncate', String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?(?!on\b|or\b)"?[a-z_]`],
  ['drop-column', String.raw`\balter\s+table\b[^;]*\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?${KEEP}"?[a-z_]`],
  ['delete-all', String.raw`\bdelete\s+from\s+(?:only\s+)?"?[a-z_](?![^;]*\bwhere\b)`],
];
const commands = [
  ['store-delete', /\bdelete\b.*\bartifact-object-store\b/i],
  ['volume-delete-all', /\bdelete\s+(?:pvc|persistentvolumeclaims?)\b.*--all\b/i],
  ['namespace-delete', /\bdelete\s+(?:namespace|ns)\b/i],
  ['bucket-delete', /\b(?:s5cmd|aws\s+s3|mc|rclone)\s+(?:\S+\s+)*(?:rb|purge)\b|DeleteBucket|delete-bucket\b/i],
  ['artifact-object-delete', /\b(?:s5cmd|aws\s+s3|mc|rclone)\b.*\b(?:rm|delete)\b.*artifact/i],
];

const blank = text => text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

export function sqlFindings(path, text) {
  const source = blank(text), findings = [];
  const patterns = path.startsWith('packages/artifacts/') ? packageWide : qualified;
  let offset = 0;
  for (const statement of source.split(';')) {
    for (const [rule, pattern] of patterns) {
      const match = new RegExp(pattern, 'i').exec(statement);
      if (match) { findings.push({ path, line: lineAt(source, offset + match.index), rule }); break; }
    }
    offset += statement.length + 1;
  }
  return findings;
}

export function commandFindings(path, text) {
  return text.split('\n').flatMap((line, index) => {
    const hit = commands.find(([, pattern]) => pattern.test(line));
    return hit ? [{ path, line: index + 1, rule: hit[0] }] : [];
  });
}

export function manifestFindings(tier, objects) {
  const findings = [], push = (rule, name) => findings.push({ path: `rendered/${tier}`, name, rule });
  const volume = (set, rule) => {
    const pod = set.spec?.template?.spec;
    if (!set.spec?.volumeClaimTemplates?.some(template => template.metadata?.name === 'data')
      || pod?.volumes?.some(entry => entry.name === 'data')
      || !pod?.containers?.some(container => container.volumeMounts?.some(mount => mount.name === 'data'))) push(rule, set.metadata.name);
  };
  const set = name => objects.find(object => object.kind === 'StatefulSet' && object.metadata?.name === name);
  if (set('postgres')) volume(set('postgres'), 'database-volume'); else push('database-missing', 'postgres');
  if (tier.startsWith('preprod')) {
    if (set('artifact-object-store')) volume(set('artifact-object-store'), 'object-store-volume');
    else push('object-store-missing', 'artifact-object-store');
  }
  for (const object of objects) {
    const policy = object.kind === 'StatefulSet' ? object.spec?.persistentVolumeClaimRetentionPolicy : undefined;
    if (policy && ['whenDeleted', 'whenScaled'].some(when => policy[when] !== undefined && policy[when] !== 'Retain')) {
      push('volume-retention', object.metadata.name);
    }
    const pod = object.kind === 'Job' ? object.spec?.template?.spec
      : object.kind === 'CronJob' ? object.spec?.jobTemplate?.spec?.template?.spec : undefined;
    for (const container of [...(pod?.initContainers ?? []), ...(pod?.containers ?? [])]) {
      const line = [...(container.command ?? []), ...(container.args ?? [])].join(' ');
      for (const finding of [...sqlFindings('job', line), ...commandFindings('job', line)]) push(`job-${finding.rule}`, object.metadata.name);
    }
  }
  return findings;
}

const skip = /(^|\/)(node_modules|dist|build|tests?|fixtures|\.git|tmp|\.tmp)(\/|$)|\.(?:self)?test\.|^deploy\/ci\/artifact-data-guard\/guard\./;
const executable = /^(Makefile|.*\.mk|\.github\/workflows\/.*\.ya?ml|(deploy|scripts)\/.*\.(sh|mjs|js|ya?ml|mk))$/;
function walk(root, dir = root) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name), rel = relative(root, path);
    if (skip.test(rel)) return [];
    return statSync(path).isDirectory() ? walk(root, path) : [rel];
  });
}

export function scan(root, rendered) {
  const findings = [];
  for (const path of walk(root)) {
    if (path.endsWith('.sql')) findings.push(...sqlFindings(path, readFileSync(join(root, path), 'utf8')));
    else if (executable.test(path)) findings.push(...commandFindings(path, readFileSync(join(root, path), 'utf8')));
  }
  const { parseAllDocuments } = createRequire(process.env.GUARD_YAML_PACKAGE ?? join(root, 'package.json'))('yaml');
  for (const file of readdirSync(rendered).filter(name => name.endsWith('.yaml'))) {
    const objects = parseAllDocuments(readFileSync(join(rendered, file), 'utf8')).map(doc => doc.toJSON()).filter(Boolean);
    findings.push(...manifestFindings(file.replace(/\.yaml$/, ''), objects));
  }
  return findings;
}

if (process.argv[1]?.endsWith('/artifact-data-guard/guard.mjs')) {
  const findings = scan(process.argv[2], process.argv[3]);
  for (const f of findings) console.error(`ARTIFACT DATA GUARD: ${f.path}${f.line ? `:${f.line}` : ''} ${f.rule}${f.name ? ` ${f.name}` : ''}`);
  if (findings.length) process.exitCode = 1;
  else console.log('PASS: no change deletes artifact tables, the artifact object store, its volume or a bucket');
}
