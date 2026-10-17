// seat-inspect: owner dry-run format inspection (CISEAT-EX3).
// Reads only the explicitly selected lab record through the bounded mesh
// reader and prints allowlisted categories. No refresh, mint, provider
// call, GitHub write, transfer, or activation. Usage:
//   make seat-inspect -C packages/llm-mesh/seat-tools CLI=agy ENV=dev-ci-seat-import
import { inspectSeatStoreRecord } from '../dist/node/cli-seat-store-reader.js';

const cli = process.env['SEAT_CLI'] ?? '';
const profileLabel = process.env['SEAT_PROFILE_LABEL'] ?? '';

if (!cli || !profileLabel) {
  console.error('usage: SEAT_CLI=<agy|codex|vibe|muse|claude> SEAT_PROFILE_LABEL=<lab-label> node inspect.mjs');
  process.exit(2);
}

// Owner backends plug in here per pinned P-AGY/P-CODEX/P-VIBE/P-MUSE/P-CLAUDE
// results; without a registered backend the reader returns unverified.
const descriptor = await inspectSeatStoreRecord([], { cli, profileLabel });
console.log(JSON.stringify({ ...descriptor, categoriesOnly: true }));
