#!/usr/bin/env node
/** Opt-in REAL Google API smoke. It never prints the OAuth access token. */
import { invokeGmailLive, invokeGoogleDriveLive } from '../src/live-broker.ts';

function fail(code) {
  console.error(`[smoke-google-live] FAIL: ${code}`);
  process.exitCode = 1;
}

async function main() {
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (!token) {
    console.log('GOOGLE_OAUTH_ACCESS_TOKEN not set — skipping live smoke');
    return;
  }

  const drive = await invokeGoogleDriveLive('about.get', {}, token);
  if (!drive.ok || !drive.output) {
    fail(drive.error?.code ?? 'drive-about-get-failed');
    return;
  }
  const user = drive.output.user;
  console.log('[smoke-google-live] Drive about.get:', { emailAddress: user?.emailAddress ?? null });

  const gmail = await invokeGmailLive('labels.list', {}, token);
  if (!gmail.ok || !gmail.output) {
    fail(gmail.error?.code ?? 'gmail-labels-list-failed');
    return;
  }
  const labels = gmail.output.labels;
  console.log('[smoke-google-live] Gmail labels.list:', { labelCount: Array.isArray(labels) ? labels.length : 0 });
}

main().catch(() => fail('unexpected-live-smoke-error'));
