import { env } from '../config/env';
import fetch from "node-fetch";
import { callOpenAI, callOpenAIResponseStream } from './openai';
import type OpenAI from 'openai';
import { generateStreamId, getNextSequence, writeStreamEvent } from './stream-service';

// Fonction pour Tavily Search
const TAVILY_API_KEY = env.TAVILY_API_KEY;

// Prompts d'orchestration web tools (DOIVENT rester identiques entre non-streaming et streaming)
const WEB_TOOLS_SYSTEM_PROMPT =
  "Tu es un assistant qui utilise la recherche web et l'extraction de contenu pour fournir des informations récentes et précises. Utilise l'outil de recherche web pour trouver des informations, puis l'outil d'extraction pour obtenir le contenu détaillé des URLs pertinentes.";

const WEB_TOOLS_FOLLOWUP_SYSTEM_PROMPT =
  "Tu es un assistant qui fournit des réponses basées sur les résultats de recherche web et les contenus extraits d'URLs.";

const WEB_TOOLS_FOLLOWUP_ASSISTANT_PROMPT =
  "Je vais rechercher et extraire des informations récentes pour vous.";

const WEB_TOOLS_RESULTS_SUFFIX =
  "Réponds à la question originale en utilisant ces informations récentes.";

// Tools (définition unique)
export const webSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Tavily Search API for real-time web search. Use this tool to search for current information on the web.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant information"
        }
      },
      required: ["query"]
    }
  }
};

export const webExtractTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_extract",
    description: "Extract and retrieve the full content of one or more web page URLs. Use this tool to get detailed content from URLs found during web search or provided directly. You can extract multiple URLs in a single call for efficiency.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Array of URLs to extract content from. Can be a single URL or multiple URLs."
        }
      },
      required: ["urls"]
    }
  }
};

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilySearchResponse {
  results?: SearchResult[];
}

interface TavilyExtractResponse {
  markdown?: string;
  content?: string;
}

export const searchWeb = async (query: string, signal?: AbortSignal): Promise<SearchResult[]> => {
  console.log(`🔍 Tavily search called with query: "${query}"`);
  if (signal?.aborted) {
    throw new Error('AbortError');
  }
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query,
      max_results: 10
    }),
    signal
  });
  
  const data = (await resp.json()) as TavilySearchResponse;
  console.log(`✅ Tavily returned ${data.results?.length || 0} results`);
  return data.results || [];
}; 

export interface ExtractResult {
  url: string;
  content: string;   // markdown
}

export const extractUrlContent = async (
  url: string,
  signal?: AbortSignal
): Promise<ExtractResult> => {
  console.log(`🔍 Tavily extract called with query: "${url}"`);

  if (signal?.aborted) throw new Error("AbortError");

  const resp = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      url,
      format: "markdown",      // "markdown" | "text"
      extract_depth: "advanced" // "basic" | "advanced"
    }),
    signal
  });

  const data = (await resp.json()) as TavilyExtractResponse;

  return {
    url,
    content: data.markdown ?? data.content ?? ""
  };
};


export interface ExecuteWithToolsOptions {
  model?: string;
  useWebSearch?: boolean;
  responseFormat?: 'json_object';
  signal?: AbortSignal;
}

export interface ExecuteWithToolsStreamOptions extends ExecuteWithToolsOptions {
  /**
   * ID du stream à utiliser (si non fourni, généré à partir des champs ci-dessous).
   */
  streamId?: string;
  promptId?: string;
  jobId?: string;
  messageId?: string;
  /**
   * Résumé de reasoning (Responses API). Default: auto
   */
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
}

export interface ExecuteWithToolsStreamResult {
  streamId: string;
  content: string;
}

/**
 * Orchestrateur pour exécuter des prompts avec ou sans outils
 */
export const executeWithTools = async (
  prompt: string, 
  options: ExecuteWithToolsOptions = {}
): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
  const { model = 'gpt-4.1-nano', useWebSearch = false, responseFormat, signal } = options;

  console.log(`🤖 Using model: ${model}${useWebSearch ? ' with web search' : ''}`);

  if (!useWebSearch) {
    // Appel simple sans outils
    return await callOpenAI({
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      model,
      responseFormat,
      signal
    });
  }

  // Appel avec recherche web et extraction d'URL
  // Premier appel pour déclencher la recherche et/ou l'extraction
  const response = await callOpenAI({
    messages: [
      {
        role: "system",
        content: WEB_TOOLS_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: prompt
      }
    ],
    model,
    tools: [webSearchTool, webExtractTool],
    toolChoice: "required",
    responseFormat,
    signal
  });

  const message = response.choices[0]?.message;

  if (message?.tool_calls) {
    // Note: allSearchResults stocke les résultats de recherche avec leur query associée
    // Ce n'est pas le type SearchResult[], mais un tableau d'objets contenant query et results
    const allSearchResults: Array<{ query: string; results: SearchResult[] }> = [];
    const allExtractResults: ExtractResult[] = [];

    // Exécuter toutes les recherches et extractions demandées
    for (const toolCall of message.tool_calls) {
      if (signal?.aborted) {
        throw new Error('AbortError');
      }
      if (toolCall.type === 'function') {
        if (toolCall.function.name === 'web_search') {
          const args = JSON.parse(toolCall.function.arguments);
          const searchResults = await searchWeb(args.query, signal);
          allSearchResults.push({
            query: args.query,
            results: searchResults
          });
        } else if (toolCall.function.name === 'web_extract') {
          const args = JSON.parse(toolCall.function.arguments);
          const urls = Array.isArray(args.urls) ? args.urls : [args.url || args.urls];
          // Extraire toutes les URLs en parallèle
          const extractPromises = urls.map((url: string) => extractUrlContent(url, signal));
          const extractResults = await Promise.all(extractPromises);
          allExtractResults.push(...extractResults);
        }
      }
    }

    // Construire le message avec les résultats
    let resultsMessage = '';
    if (allSearchResults.length > 0) {
      resultsMessage += `Voici les résultats de recherche web:\n${JSON.stringify(allSearchResults, null, 2)}\n\n`;
    }
    if (allExtractResults.length > 0) {
      resultsMessage += `Voici les contenus extraits des URLs:\n${JSON.stringify(allExtractResults, null, 2)}\n\n`;
    }
    resultsMessage += WEB_TOOLS_RESULTS_SUFFIX;

    // Deuxième appel avec les résultats de recherche et d'extraction
    const followUpResponse = await callOpenAI({
      messages: [
        {
          role: "system",
          content: WEB_TOOLS_FOLLOWUP_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: prompt
        },
        {
          role: "assistant",
          content: WEB_TOOLS_FOLLOWUP_ASSISTANT_PROMPT
        },
        {
          role: "user",
          content: resultsMessage
        }
      ],
      model,
      responseFormat,
      signal
    });

    return followUpResponse;
  }

  return response;
};

/**
 * Orchestrateur streaming équivalent à executeWithTools
 * - Réutilise EXACTEMENT les mêmes prompts d'orchestration que la version non-streaming.
 * - Écrit les événements dans chat_stream_events via stream-service.
 */
export const executeWithToolsStream = async (
  prompt: string,
  options: ExecuteWithToolsStreamOptions = {}
): Promise<ExecuteWithToolsStreamResult> => {
  const {
    model = 'gpt-4.1-nano',
    useWebSearch = false,
    responseFormat,
    reasoningSummary,
    streamId,
    promptId,
    jobId,
    messageId,
    signal
  } = options;

  const finalStreamId = streamId || generateStreamId(promptId, jobId, messageId);

  // Helper: écrire un StreamEvent normalisé
  const write = async (eventType: StreamEventType, data: unknown) => {
    const seq = await getNextSequence(finalStreamId);
    await writeStreamEvent(finalStreamId, eventType, data, seq);
  };

  let accumulatedContent = '';

  if (!useWebSearch) {
    for await (const event of callOpenAIResponseStream({
      messages: [{ role: 'user', content: prompt }],
      model,
      responseFormat,
      reasoningSummary,
      signal
    })) {
      await write(event.type, event.data || {});
      if (event.type === 'content_delta') accumulatedContent += (event.data?.delta || '');
      if (event.type === 'error') throw new Error(event.data?.message || 'Erreur lors du streaming');
    }
    return { streamId: finalStreamId, content: accumulatedContent };
  }

  // 1er appel (streaming) pour déclencher tools
  const toolCalls: Array<{ id: string; name: string; args: string }> = [];

  for await (const event of callOpenAIResponseStream({
    messages: [
      { role: 'system', content: WEB_TOOLS_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    model,
    tools: [webSearchTool, webExtractTool],
    responseFormat,
    reasoningSummary,
    signal
  })) {
    await write(event.type, event.data || {});

    if (event.type === 'content_delta') accumulatedContent += (event.data?.delta || '');

    if (event.type === 'tool_call_start') {
      const toolCallId = event.data?.tool_call_id || '';
      const existingIndex = toolCalls.findIndex(tc => tc.id === toolCallId);
      if (existingIndex === -1) {
        toolCalls.push({
          id: toolCallId,
          name: event.data?.name || '',
          args: event.data?.args || ''
        });
      } else {
        toolCalls[existingIndex].name = event.data?.name || toolCalls[existingIndex].name;
        toolCalls[existingIndex].args = (toolCalls[existingIndex].args || '') + (event.data?.args || '');
      }
    } else if (event.type === 'tool_call_delta') {
      const toolCallId = event.data?.tool_call_id || '';
      const delta = event.data?.delta || '';
      const toolCall = toolCalls.find(tc => tc.id === toolCallId);
      if (toolCall) {
        toolCall.args += delta;
      } else {
        toolCalls.push({ id: toolCallId, name: '', args: delta });
      }
    }

    if (event.type === 'error') throw new Error(event.data?.message || 'Erreur lors du streaming');
  }

  // Si aucun tool call: le contenu est déjà complet
  if (toolCalls.length === 0) {
    return { streamId: finalStreamId, content: accumulatedContent };
  }

  // Exécuter les tools (hors OpenAI) + streamer les résultats via tool_call_result
  const allSearchResults: Array<{ query: string; results: SearchResult[] }> = [];
  const allExtractResults: ExtractResult[] = [];

  for (const toolCall of toolCalls) {
    if (signal?.aborted) throw new Error('AbortError');
    try {
      const args = JSON.parse(toolCall.args || '{}');
      if (toolCall.name === 'web_search') {
        await write('tool_call_result', { tool_call_id: toolCall.id, result: { status: 'executing' } });
        const searchResults = await searchWeb(args.query, signal);
        allSearchResults.push({ query: args.query, results: searchResults });
        await write('tool_call_result', { tool_call_id: toolCall.id, result: { status: 'completed', results: searchResults } });
      } else if (toolCall.name === 'web_extract') {
        await write('tool_call_result', { tool_call_id: toolCall.id, result: { status: 'executing' } });
        const urls = Array.isArray(args.urls) ? args.urls : [args.url || args.urls].filter(Boolean);
        const extractPromises = urls.map((url: string) => extractUrlContent(url, signal));
        const extractResults = await Promise.all(extractPromises);
        allExtractResults.push(...extractResults);
        await write('tool_call_result', { tool_call_id: toolCall.id, result: { status: 'completed', results: extractResults } });
      }
    } catch (error) {
      await write('tool_call_result', {
        tool_call_id: toolCall.id,
        result: { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  // Construire resultsMessage (identique à executeWithTools)
  let resultsMessage = '';
  if (allSearchResults.length > 0) {
    resultsMessage += `Voici les résultats de recherche web:\n${JSON.stringify(allSearchResults, null, 2)}\n\n`;
  }
  if (allExtractResults.length > 0) {
    resultsMessage += `Voici les contenus extraits des URLs:\n${JSON.stringify(allExtractResults, null, 2)}\n\n`;
  }
  resultsMessage += WEB_TOOLS_RESULTS_SUFFIX;

  // 2e appel (streaming) avec les résultats — identique à executeWithTools
  accumulatedContent = '';
  for await (const event of callOpenAIResponseStream({
    messages: [
      { role: 'system', content: WEB_TOOLS_FOLLOWUP_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
      { role: 'assistant', content: WEB_TOOLS_FOLLOWUP_ASSISTANT_PROMPT },
      { role: 'user', content: resultsMessage }
    ],
    model,
    responseFormat,
    reasoningSummary,
    signal
  })) {
    await write(event.type, event.data || {});
    if (event.type === 'content_delta') accumulatedContent += (event.data?.delta || '');
    if (event.type === 'error') throw new Error(event.data?.message || 'Erreur lors du streaming');
  }

  return { streamId: finalStreamId, content: accumulatedContent };
};
