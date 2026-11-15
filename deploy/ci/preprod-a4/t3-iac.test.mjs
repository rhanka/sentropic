import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../../../', import.meta.url);
const make = readFileSync(new URL('Makefile', root), 'utf8');
test('prod deploy preserves A4 wiring and never forces an extra restart', () => {
  const target = make.split('\nk8s-deploy:')[1].split('\nk8s-deploy-preprod:')[0];
  assert.match(target, /kubectl apply -k deploy\/k8s\/overlays\/prod-a4\n/);
  assert.doesNotMatch(target, /rollout restart/);
});
test('generic secret recipe refuses before reading or writing key values', () => {
  const target = make.split('\nk8s-bundle-secret:')[1];
  const firstRecipe = target.split('\n').find(line => line.startsWith('\t'));
  assert.match(firstRecipe, /frozen after T3.*exit 1/);
});
test('prod UI pin matches the published T2 receipt exactly', () => {
  const prod = readFileSync(new URL('deploy/k8s/overlays/prod/kustomization.yaml', root), 'utf8');
  assert.match(prod, /sentropic-ui@sha256:18ad65c8b93c425b82647659dcf6d134c42a8e8112aa68fbbe0f115de87a749d/);
  assert.doesNotMatch(prod, /15de87a449d/);
});
test('A4 wiring restates the base pod-template entries so the fenced wire reproduces this render', () => {
  // P-0.8: the wire applies these files to the legacy live template. Base entries close each env
  // list in base order, so kustomize and the wire build the same template and the apply rolls nothing.
  const read = path => readFileSync(new URL(path, root), 'utf8');
  const envNames = text => [...text.matchAll(/^\s+- name: ([A-Z][A-Z0-9_]+)$/gm)].map(match => match[1]);
  for (const [base, patch] of [['30-api.yaml', 'patch-api-a4.yaml'], ['35-auth-idp.yaml', 'patch-auth-idp-a4.yaml']]) {
    const restated = envNames(read(`deploy/k8s/base/${base}`));
    assert.ok(restated.length >= 3, base);
    assert.deepEqual(envNames(read(`deploy/k8s/components/a4-wiring/${patch}`)).slice(-restated.length), restated, patch);
  }
  const idp = read('deploy/k8s/components/a4-wiring/patch-auth-idp-a4.yaml');
  assert.match(idp, /- name: issuer-session-authority\n\s+persistentVolumeClaim: \{ claimName: auth-idp-session-authority \}/);
  assert.match(idp, /\{ name: issuer-session-authority, mountPath: \/var\/lib\/sentropic-idp\/sessions \}/);
  // Custody consumers follow the tenant database node; the driver pins the custodian to it.
  assert.match(read('deploy/k8s/components/a4-wiring/patch-api-a4.yaml'),
    /podAffinity:\n\s+preferredDuringSchedulingIgnoredDuringExecution:\n\s+- weight: 100\n[\s\S]+app\.kubernetes\.io\/component: postgres/);
});
test('prod-a4 names the T3 priority class on the three pod templates the window recreates', () => {
  // k8s PriorityClass sentropic-t3-critical acts only on pods that name it. The fenced wire of the
  // driver branch sets the same field on the live templates, so this apply rolls nothing.
  const overlay = readFileSync(new URL('deploy/k8s/overlays/prod-a4/kustomization.yaml', root), 'utf8');
  assert.match(overlay, /target:\n\s+kind: Deployment\n\s+name: \(api\|auth-idp\|ui\)\n/);
  assert.match(overlay, /spec:\n\s+template:\n\s+spec:\n\s+priorityClassName: sentropic-t3-critical\n?$/);
  for (const tier of ['prod', 'preprod', 'preprod-a4']) {
    assert.doesNotMatch(readFileSync(new URL(`deploy/k8s/overlays/${tier}/kustomization.yaml`, root), 'utf8'), /priorityClassName/, tier);
  }
});
