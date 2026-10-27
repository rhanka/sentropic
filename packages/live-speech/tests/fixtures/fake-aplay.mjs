#!/usr/bin/env node
// Fake aplay for playback tests (no speaker, no shell): verifies the WAV path
// exists, then sleeps until SIGTERM (clean exit 0) to exercise fence cancel.
// Mode via FAKE_APLAY_MODE:
//   hang (default): sleep until SIGTERM, exit 0;
//   fail: exit 3 immediately (nonzero-exit path).
// Pid goes to $FAKE_APLAY_PIDFILE when set, so the test can prove no orphan.
import { readFileSync, writeFileSync } from 'node:fs';
const mode = process.env.FAKE_APLAY_MODE ?? 'hang';
const wavPath = process.argv[process.argv.length - 1];
const pidFile = process.env.FAKE_APLAY_PIDFILE;
if (pidFile) writeFileSync(pidFile, `${process.pid}\n`);

if (mode === 'fail') {
  process.exit(3);
}

if (mode === 'hang') {
  readFileSync(wavPath);
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
} else {
  readFileSync(wavPath);
  process.exit(0);
}
