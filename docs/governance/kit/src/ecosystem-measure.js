import { cardFontMetrics } from './governance-font-metrics.js';

// The embedded Inter 700 face is used for every weight, so static and browser
// rendering share exactly these glyph advances. Never truncate a slot.
export function measure(text, role, availableWidth) {
  const size = { kicker: 22, title: 32, body: 24, footer: 24 }[role];
  const widths = cardFontMetrics.title.widths;
  const width = value => [...value].reduce((sum, char) => sum + (widths[char] ?? 0.7) * size, 0)
    + (role === 'kicker' ? Math.max(0, value.length - 1) * size * 0.04 : 0);
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.match(/[^\s/-]+[/-]?[ \t]*|[/-][ \t]*/g) ?? []) {
      const next = line + word;
      if (line && width(next.trimEnd()) > availableWidth) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line = next;
    }
    if (line) lines.push(line.trimEnd());
  }
  const lineWidths = lines.map(width);
  return { lines, lineWidths, tooWide: lineWidths.some(value => value > availableWidth) };
}
