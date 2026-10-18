// Keep the generated lock reviewable by package entry; candidate bytes have a separate archive receipt.
import fs from 'node:fs';
const [working, target] = process.argv.slice(2);
const lock = JSON.parse(fs.readFileSync(working, 'utf8'));
delete lock.packages['node_modules/@sentropic/cluster-mesh'].integrity;
const fields = Object.entries(lock).filter(([name]) => name !== 'packages')
  .map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
const entries = Object.entries(lock.packages).map(([name, value]) =>
  `    ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
fs.writeFileSync(target, `{\n${fields.join(',\n')},\n  "packages": {\n${entries.join(',\n')}\n  }\n}\n`);
