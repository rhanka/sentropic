import { defaultPrompts } from '../config/default-prompts';
import { executeWithToolsStream } from './tools';
import { callOpenAI } from './openai';

const FORCED_DOCUMENT_MODEL = 'gpt-4.1-nano';
const DETAILED_DOCUMENT_MODEL = 'gpt-4.1-nano';

// Policy:
// - Full content is never returned when source > 10k words (documents.get_content).
// - Detailed summary target: ~10k words (minimum acceptable too).
// - Do NOT trim detailed summaries unless they exceed 3x the target (hard cap).
const WORDS_FULL_CONTENT_LIMIT = 10_000;
const DETAILED_TARGET_WORDS = 10_000;
// Minimum acceptable threshold (job fails under this), while keeping 10k as the target.
const DETAILED_MIN_WORDS = 8_000;
const DETAILED_HARD_TRIM_WORDS = 30_000;

// Minimum source words per "group to summarize" (unless the whole document is shorter).
// This is a content policy (not a heuristic): do not summarize tiny chunks.
const MIN_SOURCE_WORDS_PER_SECTION = 5_000;
// Heuristic "safe" budget for the text part inside the prompt.
// The full input includes prompt instructions + metadata, so we keep headroom.
const MAX_INPUT_TOKENS_EST = 650_000;
const INPUT_TOKENS_HEADROOM = 20_000;
const MAX_TEXT_TOKENS_EST = MAX_INPUT_TOKENS_EST - INPUT_TOKENS_HEADROOM;

function sanitizePgText(input: string): string {
  // PostgreSQL text/JSON cannot contain NUL (\u0000). Also strip other control chars that can break JSON ingestion.
  // Keep: \t \n \r.
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code === 0) continue;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    out += input[i];
  }
  return out;
}

function estimateTokensFromText(text: string): number {
  // Heuristic: tokens ≈ chars / 4. Good enough for gating & chunk sizing (FR/EN).
  const chars = (text || '').length;
  return Math.ceil(chars / 4);
}

function trimToMaxWords(text: string, maxWords: number): { text: string; trimmed: boolean; words: number } {
  const t = (text || '').trim();
  if (!t) return { text: '', trimmed: false, words: 0 };
  const words = t.split(/\s+/g).filter(Boolean);
  const max = Math.max(1, Math.floor(maxWords || WORDS_FULL_CONTENT_LIMIT));
  if (words.length <= max) return { text: t, trimmed: false, words: words.length };
  return { text: words.slice(0, max).join(' ') + '\n…(tronqué)…', trimmed: true, words: max };
}

function chunkTextByApproxTokens(text: string, targetTokens: number): string[] {
  const t = (text || '').trim();
  if (!t) return [];
  const target = Math.max(10_000, Math.floor(targetTokens || 300_000));
  const targetChars = target * 4;
  const out: string[] = [];
  let i = 0;

  while (i < t.length) {
    const end = Math.min(t.length, i + targetChars);
    if (end >= t.length) {
      out.push(t.slice(i));
      break;
    }

    // Try not to cut in the middle of a word: backtrack to the last whitespace in a small window.
    const windowStart = Math.max(i + Math.floor(targetChars * 0.7), i + 1);
    const window = t.slice(windowStart, end);
    const lastWs = window.search(/\s(?![\s\S]*\s)/); // last whitespace in window (via reverse-ish trick)
    const cut =
      lastWs >= 0
        ? windowStart + lastWs + 1
        : t.lastIndexOf(' ', end) > i
          ? t.lastIndexOf(' ', end)
          : end;

    out.push(t.slice(i, cut).trim());
    i = cut;
  }

  return out.filter((s) => s.trim());
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function countWords(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/g).filter(Boolean).length;
}

function buildDetailedSummaryPrompt(opts: {
  template: string;
  filename: string;
  lang: 'fr' | 'en';
  sourceLabel: string;
  scope: string;
  documentText: string;
  maxWords: number;
  minWords: number;
  continuationContext?: string;
  continuationInstructions?: string;
}): string {
  return opts.template
    .replace('{{filename}}', opts.filename)
    .replace('{{source_label}}', opts.sourceLabel)
    .replace('{{scope}}', opts.scope)
    .replace('{{document_text}}', opts.documentText)
    .replace('{{max_words}}', String(opts.maxWords))
    .replace('{{min_words}}', String(opts.minWords))
    .replace('{{continuation_context}}', (opts.continuationContext || '').trim())
    .replace('{{continuation_instructions}}', (opts.continuationInstructions || '').trim())
    .replace('{{lang}}', opts.lang === 'fr' ? 'français' : 'anglais');
}

function splitByMarkdownHeadingLevel(text: string, level: number): string[] {
  const t = (text || '').replace(/\r\n/g, '\n');
  const re = new RegExp(`^#{${level}}\\s+`, 'm');
  if (!re.test(t)) return [t.trim()].filter(Boolean);
  const lines = t.split('\n');
  const out: string[] = [];
  let cur: string[] = [];
  const headingRe = new RegExp(`^#{${level}}\\s+`);

  for (const line of lines) {
    if (headingRe.test(line)) {
      if (cur.length) out.push(cur.join('\n').trim());
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) out.push(cur.join('\n').trim());
  return out.filter(Boolean);
}

function pickBestHeadingLevel(text: string): number | null {
  const t = (text || '').replace(/\r\n/g, '\n');
  for (const lvl of [1, 2, 3]) {
    const re = new RegExp(`^#{${lvl}}\\s+`, 'm');
    if (re.test(t)) return lvl;
  }
  return null;
}

function splitIntoParagraphUnits(text: string): string[] {
  const t = (text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  return t.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
}

function partitionEvenly<T>(items: T[], groupsCount: number): T[][] {
  const n = items.length;
  const g = Math.max(1, Math.min(groupsCount, n));
  const base = Math.floor(n / g);
  const rem = n % g;
  const out: T[][] = [];
  let idx = 0;
  for (let i = 0; i < g; i += 1) {
    const size = base + (i < rem ? 1 : 0);
    out.push(items.slice(idx, idx + size));
    idx += size;
  }
  return out.filter((a) => a.length > 0);
}

function chunkTextByApproxWords(text: string, targetWords: number): string[] {
  const t = (text || '').trim();
  if (!t) return [];
  const target = Math.max(1_000, Math.floor(targetWords || 10_000));
  const words = t.split(/\s+/g).filter(Boolean);
  if (words.length <= target) return [t];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += target) {
    out.push(words.slice(i, i + target).join(' '));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function buildHeadingBasedSourceGroups(fullText: string): string[] {
  const text = (fullText || '').trim();
  if (!text) return [];

  // 1) Choose heading level based on the "top section" (#, else ##, else ###),
  // and if too few sections (<5), try deeper levels to increase granularity.
  const top = pickBestHeadingLevel(text);
  let units: string[] = [];
  if (top != null) {
    for (let lvl = top; lvl <= 3; lvl += 1) {
      const u = splitByMarkdownHeadingLevel(text, lvl);
      units = u;
      if (u.length >= 5) break;
    }
  } else {
    // Fallback: no headings → paragraph units
    units = splitIntoParagraphUnits(text);
  }
  units = units.map((u) => u.trim()).filter(Boolean);
  if (units.length === 0) return [];

  const totalWords = countWords(text);

  // If extraction produced no clear paragraph blocks (common for some PDF text extraction),
  // paragraph split can yield 1-2 giant blocks. In that case, fall back to deterministic
  // word-based chunking so we still get 5..10 groups and respect the 5000-words-min policy.
  if (units.length < 5) {
    const maxGroupsByMinSource = Math.max(1, Math.floor(totalWords / MIN_SOURCE_WORDS_PER_SECTION));
    const groupCount = clamp(Math.min(10, maxGroupsByMinSource), 1, 10);
    if (groupCount > 1) {
      const targetWordsPerGroup = Math.max(MIN_SOURCE_WORDS_PER_SECTION, Math.ceil(totalWords / groupCount));
      units = chunkTextByApproxWords(text, targetWordsPerGroup);
    }
  }

  // 2) Decide how many groups to aim for based on number of heading-sections:
  // between 5 and 10 when possible, but can be lower if the document is not long enough
  // to keep >=5000 source-words per group.
  const wantedBySections = clamp(units.length, 5, 10);
  const maxGroupsByMinSource = Math.max(1, Math.floor(totalWords / MIN_SOURCE_WORDS_PER_SECTION));
  const groupCount = Math.max(1, Math.min(wantedBySections, maxGroupsByMinSource, units.length));

  // 3) First pass: group by number of sections (even distribution), preserving order.
  const groupedUnits = partitionEvenly(units, groupCount);
  const groupedText = groupedUnits.map((g) => g.join('\n\n').trim()).filter(Boolean);

  // 4) Enforce >=5000 source-words per group by merging adjacent groups if needed.
  // (May reduce group count below 5 when the doc isn't long enough; that's expected.)
  const merged: string[] = [];
  let cur = '';
  let curWords = 0;
  for (const g of groupedText) {
    const gw = countWords(g);
    if (!cur) {
      cur = g;
      curWords = gw;
      continue;
    }
    if (curWords < MIN_SOURCE_WORDS_PER_SECTION) {
      cur = `${cur}\n\n${g}`.trim();
      curWords += gw;
      continue;
    }
    merged.push(cur);
    cur = g;
    curWords = gw;
  }
  if (cur) merged.push(cur);
  // If the last group is still < min and we have at least 2 groups, merge it into previous.
  if (merged.length >= 2) {
    const last = merged[merged.length - 1]!;
    if (countWords(last) < MIN_SOURCE_WORDS_PER_SECTION) {
      merged[merged.length - 2] = `${merged[merged.length - 2]}\n\n${last}`.trim();
      merged.pop();
    }
  }

  // 5) Technical guardrail: if any group is still too large for the input budget, split it by tokens.
  // This can increase the number of calls beyond 10, but only to avoid OpenAI hard input limits.
  const finalGroups: string[] = [];
  for (const g of merged) {
    if (estimateTokensFromText(g) > MAX_TEXT_TOKENS_EST) {
      finalGroups.push(...chunkTextByApproxTokens(g, MAX_TEXT_TOKENS_EST));
    } else {
      finalGroups.push(g);
    }
  }

  return finalGroups.map((s) => s.trim()).filter(Boolean);
}

export async function generateDocumentSummary(opts: {
  lang: 'fr' | 'en';
  docTitle: string;
  nbPages: string;
  nbWords: string;
  documentText: string;
  streamId: string;
  signal?: AbortSignal;
}): Promise<string> {
  const template = defaultPrompts.find((p) => p.id === 'document_summary')?.content || '';
  if (!template) throw new Error('Prompt document_summary non trouvé');

  const userPrompt = template
    .replace('{{lang}}', opts.lang)
    .replace('{{doc_title}}', opts.docTitle)
    .replace('{{nb_pages}}', opts.nbPages)
    .replace('{{nb_mots}}', opts.nbWords)
    .replace('{{document_text}}', opts.documentText);

  const { content } = await executeWithToolsStream(userPrompt, {
    model: FORCED_DOCUMENT_MODEL,
    streamId: opts.streamId,
    promptId: 'document_summary',
    signal: opts.signal,
  });

  const summary = sanitizePgText(content).trim();
  if (!summary) throw new Error('Résumé vide');
  return summary;
}

export async function generateDocumentDetailedSummary(opts: {
  text: string;
  filename: string;
  lang: 'fr' | 'en';
  streamId: string;
  signal?: AbortSignal;
}): Promise<{ detailedSummary: string; words: number; clipped: boolean }> {
  const targetWords = DETAILED_TARGET_WORDS;
  const fullText = (opts.text || '').trim();
  if (!fullText) throw new Error('Aucun texte à résumer (détaillé)');

  const template = defaultPrompts.find((p) => p.id === 'document_detailed_summary')?.content || '';
  if (!template) throw new Error('Prompt document_detailed_summary non trouvé');

  // Build adaptive source sections (min 5000 source-words per section, unless token budget forces smaller).
  const sections = buildHeadingBasedSourceGroups(fullText);
  if (sections.length === 0) throw new Error('Aucun contenu exploitable pour le résumé détaillé');

  // Output budgeting:
  // - Target: ~10k total output words.
  // - Groups: typically 5..10, but can be lower if doc too short to keep >=5000 source-words per group.
  // - We accept exceeding 10k words; we only trim if >30k (hard cap).
  const sectionCount = Math.max(1, sections.length);
  const perSectionTargetWords = Math.max(300, Math.ceil(targetWords / sectionCount));
  const perSectionMinWords = perSectionTargetWords; // strict: ensure totals can reach >=10k
  const perSectionMaxWords = Math.ceil(perSectionTargetWords * 1.3);
  // gpt-4.1-nano can emit large outputs; allow higher caps to avoid premature truncation.
  const perSectionMaxTokens = clamp(perSectionMaxWords * 7, 9000, 32000); // heuristic

  const summaries: string[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    const sectionText = sections[i]!;
    // Some models sometimes under-shoot "min_words". Enforce via bounded continuation calls.
    const maxContinuationPasses = 3;
    let acc = '';
    let accWords = 0;

    for (let pass = 1; pass <= maxContinuationPasses && accWords < perSectionMinWords; pass += 1) {
      const remaining = Math.max(200, perSectionMinWords - accWords);
      const localMaxWords = Math.max(perSectionMaxWords, remaining + 800);
      const localMinWords = remaining;

      const scope =
        sections.length === 1
          ? pass === 1
            ? 'texte intégral'
            : `texte intégral — suite ${pass}/${maxContinuationPasses}`
          : pass === 1
            ? `section ${i + 1}/${sections.length}`
            : `section ${i + 1}/${sections.length} — suite ${pass}/${maxContinuationPasses}`;

      const continuationContext =
        pass === 1
          ? ''
          : `Résumé déjà produit (ne pas répéter, uniquement continuer):\n<already_written>\n${acc}\n</already_written>`;
      const continuationInstructions =
        pass === 1
          ? ''
          : `- Continuer le résumé sans répéter ce qui est déjà écrit.\n- Ajouter du contenu nouveau et fidèle au TEXTE.\n- Écrire au moins ${localMinWords} mots supplémentaires.`;

      const prompt = buildDetailedSummaryPrompt({
        template,
        filename: opts.filename,
        lang: opts.lang,
        sourceLabel: sections.length === 1 ? 'texte intégral extrait' : 'extrait du document',
        scope,
        documentText: sectionText,
        maxWords: localMaxWords,
        minWords: localMinWords,
        continuationContext,
        continuationInstructions,
      });

      const resp = await callOpenAI({
        messages: [{ role: 'user', content: prompt }],
        model: DETAILED_DOCUMENT_MODEL,
        maxOutputTokens: perSectionMaxTokens,
        signal: opts.signal,
      });

      const part = sanitizePgText(String(resp.choices?.[0]?.message?.content ?? '')).trim();
      if (!part) break;
      acc = acc ? `${acc}\n\n${part}` : part;
      accWords = countWords(acc);
    }

    summaries.push(acc.trim());
  }

  const concatenated = summaries.map((s, i) => `### Section ${i + 1}/${summaries.length}\n${s}`).join('\n\n').trim();
  const total = countWords(concatenated);
  if (total > DETAILED_HARD_TRIM_WORDS) {
    const trimmed = trimToMaxWords(concatenated, DETAILED_HARD_TRIM_WORDS);
    return { detailedSummary: trimmed.text, words: trimmed.words, clipped: trimmed.trimmed };
  }
  return { detailedSummary: concatenated, words: total, clipped: false };
}

export function getDocumentDetailedSummaryPolicy() {
  return {
    model: DETAILED_DOCUMENT_MODEL,
    wordsFullContentLimit: WORDS_FULL_CONTENT_LIMIT,
    detailedSummaryTargetWords: DETAILED_TARGET_WORDS,
    detailedSummaryMinWords: DETAILED_MIN_WORDS,
    detailedSummaryHardTrimWords: DETAILED_HARD_TRIM_WORDS,
  };
}


