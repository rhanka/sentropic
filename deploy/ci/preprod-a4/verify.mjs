import { pathToFileURL } from 'node:url';
import { assertDigestOutput, assertRequest, canonical, digest, kubectl, privateInput } from './guards.mjs';
import { assertVerificationBoundary } from './verification-boundary.mjs';

export async function verify(env = process.env, call = kubectl, read = privateInput, probe = fetch) {
  const phase = env.A4_VERIFY_PHASE ?? 'internal';
  if (!['internal', 'http'].includes(phase)) throw new Error('phase_invalid');
  read(env.A4_KUBECONFIG_FILE);
  const request = JSON.parse(read(env.A4_REQUEST_FILE)); assertRequest(request);
  const k = args => call(env.A4_KUBECONFIG_FILE, args);
  const deployment = JSON.parse(k(['get', 'deployment', 'api', '-o', 'json']));
  if (deployment.spec.replicas !== 1 || deployment.status?.availableReplicas !== 1
    || deployment.status.updatedReplicas !== 1 || deployment.status.observedGeneration !== deployment.metadata.generation
    || deployment.spec.template.spec.containers.find(container => container.name === 'api')?.image !== request.candidateImage) {
    throw new Error('api_not_ready');
  }
  const endpoints = JSON.parse(k(['get', 'endpointslices', '-l', 'kubernetes.io/service-name=api', '-o', 'json'])).items;
  if (!endpoints.some(slice => slice.endpoints?.some(endpoint => endpoint.conditions?.ready === true
    && endpoint.conditions?.serving !== false && endpoint.conditions?.terminating !== true))) throw new Error('endpoint_not_ready');
  const result = assertDigestOutput(k(['exec', 'deployment/api', '-c', 'api', '--',
    'node', '/run/cm-runtime/launch.mjs', '--cm-preprod-verify']));
  const internal = result + `readinessSha256=${digest(canonical({ candidate: request.candidateCommit, ready: true, serving: true }))}\n`;
  if (phase === 'internal') return internal;
  assertVerificationBoundary(request, JSON.parse(read(env.A4_VERIFICATION_FILE)), k);
  const response = await probe('https://preprod.sentropic.sent-tech.ca/api/v1/health',
    { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  await response.body?.cancel();
  if (response.status !== 200) throw new Error('public_api_not_200');
  return internal + `httpSha256=${digest('https://preprod.sentropic.sent-tech.ca/api/v1/health:200')}\n`;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { process.stdout.write(await verify()); }
  catch { process.stderr.write(`failureSha256=${digest('preprod-a4-readiness-failed')}\n`); process.exitCode = 1; }
}
