// usage: node probe.mjs <baseUrl> <okPath> <prefix> <mode: fixed|vulnerable>
// Raw wire paths via http.request (fetch would normalize them). okPath must answer 200 (positive control).
// fixed: every raw-backslash probe MUST answer 400 and encoded variants MUST NOT answer 200.
// vulnerable (negative control): at least one raw-backslash probe answers 200 (proves the probe discriminates).
import { request } from 'node:http';
const [base, okPath, prefix, mode] = process.argv.slice(2);
const { hostname, port } = new URL(base);
const get = (path) => new Promise((resolve, reject) => {
  const req = request({ hostname, port, path, method: 'GET' }, (res) => {
    let body = ''; res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 80) }));
  });
  req.on('error', reject); req.end();
});
const tail = okPath.replace(/^\//, '');
const bs = tail.replaceAll('/', '\\');
const raw = [`/${prefix}\\..\\${bs}`, `/${prefix}/..\\${bs}`, `\\${bs}`, `/${tail.split('/')[0]}\\${tail.split('/').slice(1).join('\\')}`];
const enc = [`/${prefix}%5c..%5c${tail.replaceAll('/', '%5c')}`, `/${prefix}%5C..%5C${tail.replaceAll('/', '%5C')}`,
  `/${prefix}%255c..%255c${tail.replaceAll('/', '%255c')}`, `/${prefix}/%2e%2e%5c${tail.replaceAll('/', '%5c')}`];
const ok = await get(okPath);
console.log(`positive control ${okPath}: ${ok.status}`);
if (ok.status !== 200) { console.error('positive control failed'); process.exit(2); }
let fail = false; let vulnerableHit = 0;
for (const p of raw) { const r = await get(p); console.log(`raw  ${JSON.stringify(p)} -> ${r.status}`); if (r.status === 200) vulnerableHit++; if (mode === 'fixed' && r.status !== 400) fail = true; }
for (const p of enc) { const r = await get(p); console.log(`enc  ${JSON.stringify(p)} -> ${r.status}`); if (mode === 'fixed' && r.status === 200) fail = true; }
if (mode === 'vulnerable') { if (vulnerableHit === 0) { console.error('negative control: no raw probe reached the route, probe not discriminating'); process.exit(3); } console.log(`negative control OK (${vulnerableHit} raw probes reached the route)`); process.exit(0); }
if (fail) { console.error('FIXED mode: a backslash probe was not rejected'); process.exit(1); }
console.log('all backslash probes rejected');
