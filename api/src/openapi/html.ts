import { readFileSync, writeFileSync } from 'node:fs';

const json = JSON.parse(readFileSync('openapi.json', 'utf8'));
const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${json.info.title} – ${json.info.version}</title>
  </head>
  <body>
    <pre>${JSON.stringify(json, null, 2)}</pre>
  </body>
</html>`;

writeFileSync('openapi.html', html);
