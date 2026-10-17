// seat-inspect: owner dry-run format inspection (CISEAT-EX3).
// Reads only the explicitly selected lab record through the bounded mesh
// reader and prints allowlisted categories. No refresh, mint, provider
// call, GitHub write, transfer, or activation. Usage:
//   make seat-inspect -C packages/llm-mesh/seat-tools CLI=agy ENV=dev-ci-seat-import
// Direct use enforces the same pins as the Makefile (node runtime and
// sibling mesh build); see README.md.
import { readFile } from 'node:fs/promises';

const here = new URL('.', import.meta.url);
const meshPackageUrl = new URL('../package.json', here);
const toolsPackageUrl = new URL('./package.json', here);
const runtimeUrl = new URL('./node-runtime.json', here);
const distUrl = new URL('../dist/node/', here);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

// Pin 1: the node runtime must match node-runtime.json, even on direct use.
const runtime = await readJson(runtimeUrl);
if (process.version !== runtime.node) {
  console.error(`node ${process.version} does not match pinned ${runtime.node}`);
  process.exit(1);
}

// Pin 2: the loaded mesh artifact must be the sibling build at the same
// version the seat-tools package was reviewed against.
const meshPackage = await readJson(meshPackageUrl);
const toolsPackage = await readJson(toolsPackageUrl);
if (meshPackage.version !== toolsPackage.version) {
  console.error(`sibling mesh build ${meshPackage.version} does not match seat-tools ${toolsPackage.version}`);
  process.exit(1);
}

const { inspectSeatStoreRecord } = await import(new URL('cli-seat-store-reader.js', distUrl));
const { SeatSidecarFileBackend } = await import(new URL('seat-sidecar-file-backend.js', distUrl));

const CLIS = ['agy', 'codex', 'vibe', 'muse', 'claude'];
const cli = process.env['SEAT_CLI'] ?? '';
const profileLabel = process.env['SEAT_PROFILE_LABEL'] ?? '';
const sidecarPath = process.env['SEAT_SIDECAR'] ?? '';

if (!CLIS.includes(cli) || !profileLabel) {
  console.error('usage: SEAT_CLI=<agy|codex|vibe|muse|claude> SEAT_PROFILE_LABEL=<lab-label> [SEAT_SIDECAR=<path>] node inspect.mjs');
  process.exit(2);
}

// Without an explicit sidecar the reader returns unverified: there are no
// default paths and no home probing. Owner backends plug in here per the
// pinned P-AGY/P-CODEX/P-VIBE/P-MUSE/P-CLAUDE qualification results.
const backends = sidecarPath ? [new SeatSidecarFileBackend(cli, sidecarPath)] : [];
const descriptor = await inspectSeatStoreRecord(backends, { cli, profileLabel });
console.log(JSON.stringify({ ...descriptor, categoriesOnly: true }));
