import { defaultPrompts } from '../config/default-prompts';
import { executeWithToolsStream } from './tools';
import { callOpenAI } from './openai';
import { callOpenAIResponseStream } from './openai';

const FORCED_DOCUMENT_MODEL = 'gpt-4.1-nano';
const WORDS_FULL_CONTENT_LIMIT = 10_000;
const DETAILED_SUMMARY_MIN_WORDS = 8_000;

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
  // IMPORTANT: do not clamp to WORDS_FULL_CONTENT_LIMIT here.
  // Some flows (very large docs) intentionally allow accumulating >10k words across chunks.
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

function buildDetailedSummaryPrompt(opts: {
  template: string;
  filename: string;
  lang: 'fr' | 'en';
  sourceLabel: string;
  scope: string;
  documentText: string;
  maxWords: number;
  minWords: number;
}): string {
  return opts.template
    .replace('{{filename}}', opts.filename)
    .replace('{{source_label}}', opts.sourceLabel)
    .replace('{{scope}}', opts.scope)
    .replace('{{document_text}}', opts.documentText)
    .replace('{{max_words}}', String(opts.maxWords))
    .replace('{{min_words}}', String(opts.minWords))
    .replace('{{lang}}', opts.lang === 'fr' ? 'français' : 'anglais');
}

function buildDetailedSummaryExpandPrompt(opts: {
  template: string;
  filename: string;
  lang: 'fr' | 'en';
  sourceLabel: string;
  scope: string;
  documentText: string;
  maxWords: number;
  minWords: number;
  currentWords: number;
  currentSummary: string;
}): string {
  return opts.template
    .replace('{{filename}}', opts.filename)
    .replace('{{source_label}}', opts.sourceLabel)
    .replace('{{scope}}', opts.scope)
    .replace('{{document_text}}', opts.documentText)
    .replace('{{max_words}}', String(opts.maxWords))
    .replace('{{min_words}}', String(opts.minWords))
    .replace('{{current_words}}', String(opts.currentWords))
    .replace('{{current_summary}}', opts.currentSummary)
    .replace('{{lang}}', opts.lang === 'fr' ? 'français' : 'anglais');
}

async function runResponsesContinuation(opts: {
  model: string;
  userPrompt: string;
  maxOutputTokens: number;
  previousResponseId?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; responseId: string }> {
  let text = '';
  let responseId = opts.previousResponseId || '';

  for await (const event of callOpenAIResponseStream({
    messages: [{ role: 'user', content: opts.userPrompt }],
    model: opts.model,
    maxOutputTokens: opts.maxOutputTokens,
    previousResponseId: opts.previousResponseId,
    signal: opts.signal,
  })) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.type === 'status') {
      if (data.state === 'response_created' && typeof data.response_id === 'string' && data.response_id) {
        responseId = data.response_id;
      }
      continue;
    }
    if (event.type === 'content_delta') {
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (delta) text += delta;
      continue;
    }
    if (event.type === 'error') {
      const msg = typeof data.message === 'string' ? data.message : 'Erreur OpenAI';
      throw new Error(msg);
    }
  }

  return { text, responseId };
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
  const maxWords = WORDS_FULL_CONTENT_LIMIT;
  const minWords = Math.floor(maxWords * 0.8);
  const fullText = (opts.text || '').trim();
  if (!fullText) throw new Error('Aucun texte à résumer (détaillé)');

  const template = defaultPrompts.find((p) => p.id === 'document_detailed_summary')?.content || '';
  if (!template) throw new Error('Prompt document_detailed_summary non trouvé');
  const expandTemplate = defaultPrompts.find((p) => p.id === 'document_detailed_summary_expand')?.content || '';
  if (!expandTemplate) throw new Error('Prompt document_detailed_summary_expand non trouvé');
  const continueTemplate = defaultPrompts.find((p) => p.id === 'document_detailed_summary_continue')?.content || '';
  if (!continueTemplate) throw new Error('Prompt document_detailed_summary_continue non trouvé');

  const estTokens = estimateTokensFromText(fullText);

  // Prefer a direct full-text summary when it fits comfortably in one call.
  if (estTokens > 0 && estTokens <= 700_000) {
    // Strategy: generate in 4 parts using Responses API continuation (previous_response_id).
    // This avoids the model "stopping early" on long single-shot outputs.
    const partTotal = 4;

    const basePrompt = buildDetailedSummaryPrompt({
      template,
      filename: opts.filename,
      lang: opts.lang,
      sourceLabel: 'texte intégral extrait',
      scope: `texte intégral (partie 1/${partTotal})`,
      documentText: fullText,
      maxWords: maxWords,
      minWords: minWords,
    });

    // Part 1 (creates a response_id)
    const partTexts: string[] = [];
    let responseId = '';
    {
      const r1 = await runResponsesContinuation({
        model: FORCED_DOCUMENT_MODEL,
        userPrompt: basePrompt,
        maxOutputTokens: 12000,
        signal: opts.signal,
      });
      responseId = r1.responseId;
      partTexts.push(sanitizePgText(r1.text).trim());
    }

    // Parts 2..4 via continuation (no re-sending the document text)
    for (let partIndex = 2; partIndex <= partTotal; partIndex += 1) {
      const continuePrompt = continueTemplate
        .replace('{{lang}}', opts.lang === 'fr' ? 'français' : 'anglais')
        .replace('{{part_index}}', String(partIndex))
        .replace('{{part_total}}', String(partTotal))
        .replace('{{part_min_words}}', String(minWords))
        .replace('{{part_max_words}}', String(maxWords));

      const r = await runResponsesContinuation({
        model: FORCED_DOCUMENT_MODEL,
        userPrompt: continuePrompt,
        maxOutputTokens: 32000,
        previousResponseId: responseId || undefined,
        signal: opts.signal,
      });
      responseId = r.responseId || responseId;
      partTexts.push(sanitizePgText(r.text).trim());
    }

    const concatenated = partTexts
      .map((t, i) => `### Partie ${i + 1}/${partTotal}\n${t}`.trim())
      .join('\n\n')
      .trim();

    const trimmed = trimToMaxWords(concatenated, maxWords);
    if (trimmed.words >= DETAILED_SUMMARY_MIN_WORDS) {
      return { detailedSummary: trimmed.text, words: trimmed.words, clipped: trimmed.trimmed };
    }

    // If still too short, try a bounded rewrite (expansion) on the full text as a last resort (still no chunking).
    const currentWords = trimmed.words;
    const expandPrompt = buildDetailedSummaryExpandPrompt({
      template: expandTemplate,
      filename: opts.filename,
      lang: opts.lang,
      sourceLabel: 'texte intégral extrait',
      scope: 'texte intégral (réécriture finale)',
      documentText: fullText,
      maxWords,
      minWords,
      currentWords,
      currentSummary: trimmed.text,
    });
    const resp3 = await callOpenAI({
      messages: [{ role: 'user', content: expandPrompt }],
      model: FORCED_DOCUMENT_MODEL,
      maxOutputTokens: 32000,
      signal: opts.signal,
    });
    const raw3 = sanitizePgText(String(resp3.choices?.[0]?.message?.content ?? '')).trim();
    const trimmed3 = trimToMaxWords(raw3, maxWords);
    if (trimmed3.words >= DETAILED_SUMMARY_MIN_WORDS) {
      return { detailedSummary: trimmed3.text, words: trimmed3.words, clipped: trimmed3.trimmed };
    }

    throw new Error(`Résumé détaillé insuffisant: ${trimmed3.words} mots (min ${DETAILED_SUMMARY_MIN_WORDS}).`);
  }

  // Only for very large inputs: scan ALL chunks (no retrieval/RAG), then consolidate deterministically.
  // Policy: chunking is allowed ONLY when the input doesn't fit in one call (>~800k tokens estimated).
  if (!(estTokens > 800_000)) {
    throw new Error(
      `Résumé détaillé insuffisant: entrée estimée à ${estTokens} tokens (≤800k) mais génération trop courte.`
    );
  }

  // For huge docs only: split near the model budget (~800k est tokens).
  const chunks = chunkTextByApproxTokens(fullText, 800_000);
  const chunkSummaries: string[] = [];
  // Policy for huge docs: accumulate ~10k words PER chunk (no division by number of chunks).
  const perChunkMaxWords = WORDS_FULL_CONTENT_LIMIT;
  const perChunkMinWords = DETAILED_SUMMARY_MIN_WORDS;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunkText = chunks[i]!;
    const chunkPrompt = buildDetailedSummaryPrompt({
      template,
      filename: opts.filename,
      lang: opts.lang,
      sourceLabel: 'extrait du document',
      scope: `extrait ${i + 1}/${chunks.length}`,
      documentText: chunkText,
      maxWords: perChunkMaxWords,
      minWords: perChunkMinWords,
    });

    const resp = await callOpenAI({
      messages: [{ role: 'user', content: chunkPrompt }],
      model: FORCED_DOCUMENT_MODEL,
      maxOutputTokens: 32000,
      signal: opts.signal,
    });
    chunkSummaries.push(sanitizePgText(String(resp.choices?.[0]?.message?.content ?? '')).trim());
  }

  const concatenated = chunkSummaries
    .map((s, i) => `### Partie ${i + 1}/${chunkSummaries.length}\n${s}`)
    .join('\n\n')
    .trim();

  // Allow accumulating ~10k words per chunk; compute words without clamping to 10k.
  const maxAccumulatedWords = Math.max(WORDS_FULL_CONTENT_LIMIT, WORDS_FULL_CONTENT_LIMIT * Math.max(1, chunkSummaries.length));
  const trimmed = trimToMaxWords(concatenated, maxAccumulatedWords);
  return { detailedSummary: trimmed.text, words: trimmed.words, clipped: trimmed.trimmed };
}

export function getDocumentDetailedSummaryPolicy() {
  return {
    model: FORCED_DOCUMENT_MODEL,
    wordsFullContentLimit: WORDS_FULL_CONTENT_LIMIT,
    detailedSummaryMinWords: DETAILED_SUMMARY_MIN_WORDS,
  };
}


