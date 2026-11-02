// ACT-L04 L4-C: complete Trivy IaC adaptation — expected document/resource identities,
// positive controls per required surface, fail-closed report validation.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { failClosedReport, repositoryFiles } from './inventory.mjs';
import { yamlTool } from './sast.mjs';

export const IAC_SURFACES = ['compose', 'makefile', 'k8s'];

export function splitYamlDocuments(text) {
  const parts = [];
  let current = [];
  for (const line of text.split('\n')) {
    if (/^---\s*$/.test(line)) { parts.push(current.join('\n')); current = []; }
    else current.push(line);
  }
  parts.push(current.join('\n'));
  return parts.filter((part) => part.trim().length > 0);
}

function makefileTargets(text) {
  const targets = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9_.-]*):(?![=])/);
    if (match) targets.add(match[1]);
  }
  return [...targets].sort();
}

// Enumerates every expected IaC document/resource identity. Unsupported constructs are
// exact blockers, never silently skipped: they cannot pass as coverage.
export function inventoryIacDocuments(root = '.', parseYaml) {
  const parse = parseYaml || yamlTool().parse;
  const files = repositoryFiles(root).filter((path) =>
    /(?:^|\/)docker-compose[^/]*\.ya?ml$/.test(path) || /(?:^|\/)Makefile$/.test(path) ||
    /(?:^|\/)deploy\/.*\.ya?ml$/.test(path));
  const documents = [];
  const blockers = [];
  for (const file of files) {
    const surface = /(?:^|\/)docker-compose[^/]*\.ya?ml$/.test(file) ? 'compose'
      : /(?:^|\/)Makefile$/.test(file) ? 'makefile' : 'k8s';
    const text = readFileSync(join(root, file), 'utf8');
    if (surface === 'makefile') {
      const targets = makefileTargets(text);
      if (!targets.length) { blockers.push(`unsupported Makefile (no targets): ${file}`); continue; }
      for (const target of targets) documents.push({ surface, file, identity: `make:${file}#target:${target}` });
      continue;
    }
    const docs = splitYamlDocuments(text);
    if (!docs.length) { blockers.push(`unsupported empty IaC file: ${file}`); continue; }
    for (const [index, docText] of docs.entries()) {
      let doc;
      try { doc = parse(docText); } catch { blockers.push(`unsupported malformed YAML document: ${file}#${index}`); continue; }
      if (surface === 'compose') {
        if (doc === null || doc === undefined) continue; // empty/comment-only document
        if (typeof doc !== 'object' || Array.isArray(doc)) {
          blockers.push(`unsupported compose document (not an object): ${file}#${index}`);
          continue;
        }
        const services = Object.keys(doc.services || {});
        if (!services.length) { blockers.push(`unsupported compose document (no services): ${file}#${index}`); continue; }
        for (const service of services.sort()) documents.push({ surface, file, identity: `compose:${file}#service:${service}` });
        continue;
      }
      if (doc === null || doc === undefined) continue; // empty/comment-only document
      if (typeof doc !== 'object' || Array.isArray(doc)) {
        blockers.push(`unsupported k8s document (not an object): ${file}#${index}`);
        continue;
      }
      if (typeof doc.apiVersion !== 'string' || typeof doc.kind !== 'string') {
        blockers.push(`unsupported k8s document (missing apiVersion/kind): ${file}#${index}`);
        continue;
      }
      const name = typeof doc.metadata?.name === 'string' && doc.metadata.name ? doc.metadata.name : `doc${index}`;
      documents.push({ surface, file, identity: `k8s:${file}#${doc.apiVersion}/${doc.kind}/${name}` });
    }
  }
  return { documents, blockers, surfaces: IAC_SURFACES.map((surface) => ({
    surface, files: [...new Set(documents.filter((d) => d.surface === surface).map((d) => d.file))].sort(),
  })) };
}

// Fail-closed validation of a Trivy `config` report against the expected inventory.
// Dropping one document, zero-configuration "success", malformed output, missing positive
// controls or unsupported constructs all refuse the report.
export function validateIacReport(raw, expected) {
  const parsed = failClosedReport(raw);
  if (parsed.SchemaVersion !== 2 || !Array.isArray(parsed.Results)) throw new Error('invalid IaC report');
  if (expected.blockers.length) {
    throw new Error(`coverage-blocked: unsupported IaC constructs: ${expected.blockers.join('; ')}`);
  }
  if (!expected.documents.length) throw new Error('coverage-blocked: empty expected IaC inventory (no positive proof)');
  if (parsed.Results.length === 0) throw new Error('zero-configuration success: empty Results with expected documents');
  for (const result of parsed.Results) {
    if (typeof result.Target !== 'string' || !result.Target) throw new Error('malformed IaC result target');
    for (const misconfiguration of result.Misconfigurations || []) {
      if (typeof misconfiguration.ID !== 'string' || !misconfiguration.ID ||
        !['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(misconfiguration.Severity) ||
        typeof misconfiguration.Type !== 'string' || typeof misconfiguration.Message !== 'string') {
        throw new Error(`malformed IaC misconfiguration in ${result.Target}`);
      }
    }
  }
  const targets = new Set(parsed.Results.map((result) => result.Target));
  for (const file of [...new Set(expected.documents.map((d) => d.file))].sort()) {
    if (!targets.has(file)) throw new Error(`dropped IaC document: ${file}`);
  }
  for (const control of expected.controls || []) {
    const result = parsed.Results.find((entry) => entry.Target === control.file);
    const found = result?.Misconfigurations?.some((m) => m.ID === control.id &&
      ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(m.Severity));
    if (!found) throw new Error(`positive control not detected: ${control.id} in ${control.file}`);
  }
  return parsed;
}

export function planIacScan(root = '.', trivyArgs = ['--format', 'json', '--severity',
  'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--exit-code', '0']) {
  if (!existsSync(join(root, 'Makefile'))) throw new Error('coverage-blocked: IaC root missing Makefile');
  return { kind: 'iac', scanner: 'trivy', target: root, args: ['config', ...trivyArgs, root],
    blocked: 'coverage-blocked: Trivy adapter S2b (scanner admission pending L02)' };
}
