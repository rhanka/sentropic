// release-20261102.0: openStream connects a UDS, then Loader.portForward
// rejects NetworkNone or donates the FD to the sentry and exits successfully.
import { connect } from 'node:net';
const path = process.argv.find(arg => arg.startsWith('--stream=')).slice(9);
const stream = connect(path);
stream.on('error', () => process.exit(1));
stream.once('connect', () => {
  if (process.env.FAKE_RUNSC_NETWORK === 'none') {
    console.error('PortForward: unsupported network type "none"');
    stream.destroy(); process.exit(1);
  }
  process.send('donate', stream, { keepOpen: false }, error => {
    if (error) process.exit(1);
    process.disconnect();
  });
});
