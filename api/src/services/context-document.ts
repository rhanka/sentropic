import { defaultPrompts } from '../config/default-prompts';
import { executeWithToolsStream } from './tools';
import { callOpenAIResponseStream } from './openai';
import { getNextSequence, writeStreamEvent } from './stream-service';
import type { StreamEventType } from './openai';

const FORCED_DOCUMENT_MODEL = 'gpt-5-nano';
const WORDS_FULL_CONTENT_LIMIT = 10_000;
const DETAILED_SUMMARY_TARGET_WORDS = 15_000;
const DETAILED_SUMMARY_MIN_WORDS = 4_000;
const DOCUMENT_MAX_INPUT_TOKENS_EST = 272_000;

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

function splitByTopLevelHeading(text: string): string[] {
  // Prefer splitting on Markdown top-level headings (# ...), if present.
  const t = (text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  const lines = t.split('\n');
  const out: string[] = [];
  let cur: string[] = [];
  const headingRe = /^#\s+\S+/;
  for (const line of lines) {
    if (headingRe.test(line) && cur.length > 0) {
      out.push(cur.join('\n').trim());
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length > 0) out.push(cur.join('\n').trim());
  // If we didn't really split, return empty to signal "not applicable".
  if (out.length <= 1) return [];
  return out.filter(Boolean);
}

function packSectionsToTokenBudget(sections: string[], maxTokensEst: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  let curTokens = 0;
  const max = Math.max(10_000, Math.floor(maxTokensEst || DOCUMENT_MAX_INPUT_TOKENS_EST));

  const flush = () => {
    const t = cur.trim();
    if (t) chunks.push(t);
    cur = '';
    curTokens = 0;
  };

  for (const sec of sections) {
    const s = (sec || '').trim();
    if (!s) continue;
    const t = estimateTokensFromText(s);
    if (t > max) {
      // Single section too large: flush current and split this section by token chunks.
      flush();
      const sub = chunkTextByApproxTokens(s, max);
      for (const c of sub) chunks.push(c.trim());
      continue;
    }
    if (!cur) {
      cur = s;
      curTokens = t;
      continue;
    }
    if (curTokens + t <= max) {
      cur = `${cur}\n\n${s}`;
      curTokens += t;
      continue;
    }
    flush();
    cur = s;
    curTokens = t;
  }
  flush();
  return chunks.filter(Boolean);
}

function buildDetailedSummaryPrompt(opts: {
  template: string;
  filename: string;
  lang: 'fr' | 'en';
  sourceLabel: string;
  scope: string;
  documentText: string;
  targetWords: number;
}): string {
  return opts.template
    .replace('{{filename}}', opts.filename)
    .replace('{{source_label}}', opts.sourceLabel)
    .replace('{{scope}}', opts.scope)
    .replace('{{document_text}}', opts.documentText)
    .replace('{{max_words}}', String(opts.targetWords))
    .replace('{{lang}}', opts.lang === 'fr' ? 'français' : 'anglais');
}

async function runResponsesContinuation(opts: {
  model: string;
  userPrompt: string;
  maxOutputTokens: number;
  previousResponseId?: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  signal?: AbortSignal;
  onStreamEvent?: (eventType: StreamEventType, data: unknown) => Promise<void> | void;
}): Promise<{ text: string; responseId: string }> {
  let text = '';
  let responseId = opts.previousResponseId || '';

  for await (const event of callOpenAIResponseStream({
    messages: [{ role: 'user', content: opts.userPrompt }],
    model: opts.model,
    maxOutputTokens: opts.maxOutputTokens,
    previousResponseId: opts.previousResponseId,
    reasoningEffort: opts.reasoningEffort,
    reasoningSummary: opts.reasoningSummary,
    signal: opts.signal,
  })) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.type === 'status') {
      if (data.state === 'response_created' && typeof data.response_id === 'string' && data.response_id) {
        responseId = data.response_id;
      }
      await opts.onStreamEvent?.('status', data);
      continue;
    }
    if (event.type === 'content_delta') {
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (delta) text += delta;
      await opts.onStreamEvent?.('content_delta', { delta });
      continue;
    }
    if (event.type === 'error') {
      const msg = typeof data.message === 'string' ? data.message : 'Erreur OpenAI';
      await opts.onStreamEvent?.('error', { message: msg });
      throw new Error(msg);
    }
  }

  return { text, responseId };
}

export async function generateDocumentSummary(opts: {
  lang: 'fr' | 'en';
  docTitle: string;
  nbPages: string;
  fullWords: string;
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
    .replace('{{full_words}}', opts.fullWords)
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
  const write = async (eventType: StreamEventType, payload: unknown) => {
    const seq = await getNextSequence(opts.streamId);
    await writeStreamEvent(opts.streamId, eventType, payload, seq);
  };

  const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

  const targetWords = DETAILED_SUMMARY_TARGET_WORDS;
  const fullText = (opts.text || '').trim();
  if (!fullText) throw new Error('Aucun texte à résumer (détaillé)');

  const template = defaultPrompts.find((p) => p.id === 'document_detailed_summary')?.content || '';
  if (!template) throw new Error('Prompt document_detailed_summary non trouvé');

  const estTokens = estimateTokensFromText(fullText);

  // 1-shot policy: no continuation, no expansion. If input fits, do a single generation.
  if (estTokens > 0 && estTokens <= DOCUMENT_MAX_INPUT_TOKENS_EST) {
    const prompt = buildDetailedSummaryPrompt({
      template,
      filename: opts.filename,
      lang: opts.lang,
      sourceLabel: 'texte intégral extrait',
      scope: `texte intégral (~${estTokens} tokens estimés)`,
      documentText: fullText,
      targetWords,
    });

    await write('status', { state: 'summarizing_detailed_one_shot_start', estTokens });
    const r = await runResponsesContinuation({
      model: FORCED_DOCUMENT_MODEL,
      userPrompt: prompt,
      maxOutputTokens: 32000,
      reasoningEffort: 'low',
      reasoningSummary: 'concise',
      signal: opts.signal,
      onStreamEvent: async (eventType, data) => {
        await write(eventType, { ...asRecord(data), phase: 'one_shot' });
      },
    });
    const out = sanitizePgText(r.text).trim();
    // The detailed summary can be longer than WORDS_FULL_CONTENT_LIMIT; use the target as a soft cap.
    const trimmed = trimToMaxWords(out, targetWords);
    await write('status', { state: 'summarizing_detailed_one_shot_end', words: trimmed.words, clipped: trimmed.trimmed });
    if (trimmed.words < DETAILED_SUMMARY_MIN_WORDS) {
      await write('status', { state: 'summarizing_detailed_failed', words: trimmed.words, minWords: DETAILED_SUMMARY_MIN_WORDS });
      throw new Error(`Résumé détaillé insuffisant: ${trimmed.words} mots (min ${DETAILED_SUMMARY_MIN_WORDS}).`);
    }
    return { detailedSummary: trimmed.text, words: trimmed.words, clipped: trimmed.trimmed };
  }

  // Input too large: split (prefer top-level headings when possible), then 1-shot per chunk and concatenate.
  const sections = splitByTopLevelHeading(fullText);
  const chunks =
    sections.length > 0 ? packSectionsToTokenBudget(sections, DOCUMENT_MAX_INPUT_TOKENS_EST) : chunkTextByApproxTokens(fullText, DOCUMENT_MAX_INPUT_TOKENS_EST);

  const chunkSummaries: string[] = [];
  // Policy for split:
  // - Ask ~10k words per chunk (maxWords=10k) to maximize chance of reaching the global target.
  // - Validate with a dynamic per-chunk minimum: global_min / nbChunks (rounded up).
  const perChunkMinWords = Math.max(800, Math.ceil(DETAILED_SUMMARY_MIN_WORDS / Math.max(1, chunks.length)));
  for (let i = 0; i < chunks.length; i += 1) {
    const chunkText = chunks[i]!;
    const chunkTokens = estimateTokensFromText(chunkText);
    const chunkPrompt = buildDetailedSummaryPrompt({
      template,
      filename: opts.filename,
      lang: opts.lang,
      sourceLabel: 'extrait du document',
      scope: `extrait ${i + 1}/${chunks.length} (~${chunkTokens} tokens estimés)`,
      documentText: chunkText,
      targetWords,
    });

    await write('status', { state: 'summarizing_detailed_chunk_start', chunkIndex: i + 1, chunkTotal: chunks.length });
    const r = await runResponsesContinuation({
      model: FORCED_DOCUMENT_MODEL,
      userPrompt: chunkPrompt,
      maxOutputTokens: 32000,
      reasoningEffort: 'low',
      reasoningSummary: 'concise',
      signal: opts.signal,
      onStreamEvent: async (eventType, data) => {
        await write(eventType, {
          ...asRecord(data),
          chunkIndex: i + 1,
          chunkTotal: chunks.length,
        });
      },
    });
    const chunkOut = sanitizePgText(String(r.text ?? '')).trim();
    const chunkTrimmed = trimToMaxWords(chunkOut, targetWords);
    await write('status', { state: 'summarizing_detailed_chunk_end', chunkIndex: i + 1, chunkTotal: chunks.length, words: chunkTrimmed.words });
    if (chunkTrimmed.words < perChunkMinWords) {
      await write('status', { state: 'summarizing_detailed_failed', chunkIndex: i + 1, words: chunkTrimmed.words, minWords: perChunkMinWords });
      throw new Error(
        `Résumé détaillé insuffisant (chunk ${i + 1}/${chunks.length}): ${chunkTrimmed.words} mots (min ${perChunkMinWords}).`
      );
    }
    chunkSummaries.push(chunkTrimmed.text);
  }

  const concatenated = chunkSummaries
    .map((s, i) => `### Partie ${i + 1}/${chunkSummaries.length}\n${s}`)
    .join('\n\n')
    .trim();

  // Allow accumulating ~10k words per chunk; compute words without clamping to 10k.
  const maxAccumulatedWords = Math.max(WORDS_FULL_CONTENT_LIMIT, WORDS_FULL_CONTENT_LIMIT * Math.max(1, chunkSummaries.length));
  const trimmed = trimToMaxWords(concatenated, maxAccumulatedWords);
  await write('status', { state: 'summarizing_detailed_concat', words: trimmed.words, clipped: trimmed.trimmed, chunkTotal: chunkSummaries.length });
  if (trimmed.words < DETAILED_SUMMARY_MIN_WORDS) {
    await write('status', { state: 'summarizing_detailed_failed', words: trimmed.words, minWords: DETAILED_SUMMARY_MIN_WORDS, chunkTotal: chunkSummaries.length });
    throw new Error(`Résumé détaillé insuffisant: ${trimmed.words} mots (min ${DETAILED_SUMMARY_MIN_WORDS}).`);
  }
  return { detailedSummary: trimmed.text, words: trimmed.words, clipped: trimmed.trimmed };
}

export function getDocumentDetailedSummaryPolicy() {
  return {
    model: FORCED_DOCUMENT_MODEL,
    wordsFullContentLimit: WORDS_FULL_CONTENT_LIMIT,
    detailedSummaryMinWords: DETAILED_SUMMARY_MIN_WORDS,
  };
}


