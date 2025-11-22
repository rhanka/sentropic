const BULLET_PATTERN = /(^|\n)[ \t]*[•▪‣●◦]/g;
const SINGLE_NEWLINE_PATTERN = /([^\n\r])\r?\n(?!\r?\n|\s*[-*•])/g;

/**
 * Normalise un champ markdown issu des use cases historiques.
 * - Convertit les puces unicode en listes markdown `-`
 * - Ajoute un saut de ligne supplémentaire entre les paragraphes
 * - Idempotent : appliquer plusieurs fois ne change pas le résultat
 */
export function normalizeUseCaseMarkdown(text: string | null | undefined): string {
  if (!text) return '';

  // Normaliser les retours Windows/ancien format
  let normalized = text.replace(/\r\n/g, '\n');

  // Convertir les puces unicode en listes Markdown
  normalized = normalized.replace(BULLET_PATTERN, '$1- ');

  // Ajouter un saut de ligne supplémentaire entre les paragraphes
  normalized = normalized.replace(SINGLE_NEWLINE_PATTERN, '$1\n\n');

  return normalized.trim();
}


