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
      max_results: 5
    }),
    signal
  } as any);
  
  const data = await resp.json() as any;
  return data.results || [];
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

  // Appel avec recherche web
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

  // Premier appel pour déclencher la recherche
  const response = await callOpenAI({
    messages: [
      {
        role: "system",
        content: "Tu es un assistant qui utilise la recherche web pour fournir des informations récentes et précises. Utilise toujours l'outil de recherche web pour répondre aux questions."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    model,
    tools: [webSearchTool],
    toolChoice: "required",
    responseFormat,
    signal
  });

  const message = response.choices[0]?.message;

  if (message?.tool_calls) {
    let allSearchResults: any[] = [];

    // Exécuter toutes les recherches demandées
    for (const toolCall of message.tool_calls) {
      if (signal?.aborted) {
        throw new Error('AbortError');
      }
      if (toolCall.type === 'function' && toolCall.function.name === 'web_search') {
        const args = JSON.parse(toolCall.function.arguments);
        const searchResults = await searchWeb(args.query, signal);
        allSearchResults.push({
          query: args.query,
          results: searchResults
        });
      }
    }

    // Deuxième appel avec les résultats de recherche
    const followUpResponse = await callOpenAI({
      messages: [
        {
          role: "system",
          content: "Tu es un assistant qui fournit des réponses basées sur les résultats de recherche web."
        },
        {
          role: "user",
          content: prompt
        },
        {
          role: "assistant",
          content: "Je vais rechercher des informations récentes pour vous."
        },
        {
          role: "user",
          content: `Voici les résultats de recherche web:\n${JSON.stringify(allSearchResults, null, 2)}\n\nRéponds à la question originale en utilisant ces informations récentes.`
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
