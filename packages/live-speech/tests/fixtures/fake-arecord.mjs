#!/usr/bin/env node
// Fake arecord for backend tests (no microphone, no shell): emits raw S16LE
// mono PCM on stdout. Mode via FAKE_ARECORD_MODE:
//   frames-loss (default): 4 frames of 20 ms @16 kHz, then exit 1 (loss path);
//   exit-early: one stderr line, exit 2 with no bytes after 60 ms (open path);
//     the delay sits past any fixed ready probe (e.g. 50 ms): only a
//     readiness signal from the process itself may settle the open.
//   infinite: a frame every 20 ms until SIGTERM (close/cleanup path).
// Argv is ignored on purpose: the device under test builds it.
const mode = process.env.FAKE_ARECORD_MODE ?? 'frames-loss';
const FRAME_BYTES = 640;

function sineFrame(seed) {
  const buffer = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES / 2; i++) {
    buffer.writeInt16LE(Math.floor(9000 * Math.sin((seed * (FRAME_BYTES / 2) + i) / 8)), i * 2);
  }
  return buffer;
}

if (mode === 'exit-early') {
  setTimeout(() => {
    process.stderr.write('fake-arecord: no such device\n');
    process.exit(2);
  }, 60);
}

if (mode === 'infinite') {
  let seed = 0;
  const timer = setInterval(() => {
    try {
      process.stdout.write(sineFrame(seed++));
    } catch {
      clearInterval(timer);
      process.exit(0);
    }
  }, 20);
  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
} else if (mode !== 'exit-early') {
  for (let seed = 0; seed < 4; seed++) process.stdout.write(sineFrame(seed));
  process.stdout.end(() => process.exit(1));
}
