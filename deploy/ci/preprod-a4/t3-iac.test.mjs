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
