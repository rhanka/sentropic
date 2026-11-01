#!/usr/bin/env node
// Typed publish decision for @sentropic/cluster-mesh on main CI (BR866-EX1/BR866-EX2).
//
// A prerelease version (the bump-gate dev series) is the planned between-releases state on
// main: CI must publish nothing and stay green. A stable version publishes exactly as before.
// The Makefile engram-e2-stable-publish-guard is unchanged defense in depth: a prerelease
// that still reaches a publish target fails red, so this decision can never publish a dev
// version. Runs only behind root Make targets.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GuardError, loadSemver } from './publishable-manifests.mjs';

// Mirrors the Makefile engram-e2-stable-publish-guard: exactly this shape may publish.
export const STABLE_CLUSTER_MESH_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// Pure decision: stable -> publish; semver prerelease -> typed skip; anything else -> red.
export function decideClusterMeshPublish(version, semver = loadSemver()) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new GuardError(`Cluster Mesh version is missing: ${JSON.stringify(version)}`);
  }
  if (STABLE_CLUSTER_MESH_VERSION.test(version)) return { decision: 'publish', version };
  if (semver.valid(version) !== null && (semver.prerelease(version) ?? []).length > 0) {
    return { decision: 'skip', reason: 'prerelease', version };
  }
  throw new GuardError(
    `Cluster Mesh version ${JSON.stringify(version)} is neither a stable X.Y.Z nor a semver prerelease: refusing to decide publication`);
}

// Typed, log-friendly lines: the Make target forwards decision/reason/version to $GITHUB_OUTPUT
// and the summary line to $GITHUB_STEP_SUMMARY.
export function renderClusterMeshPublishDecision(decision) {
  const lines = [`decision=${decision.decision}`];
  if (decision.reason) lines.push(`reason=${decision.reason}`);
  lines.push(`version=${decision.version}`);
  lines.push(`summary=${decision.decision === 'publish'
    ? `stable ${decision.version}: publishing`
    : `prerelease ${decision.version}: not published`}`);
  return lines;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--manifest' && argv[i + 1] !== undefined) {
      opts.manifest = argv[i + 1];
      i += 1;
    } else {
      throw new GuardError(`unknown argument ${JSON.stringify(argv[i])} (--manifest <path>)`);
    }
  }
  return opts;
}

export async function main(argv, { cwd = process.cwd(), out = process.stdout } = {}) {
  const opts = parseArgs(argv);
  const manifestPath = path.resolve(cwd, opts.manifest ?? 'packages/cluster-mesh/package.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new GuardError(`unreadable Cluster Mesh manifest ${manifestPath}: ${error.message}`);
  }
  const decision = decideClusterMeshPublish(manifest.version);
  const lines = renderClusterMeshPublishDecision(decision);
  const summary = lines.find((line) => line.startsWith('summary=')).slice('summary='.length);
  out.write(`${lines.join('\n')}\n`);
  out.write(`::notice title=Cluster Mesh publish decision::${summary}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code ?? 0),
    (error) => {
      const message = error instanceof GuardError ? error.message : (error?.stack ?? String(error));
      const safe = String(message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
      process.stdout.write(`::error title=Cluster Mesh publish decision::${safe}\n`);
      process.exit(1);
    });
}
