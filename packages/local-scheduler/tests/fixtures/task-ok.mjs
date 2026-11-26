import net from 'node:net';

const mode = process.argv[2] ?? 'ok';
if (mode === 'ok') {
  console.log(`task-ok NODE_OPTIONS=${process.env.NODE_OPTIONS ?? 'unset'}`);
  process.exit(0);
}
if (mode === 'tcp-probe') {
  const socket = net.connect({ host: '127.0.0.1', port: 3002 });
  socket.setTimeout(1_500);
  socket.on('connect', () => {
    console.error('UNEXPECTED TCP CONNECT SUCCEEDED');
    socket.destroy();
    process.exit(1);
  });
  socket.on('error', (err) => {
    const code = (err).code ?? '';
    if (['EACCES', 'EPERM', 'EAFNOSUPPORT'].includes(code)) {
      console.log(`tcp-blocked:${code}`);
      process.exit(0);
    }
    console.error(`unexpected tcp error: ${code} ${err.message}`);
    process.exit(1);
  });
  socket.on('timeout', () => {
    console.error('unexpected tcp timeout');
    socket.destroy();
    process.exit(1);
  });
} else if (mode === 'hang') {
  setInterval(() => {}, 1_000);
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}
