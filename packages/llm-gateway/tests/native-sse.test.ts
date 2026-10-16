import { describe, expect, it } from 'vitest';
import {
  concatBytes,
  NativeSseFramer,
  NativeSseFrameOverflowError,
  parseNativeSseStream,
} from '../src/native-sse.js';

describe('native SSE byte framer', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const dec = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

  it('recognizes LF, CRLF and CR delimited frames', () => {
    const framer = new NativeSseFramer();
    const input = 'event: a\ndata: 1\n\nevent: b\r\ndata: 2\r\n\r\nevent: c\rdata: 3\r\r';
    const frames = [...framer.push(enc(input)), ...framer.finish()];
    expect(frames).toHaveLength(3);
    expect(frames[0]!.event).toBe('a');
    expect(frames[0]!.data).toBe('1');
    expect(dec(frames[0]!.rawBytes)).toBe('event: a\ndata: 1\n\n');

    expect(frames[1]!.event).toBe('b');
    expect(frames[1]!.data).toBe('2');
    expect(dec(frames[1]!.rawBytes)).toBe('event: b\r\ndata: 2\r\n\r\n');

    expect(frames[2]!.event).toBe('c');
    expect(frames[2]!.data).toBe('3');
    expect(dec(frames[2]!.rawBytes)).toBe('event: c\rdata: 3\r\r');
  });

  it('handles split trailing CR across chunk boundaries', () => {
    const framer = new NativeSseFramer();
    const c1 = enc('event: delta\r\ndata: {"test":1}\r\n\r');
    const c2 = enc('\n');
    expect(framer.push(c1)).toHaveLength(0);
    const frames = framer.push(c2);
    expect(frames).toHaveLength(1);
    expect(dec(frames[0]!.rawBytes)).toBe('event: delta\r\ndata: {"test":1}\r\n\r\n');

    const c3 = enc('event: stand\rdata: 1\r\r');
    const c4 = enc('event: next\rdata: 2\r\r');
    expect(framer.push(c3)).toHaveLength(0);
    const f3 = framer.push(c4);
    expect(f3).toHaveLength(1);
    expect(f3[0]!.event).toBe('stand');
    const f4 = framer.finish();
    expect(f4).toHaveLength(1);
    expect(f4[0]!.event).toBe('next');
  });

  it('preserves split multi-byte UTF-8 across chunks', () => {
    const framer = new NativeSseFramer();
    const part1 = enc('event: delta\ndata: {"text":"');
    const emoji = enc('🤖');
    const part2 = enc('"}\n\n');

    const chunk1 = new Uint8Array([...part1, emoji[0]!, emoji[1]!]);
    const chunk2 = new Uint8Array([emoji[2]!, emoji[3]!, ...part2]);

    expect(framer.push(chunk1)).toHaveLength(0);
    const frames = framer.push(chunk2);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBe('{"text":"🤖"}');
    expect(dec(frames[0]!.rawBytes)).toContain('🤖');
  });

  it('parses comments, id, retry and multiple data lines preserving exact rawBytes', () => {
    const framer = new NativeSseFramer();
    const raw = ': ping comment\nevent: custom\nid: msg_01\nretry: 3000\ndata: part1\ndata: part2\n\n';
    const frames = framer.push(enc(raw));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.comments).toEqual(['ping comment']);
    expect(frames[0]!.event).toBe('custom');
    expect(frames[0]!.id).toBe('msg_01');
    expect(frames[0]!.retry).toBe(3000);
    expect(frames[0]!.data).toBe('part1\npart2');
    expect(dec(frames[0]!.rawBytes)).toBe(raw);
  });

  it('bounds pending frame to maxFrameBytes and throws overflow error', () => {
    const framer = new NativeSseFramer(100);
    expect(() => framer.push(enc('data: ' + 'x'.repeat(120)))).toThrow(NativeSseFrameOverflowError);

    const incremental = new NativeSseFramer(50);
    incremental.push(enc('data: ' + 'a'.repeat(30)));
    expect(() => incremental.push(enc('a'.repeat(30)))).toThrow(NativeSseFrameOverflowError);

    const fExact = new NativeSseFramer(20);
    const exactFrames = fExact.push(enc('data: 123456789012\n\n'));
    expect(exactFrames).toHaveLength(1);
    expect(exactFrames[0]!.rawBytes.length).toBe(20);

    const fOver = new NativeSseFramer(20);
    expect(() => fOver.push(enc('data: 1234567890123\n\n'))).toThrow(NativeSseFrameOverflowError);

    const f1M = new NativeSseFramer();
    expect(() => f1M.push(enc('data: ' + 'x'.repeat(1024 * 1024) + '\n\n'))).toThrow(NativeSseFrameOverflowError);

    const fCross = new NativeSseFramer(20);
    fCross.push(enc('data: 1234567890'));
    expect(() => fCross.push(enc('123\n\n'))).toThrow(NativeSseFrameOverflowError);

    const fCrossExact = new NativeSseFramer(20);
    fCrossExact.push(enc('data: 1234567890'));
    const crossFrames = fCrossExact.push(enc('12\n\n'));
    expect(crossFrames).toHaveLength(1);
    expect(crossFrames[0]!.rawBytes.length).toBe(20);

    const fMulti = new NativeSseFramer(20);
    const multi = enc('data: 123456789012\n\ndata: abcdefghijkl\n\n');
    const mFrames = fMulti.push(multi);
    expect(mFrames).toHaveLength(2);
    expect(mFrames[0]!.rawBytes.length).toBe(20);
    expect(mFrames[1]!.rawBytes.length).toBe(20);
  });

  it('preserves opaque byte fidelity across leading, repeated and trailing blank lines and chunks', () => {
    const framer = new NativeSseFramer();
    const c1 = enc('data: 1\n\n\n');
    const c2 = enc('data: 2\n\n');
    const f1 = framer.push(c1);
    const f2 = framer.push(c2);
    expect(f1).toHaveLength(2);
    expect(f2).toHaveLength(1);
    const all = [...f1, ...f2];
    const cat = concatBytes(all.map(f => f.rawBytes));
    expect(dec(cat)).toBe('data: 1\n\n\ndata: 2\n\n');

    const f2Framer = new NativeSseFramer();
    const complex = '\n\n\r\n: ping\n\n\n\nevent: ok\r\ndata: {"ok":true}\r\n\r\n\r\r';
    const chunks = [
      enc('\n\n\r\n: ping\n\n'),
      enc('\n\nevent: ok\r\ndata: {"ok":'),
      enc('true}\r\n\r\n\r'),
      enc('\r'),
    ];
    const gathered = [...chunks.flatMap(c => f2Framer.push(c)), ...f2Framer.finish()];
    const gatheredBytes = concatBytes(gathered.map(f => f.rawBytes));
    expect(dec(gatheredBytes)).toBe(complex);
  });

  it('streams frames via parseNativeSseStream async generator', async () => {
    async function* source() {
      yield enc('event: start\ndata: {"ok":true}\n\n');
      yield enc('event: stop\ndata: {}');
      yield enc('\n\n');
    }
    const received: string[] = [];
    for await (const frame of parseNativeSseStream(source())) {
      received.push(frame.event ?? '');
    }
    expect(received).toEqual(['start', 'stop']);
  });
  it('yields a completed first frame before a later overflow in the same transport chunk', async () => {
    const first = enc(': ready\r\n\r\n');
    const source = (async function* () { yield concatBytes([first, enc('x'.repeat(41))]); })();
    const frames = parseNativeSseStream(source, 40);
    expect((await frames.next()).value).toMatchObject({ rawBytes: first });
    await expect(frames.next()).rejects.toBeInstanceOf(NativeSseFrameOverflowError);
  });
});
