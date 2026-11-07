import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { campaign } from '../../../../scripts/ci/ci-performance-report.mjs';
const bytes = fs.readFileSync('../runs.json');
const report = campaign(JSON.parse(bytes).runs);
fs.writeFileSync('node_modules/.ci-report.json', JSON.stringify({ ...report,
  inputSha256: createHash('sha256').update(bytes).digest('hex'),
  diagramSourceSha256: createHash('sha256').update(fs.readFileSync('vendor/diagram-source.tgz')).digest('hex') }));
