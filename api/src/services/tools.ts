import { env } from '../config/env';
import fetch from "node-fetch";
import { callOpenAI } from './openai';
import type OpenAI from 'openai';

// Fonction pour Tavily Search
const TAVILY_API_KEY = env.TAVILY_API_KEY;

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
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
  } as any);
  
  const data = await resp.json() as any;
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
  } as any);

  const data = await resp.json() as any;

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
  const webSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
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

  const webExtractTool: OpenAI.Chat.Completions.ChatCompletionTool = {
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

  // Premier appel pour déclencher la recherche et/ou l'extraction
  const response = await callOpenAI({
    messages: [
      {
        role: "system",
        content: "Tu es un assistant qui utilise la recherche web et l'extraction de contenu pour fournir des informations récentes et précises. Utilise l'outil de recherche web pour trouver des informations, puis l'outil d'extraction pour obtenir le contenu détaillé des URLs pertinentes."
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
    const allSearchResults: any[] = [];
    const allExtractResults: any[] = [];

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
    resultsMessage += 'Réponds à la question originale en utilisant ces informations récentes.';

    // Deuxième appel avec les résultats de recherche et d'extraction
    const followUpResponse = await callOpenAI({
      messages: [
        {
          role: "system",
          content: "Tu es un assistant qui fournit des réponses basées sur les résultats de recherche web et les contenus extraits d'URLs."
        },
        {
          role: "user",
          content: prompt
        },
        {
          role: "assistant",
          content: "Je vais rechercher et extraire des informations récentes pour vous."
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
