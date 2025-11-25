const BULLET_PATTERN = /(^|\n)[ \t]*[•▪‣●◦]/g;
const SINGLE_NEWLINE_PATTERN = /([^\n\r])\r?\n(?!\r?\n|\s*[-*•]|\s*$)/g;
const BULLET_LINE_PATTERN = /^\s*(?:[-*+]|(?:\d+\.)|\u2022|\u2023|\u25e6)\s+/;

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

/**
 * Supprime le paragraphe vide généré automatiquement après une liste.
 * - N'intervient que si les dernières lignes sont vides ET précédées d'une vraie liste
 * - Idempotent : réappliquer ne change pas le résultat
 */
export function stripTrailingEmptyParagraph(text: string | null | undefined): string {
  if (!text) return '';

  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  let removed = false;
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
    removed = true;
  }

  if (!removed) {
    return text;
  }

  if (lines.length === 0) {
    return '';
  }

  const lastLine = lines[lines.length - 1].trim();
  if (!BULLET_LINE_PATTERN.test(lastLine)) {
    return text;
  }

  return lines.join('\n');
}

export function arrayToMarkdown(items?: string[]): string {
  if (!items || items.length === 0) return '';
  return items
    .map((item) => item?.trim?.())
    .filter((item): item is string => Boolean(item && item.length > 0))
    .map((item) => `- ${item}`)
    .join('\n');
}

export function markdownToArray(markdown?: string): string[] {
  if (!markdown) return [];
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\s*(?:[-*+]|(?:\d+\.)|\u2022|\u2023|\u25e6)\s+/, '').trim())
    .filter((line) => line.length > 0);
}


