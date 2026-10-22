// Same pictogram geometry as the read-only influence dossier scene.mjs.
// Colours resolve through this dossier's installed design-system tokens.
const ICONS = {
  people: ['M22 10a8 8 0 1 1 0 16a8 8 0 1 1 0-16Z M42 14a7 7 0 1 1 0 14a7 7 0 1 1 0-14Z M8 46c0-9 6-15 14-15s14 6 14 15Z M34 46c0-8 4-13 9-13s12 5 12 13Z', ''],
  window: ['M9 11h46v36H9Z', 'M9 19h46 M16 28h32 M16 35h22'],
  server: ['M14 8h36v14H14Z M14 25h36v14H14Z', 'M20 15h10 M20 32h10 M42 15h.1 M42 32h.1'],
  brain: ['M32 12c-4-7-15-5-16 3c-8 1-11 11-6 17c-5 8 0 17 8 17c5 5 12 3 14-2c2 5 9 7 14 2c8 0 13-9 8-17c5-6 2-16-6-17c-1-8-12-10-16-3Z', 'M32 12v35 M16 15c0 6 4 9 9 9 M10 32c4-4 9-3 12 1 M18 49c-2-5 0-10 5-12 M48 15c0 6-4 9-9 9 M54 32c-4-4-9-3-12 1 M46 49c2-5 0-10-5-12'],
  robot: ['M14 16h36v31H14Z M8 25h6v13H8Z M50 25h6v13h-6Z M29 6h6v5h-6Z', 'M32 11v5 M23 27h.1 M41 27h.1 M23 38h18'],
  link: ['M10 12h16v14H10Z M38 30h16v14H38Z', 'M26 19h12v11', true],
  db: ['M14 13c0-4 8-7 18-7s18 3 18 7v29c0 4-8 7-18 7s-18-3-18-7Z', 'M14 13c0 4 8 7 18 7s18-3 18-7 M14 27c0 4 8 7 18 7s18-3 18-7'],
  shield: ['M32 7l20 7v13c0 12-8 20-20 25C20 47 12 39 12 27V14Z', 'M23 29l6 6 12-13'],
  cloud: ['M18 44a10 10 0 0 1 0-20a14 14 0 0 1 27-4a11 11 0 0 1 3 24Z', ''],
};

export const groupIcons = {
  h2a: 'people', surfaces: 'window', 'cluster-mesh': 'server',
  'cm-catalog': 'window', 'cat-mcp': 'link', 'cm-storage': 'db',
  'cm-security': 'shield', 'cm-cluster': 'link', 'cm-providers': 'cloud',
  engram: 'db', 'design-system': 'window',
};

export function diagramIcon(name, x, y, size = 42) {
  const [face, line, dark] = ICONS[name] ?? ICONS.server;
  return `<g class="diagram-icon" transform="translate(${x} ${y}) scale(${size / 64})" aria-hidden="true"><path class="icon-base" d="M8 53L32 44L56 53L32 62Z"/><path class="icon-face" d="${face}"/>${line ? `<path class="icon-line${dark ? ' dark' : ''}" d="${line}"/>` : ''}</g>`;
}
