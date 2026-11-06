import { expect, it } from 'vitest';
import { readBoundedLiveJson } from '../src/server/live-body.js';

it('should count streamed bytes before parsing and stop consuming an oversized body', async () => {
  let consumed = 0;
  async function* body() {
    for (let i = 0; i < 20; i++) { consumed++; yield Buffer.alloc(1024 * 1024, 32); }
  }
  await expect(readBoundedLiveJson(body(), 'live_write')).rejects.toMatchObject({ kind: 'limit_exceeded' });
  expect(consumed).toBe(17);
});
it('should decode exact split UTF-8 and reject invalid UTF-8 or non-object JSON', async () => {
  const bytes = Buffer.from('{"text":"é\r\n"}'.replace('\r\n', '\\r\\n'));
  async function* chunks() { for (const byte of bytes) yield Uint8Array.of(byte); }
  expect(await readBoundedLiveJson(chunks(), 'live_write')).toEqual({ text: 'é\r\n' });
  for (const bytes of [Uint8Array.of(0xff), Buffer.from('[]')]) {
    await expect(readBoundedLiveJson((async function* () { yield bytes; })(), 'live_write'))
      .rejects.toMatchObject({ kind: 'invalid_request' });
  }
});
