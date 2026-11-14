import type { DsTone } from './container.js';

/** Stable semantic mapping, not an assertion of identical RGB values. */
export const colorTones = {
  orange: 'category1', blue: 'category2', green: 'category3',
  red: 'category4', purple: 'category5', white: 'neutral',
} as const satisfies Record<string, DsTone>;

export function fieldCardPresentation(color = '', variant: 'colored' | 'plain' | 'bordered' = 'colored') {
  return {
    variant: variant === 'colored' ? 'accent' as const : variant,
    tone: variant === 'colored' ? colorTones[color as keyof typeof colorTones] ?? 'neutral' : 'neutral',
  };
}

export type PrintPresentation = {
  printClass?: string; printGridClass?: string; pageBreakBefore?: string;
  pageBreakAfter?: string; pageBreakInside?: string; pageContext?: string;
  printOnly?: boolean; screenOnly?: boolean;
};

/** Opaque tokens are preserved, including custom descriptors and token lists. */
export function printHooks(value: PrintPresentation, grid = false): Record<string, string> {
  const result: Record<string, string> = {};
  // Grid tokens go on the inner grid, using the same opaque layout contract.
  if (grid) return value.printGridClass ? { 'data-print-layout': value.printGridClass } : {};
  if (value.printClass) result['data-print-layout'] = value.printClass;
  for (const [key, hook] of [
    ['pageBreakBefore', 'break-before'], ['pageBreakAfter', 'break-after'],
    ['pageBreakInside', 'break-inside'], ['pageContext', 'page'],
  ] as const) {
    const attribute = value[key];
    if (attribute) result[`data-print-${hook}`] = attribute;
  }
  if (value.printOnly) result['data-print-only'] = 'true';
  if (value.screenOnly) result['data-print-hidden'] = 'true';
  return result;
}
