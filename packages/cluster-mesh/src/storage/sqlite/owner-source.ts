// Only this fixed program runs in the writer process. Caller callbacks
// execute across IPC in the caller, never alongside SQLite's POSIX locks.
export const SQLITE_OWNER_SOURCE = String.raw`
import { readSync, writeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { StringDecoder } from 'node:string_decoder';
const decoder = new StringDecoder('utf8');
let buffered = '';
const send = value => {
  const data = Buffer.from(JSON.stringify(value) + '\n');
  for (let offset = 0; offset < data.length;) offset += writeSync(1, data, offset);
};
const receive = () => {
  while (!buffered.includes('\n')) {
    const data = Buffer.alloc(65536);
    const size = readSync(0, data);
    if (!size) process.exit(0);
    buffered += decoder.write(data.subarray(0, size));
  }
  const end = buffered.indexOf('\n');
  const line = buffered.slice(0, end);
  buffered = buffered.slice(end + 1);
  return JSON.parse(line);
};
const fail = error => send({ error: { name: error.name, message: error.message,
  code: error.code, errcode: error.errcode, errstr: error.errstr } });
let db;
try { db = new DatabaseSync(process.argv[1]); send({ result: process.pid }); }
catch (error) { fail(error); process.exit(1); }
const dispatch = request => {
  try {
    let result;
    if (request.op === 'close') { db.close(); send({ result: null }); process.exit(0); }
    if (request.op === 'exec') db.exec(request.sql);
    else if (request.op === 'function') db.function(request.sql, request.options, (...args) => {
      send({ callback: request.sql, args });
      for (;;) {
        const reply = receive();
        if (reply.op !== 'callback-result') { dispatch(reply); continue; }
        if (reply.error) throw Object.assign(new Error(reply.error.message), reply.error);
        return reply.result;
      }
    });
    else if (['get', 'all', 'run'].includes(request.op)) {
      result = db.prepare(request.sql)[request.op](...request.args);
    } else if (request.op !== 'exec') throw new Error('Unsupported SQLite owner request');
    send({ result });
  } catch (error) { fail(error); }
};
for (;;) dispatch(receive());
`;
