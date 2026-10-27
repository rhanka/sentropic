#!/usr/bin/env node
// Fake aplay for playback tests (no speaker, no shell): reads the WAV from
// stdin (proving the pipe carries exact bytes), then behaves per mode:
//   ok (default): verify stdin, exit 0 (natural end);
//   hang: hold stdin, sleep until SIGTERM, exit 0 (fence-cancel path);
//   fail: exit 3 immediately (nonzero-exit path).
// $FAKE_APLAY_PIDFILE receives the pid when set, so the test can prove no
// orphan stays. $FAKE_APLAY_EXPECT_HEX asserts the exact piped bytes.
import { readFileSync, writeFileSync } from 'node:fs';
const mode = process.env.FAKE_APLAY_MODE ?? 'ok';
const pidFile = process.env.FAKE_APLAY_PIDFILE;
if (pidFile) writeFileSync(pidFile, `${process.pid}\n`);

if (mode === 'fail') {
  process.exit(3);
}

const input = readFileSync(0);
const expectHex = process.env.FAKE_APLAY_EXPECT_HEX;
if (expectHex !== undefined && input.toString('hex') !== expectHex) {
  process.exit(4);
}

if (mode === 'hang') {
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
} else {
  process.exit(0);
}
