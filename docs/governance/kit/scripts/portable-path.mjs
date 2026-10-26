import { readFileSync } from 'node:fs';
export const dossier = JSON.parse(readFileSync(new URL('../dossier.json', import.meta.url)));
export const portableName = `governance-${dossier.revision}-portable.html`;
