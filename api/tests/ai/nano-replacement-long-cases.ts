import { toolService } from '../../src/services/tool-service';
import type { NanoCandidate } from '../utils/nano-qualification-budget';
import { LONG_FACTS, LONG_QUESTIONS, makeLongFixture, type NanoCase } from './nano-replacement-fixtures';
import type { NanoCaseResult } from './nano-replacement-short-cases';
import { sha256 } from './nano-replacement-runtime';

export const runNanoLongCase = async (fixture: Extract<NanoCase, { kind: 'history_document' }>, model: NanoCandidate,
  signal: AbortSignal): Promise<NanoCaseResult> => {
  const text = makeLongFixture(fixture.estimatedTokens);
  const document = fixture.surface === 'document';
  const result = await (toolService as any).runChunkedPromptAnalysis({
    model, text, instruction: LONG_QUESTIONS, maxWords: 500, perChunkMaxWords: document ? 1500 : 900,
    singlePassTokenLimit: fixture.singlePassLimit, chunkTargetTokens: fixture.chunkTarget,
    analysisPromptId: document ? 'documents_analyze' : 'history_analyze',
    mergePromptId: document ? 'documents_analyze_merge' : 'history_analyze_merge',
    templateVars: document ? { lang: 'français', filename: 'synthetic-archive.txt', pages: '200', title: 'Synthetic qualification record',
      full_words: String(text.trim().split(/\s+/).length), est_tokens: String(fixture.estimatedTokens) }
      : { lang: 'français', session_id: 'synthetic-session', total_turns: '40' },
    textVarName: document ? 'document_text' : 'history_text', scopeVarName: 'scope',
    instructionVarName: document ? 'instruction' : 'question', notesVarName: 'notes', signal,
  });
  const flat = String(result.analysis).replace(/[\s,]/g, '');
  const forcedChunk = fixture.singlePassLimit === 1;
  return { output: { ...result, inputCharacters: text.length, estimatedInputTokens: fixture.estimatedTokens,
    forcedChunk, productionSinglePassLimit: document ? 700_000 : 240_000 }, fixtureSha256: sha256(text + LONG_QUESTIONS), checks: {
      nonempty: result.analysis.trim().length > 0,
      ...Object.fromEntries(LONG_FACTS.map((fact) => [`answers:${fact}`, flat.includes(fact)])),
      unknownNotInvented: /NOT[_ ]STATED|not (stated|specified)|(?:non|pas) (précisé|mentionné)|aucun.{0,30}signataire/i.test(result.analysis),
      expectedPath: result.chunked === forcedChunk && result.chunkCount === 1,
      notClipped: result.clipped === false,
    } };
};
