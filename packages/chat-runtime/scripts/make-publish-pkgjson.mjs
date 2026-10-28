import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(file, 'utf8'));
const convert = (value, types = false) => value.replace('./src/', './dist/').replace(/\.ts$/, types ? '.d.ts' : '.js');
pkg.main = convert(pkg.main);
pkg.types = convert(pkg.types, true);
for (const entry of Object.values(pkg.exports)) {
  for (const key of Object.keys(entry)) entry[key] = convert(entry[key], key === 'types');
}
const output = JSON.stringify(pkg, null, 2) + '\n';
if (process.argv.includes('--write')) writeFileSync(file, output);
else process.stdout.write(output);
