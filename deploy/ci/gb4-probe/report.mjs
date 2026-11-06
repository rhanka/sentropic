import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { image } from './manifests.mjs';

export function report(root, resources, rows, state) {
  const directory = join(root, '.tmp/rv');
  mkdirSync(directory, { recursive: true });
  const safe = (text) => String(text).replace(/[|\r\n]/g, ' ');
  const manifests = resources.map((resource) => {
    const file = `gb4-probe-${resource.kind.toLowerCase()}-${resource.metadata.name}.json`;
    writeFileSync(join(directory, file), JSON.stringify(resource, null, 2) + '\n');
    return `### ${resource.kind}\n\n\`\`\`json\n${JSON.stringify(resource, null, 2)}\n\`\`\`\n`;
  }).join('\n');
  writeFileSync(join(directory, 'gb4-probe.md'), `# GB4 isolation probe\n\nImage: \`${image}\`\n\n` +
    'Official source: `node:lts-bookworm-slim`, resolved using the anonymous Docker Hub registry API; manifest bytes verified against the digest.\n\n' +
    `Branch: \`feat/gb4-isolation-probe\`; wagon of the next dated train; no PR.\n\nAccess: \`K8S_TENANT_ADMIN_KUBECONFIG_B64\` by name only; read-only preprod discovery, then impersonation of \`sentropic-preprod:sentropic-app\` for every builder operation. Scope: preprod only.\n\nStatus: ${state}\n\n` +
    '## Manifests\n\n' + manifests + '\n## PASS/FAIL table\n\n| Check | Result | Evidence |\n|---|---|---|\n' +
    rows.map((r) => `| ${safe(r.check)} | ${safe(r.result || (r.pass === null ? 'PENDING' : r.pass ? 'PASS' : 'FAIL'))} | ${safe(r.evidence)} |`).join('\n') + '\n\n' +
    'No NetworkPolicy is applied by this runner. The repository artifact-content egress change remains unapplied for train integration. Negative clients run in the builder namespace and cannot distinguish source egress denial from target ingress denial.\n\n' +
    'Writable-storage checks cover regular files/directories at every mount, including kubelet-injected files; kernel pseudo filesystems and device nodes are excluded. `/dev/shm` is explicitly an emptyDir. Network results establish observed reachability from this Pod at probe time, not exhaustive policy coverage.\n\n' +
    'Track: the designated conductor imports the GB4 items from this wagon BRANCH.md; this lane does not write the concurrent event journal.\n');
}
