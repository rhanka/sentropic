import { marked } from 'marked';
import DOMPurify from 'dompurify';

const BULLET_PATTERN = /(^|\n)[ \t]*[•▪‣●◦]/g;
const SINGLE_NEWLINE_PATTERN = /([^\n\r])\r?\n(?!\r?\n|\s*[-*•]|\s*$)/g;
const BULLET_LINE_PATTERN = /^\s*(?:[-*+]|(?:\d+\.)|\u2022|\u2023|\u25e6)\s+/;

export interface Reference {
  title: string;
  url: string;
}

export interface RenderMarkdownOptions {
  /**
   * Si true, ajoute des styles CSS pour les listes (ul, ol, li)
   * @default false
   */
  addListStyles?: boolean;
  /**
   * Si true, ajoute des styles CSS pour les titres (h2, h3)
   * @default false
   */
  addHeadingStyles?: boolean;
  /**
   * Padding des listes en rem (utilisé si addListStyles est true)
   * @default 1.5
   */
  listPadding?: number;
}

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

/**
 * Configuration DOMPurify pour sanitizer le HTML markdown
 * Autorise les éléments nécessaires tout en bloquant les risques XSS
 */
const sanitizeConfig = {
  ALLOWED_TAGS: ['p', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'strong', 'em', 'code', 'pre', 'blockquote', 'br', 'hr', 'span', 'b', 'i', 'u'],
  ALLOWED_ATTR: ['class', 'style', 'href', 'title', 'id', 'onclick'],
  ALLOWED_CLASSES: true, // Autoriser toutes les classes (pour Tailwind)
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  SAFE_FOR_TEMPLATES: true,
  // Autoriser les liens internes avec # (pour les références) et les protocoles standards
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|#):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
};

/**
 * Sanitize le HTML avec DOMPurify (côté client uniquement)
 * En SSR, retourne le HTML brut (sera sanitizé lors de l'hydratation côté client)
 */
function sanitizeHtml(html: string): string {
  // DOMPurify nécessite window (côté client uniquement)
  if (typeof window === 'undefined') {
    // En SSR, retourner le HTML tel quel (sera sanitizé au hydratation côté client)
    return html;
  }
  return DOMPurify.sanitize(html, sanitizeConfig);
}

/**
 * Crée un lien HTML vers une référence avec scroll smooth
 */
export function createReferenceLink(num: string, ref: Reference): string {
  const refId = `ref-${num}`;
  return `<a href="#${refId}" 
              class="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer" 
              title="${ref.title.replace(/"/g, '&quot;')}"
              onclick="event.preventDefault(); document.getElementById('${refId}')?.scrollIntoView({behavior: 'smooth', block: 'center'}); return false;">
              [${num}]
            </a>`;
}

/**
 * Parse les références [1], [2] dans du HTML markdown et les remplace par des liens cliquables
 */
export function parseReferencesInMarkdown(html: string, references: Reference[] = []): string {
  if (!html || !references || references.length === 0) return html;
  
  // Remplacer les patterns [1], [2], etc par des liens cliquables
  return html.replace(/\[(\d+)\]/g, (match, num) => {
    const index = parseInt(num) - 1;
    if (index >= 0 && index < references.length) {
      return createReferenceLink(num, references[index]);
    }
    return match; // Si la référence n'existe pas, garder le texte original
  });
}

/**
 * Parse les références [1], [2] dans un texte simple (pas markdown) et les remplace par des liens cliquables
 */
export function parseReferencesInText(text: string, references: Reference[] = []): string {
  if (!text || !references || references.length === 0) return text;
  
  // Remplacer les patterns [1], [2], etc par des liens cliquables
  let html = text.replace(/\[(\d+)\]/g, (match, num) => {
    const index = parseInt(num) - 1;
    if (index >= 0 && index < references.length) {
      return createReferenceLink(num, references[index]);
    }
    return match; // Si la référence n'existe pas, garder le texte original
  });
  
  // Sanitizer le HTML avant de le retourner (protection XSS)
  return sanitizeHtml(html);
}

/**
 * Rend du markdown en HTML avec parsing des références et options de styling
 * 
 * @param text - Le texte markdown à rendre
 * @param references - Les références pour parser les patterns [1], [2], etc.
 * @param options - Options pour le post-traitement CSS (listes, titres)
 * @returns Le HTML rendu avec références parsées
 */
export function renderMarkdownWithRefs(
  text: string | null | undefined,
  references: Reference[] = [],
  options: RenderMarkdownOptions = {}
): string {
  if (!text) return '';
  
  // Normaliser le markdown (puces unicode, sauts de ligne, etc.)
  const normalized = normalizeUseCaseMarkdown(text);
  
  // Convertir markdown en HTML
  const markedResult = marked(normalized);
  let html = typeof markedResult === 'string' ? markedResult : String(markedResult);
  
  // Post-traitement optionnel pour les styles CSS
  const {
    addListStyles = false,
    addHeadingStyles = false,
    listPadding = 1.5
  } = options;
  
  if (addListStyles) {
    html = html.replace(/<ul>/g, `<ul class="list-disc space-y-2 mb-4" style="padding-left:${listPadding}rem;">`);
    html = html.replace(/<ol>/g, `<ol class="list-decimal space-y-2 mb-4" style="padding-left:${listPadding}rem;">`);
    html = html.replace(/<li>/g, '<li class="mb-1">');
  }
  
  if (addHeadingStyles) {
    html = html.replace(/<h2>/g, '<h2 class="text-xl font-semibold text-slate-900 mt-6 mb-4">');
    html = html.replace(/<h3>/g, '<h3 class="text-lg font-semibold text-slate-800 mt-4 mb-3">');
  }
  
  // Parser les références [1], [2], etc.
  html = parseReferencesInMarkdown(html, references);
  
  // Sanitizer le HTML avant de le retourner (protection XSS)
  return sanitizeHtml(html);
}


