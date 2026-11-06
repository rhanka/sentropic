import { chmod, lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';

try {
  const root = '/run/cm-cutover', metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.uid !== process.getuid() || await realpath(root) !== root) throw new Error();
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 70 * 1024 * 1024) throw new Error();
    chunks.push(chunk);
  }
  const files = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const names = Object.keys(files).sort().join(',');
  if (!['remote.json,request.json', 'rehearsal.json'].includes(names)
    || Object.values(files).some(value => typeof value !== 'string')) throw new Error();
  await chmod(root, 0o700);
  for (const [name, bytes] of Object.entries(files)) {
    const file = await open(`${root}/${name}`, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    process.stdout.write(`${name.replace('.json', '')}Sha256=${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
} catch {
  process.stderr.write('failureSha256=4431e9bc761ef21a8c8276e0f2b992d23780139c80fed3d504b26f7b962d25de\n');
  process.exitCode = 1;
}
