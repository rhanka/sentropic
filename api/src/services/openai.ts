import { env } from '../config/env';
import OpenAI from "openai";
import fetch from "node-fetch";

// Initialiser le client OpenAI
const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });

// Fonction pour Tavily Search
const TAVILY_API_KEY = env.TAVILY_API_KEY;

async function webSearch(query: string) {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query,
      max_results: 5
    })
  });
  return resp.json();
}

export type GenerateUseCasesParams = {
  input: string;
  createNewFolder: boolean;
  companyId?: string;
};

export type CompanyEnrichmentParams = {
  companyName: string;
};

export type CompanyEnrichmentResult = {
  normalizedName: string;
  industry: string;
  size: string;
  products: string;
  processes: string;
  challenges: string;
  objectives: string;
  technologies: string;
};

export type GeneratedFolder = {
  name: string;
  description: string;
};

export type GeneratedUseCaseList = {
  titles: string[];
};

export type GeneratedUseCaseDetail = {
  name: string;
  description: string;
  process: string;
  technology: string;
  deadline: string;
  contact: string;
  benefits: string[];
  metrics: string[];
  risks: string[];
  nextSteps: string[];
  sources: string[];
  relatedData: string[];
  valueScores: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
  complexityScores: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
};

const callOpenAI = async (prompt: string, model: string = 'gpt-5', systemMessage: string = 'Tu es un expert en transformation digitale et IA. Fournis des réponses précises et structurées au format JSON demandé.', useWebSearch: boolean = false): Promise<any> => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  try {
    const response = await client.responses.create({
      model: model,
      input: [
        {
          role: 'system',
          content: systemMessage
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      tools: useWebSearch ? [{
        type: "function",
        name: "web_search",
        description: "DuckDuckGo Instant Answer (no API key)",
        parameters: { 
          type: "object", 
          properties: { 
            query: { type: "string" } 
          }, 
          required: ["query"] 
        }
      }] : undefined,
      tool_choice: useWebSearch ? "auto" : undefined
    });

    // Pour l'API /responses, le contenu est dans response.output[].content[].text
    if (response.output && Array.isArray(response.output)) {
      const messageOutput = response.output.find((item: any) => item.type === 'message');
      if (messageOutput && messageOutput.content && Array.isArray(messageOutput.content)) {
        const textContent = messageOutput.content.find((item: any) => item.type === 'output_text');
        if (textContent && textContent.text) {
          return { choices: [{ message: { content: textContent.text } }] };
        }
      }
    }
    
    return response;
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
};


// Fonction générique pour exécuter n'importe quel prompt
export const executePrompt = async (prompt: string, model: string = 'gpt-5', systemMessage?: string): Promise<any> => {
  const response = await callOpenAI(prompt, model, systemMessage);
  const content = response.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error('No content received from OpenAI');
  }
  
  return JSON.parse(content);
};

// Fonction pour utiliser la recherche web avec Tavily
export const askWithWebSearch = async (question: string, model: string = 'gpt-5'): Promise<any> => {
  try {
    // Utiliser l'API chat/completions pour une meilleure gestion des tool calls
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "Tu es un assistant qui utilise la recherche web pour fournir des informations récentes et précises. Utilise toujours l'outil de recherche web pour répondre aux questions."
        },
        {
          role: "user",
          content: question
        }
      ],
      tools: [{
        type: "function",
        function: {
          name: "web_search",
          description: "Tavily Search API for real-time web search. Use this tool to search for current information on the web.",
          parameters: { 
            type: "object", 
            properties: { 
              query: { type: "string", description: "The search query to find relevant information" }
            }, 
            required: ["query"] 
          }
        }
      }],
      tool_choice: "required"
    });

    const message = response.choices[0]?.message;
    
    if (message?.tool_calls) {
      let allSearchResults = [];
      
      // Exécuter tous les tool calls
      for (const toolCall of message.tool_calls) {
        if (toolCall.function.name === 'web_search') {
          const args = JSON.parse(toolCall.function.arguments);
          const searchResults = await webSearch(args.query);
          allSearchResults.push({
            query: args.query,
            results: searchResults
          });
        }
      }
      
      // Continuer la conversation avec tous les résultats de recherche
      const followUpResponse = await client.chat.completions.create({
        model: model,
        messages: [
          {
            role: "system",
            content: "Tu es un assistant qui fournit des réponses basées sur les résultats de recherche web."
          },
          {
            role: "user",
            content: question
          },
          {
            role: "assistant",
            content: "Je vais rechercher des informations récentes pour vous."
          },
          {
            role: "user",
            content: `Voici les résultats de recherche web:\n${JSON.stringify(allSearchResults, null, 2)}\n\nRéponds à la question originale en utilisant ces informations récentes.`
          }
        ]
      });
      
      return followUpResponse;
    }
    
    return response;
  } catch (error) {
    console.error('Web search error:', error);
    throw error;
  }
};

export const generateUseCases = async (_params: GenerateUseCasesParams) => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  // TODO: Implement full OpenAI orchestration
  return {
    created_folder_id: undefined,
    created_use_case_ids: [],
    summary: 'Generation workflow not implemented yet.'
  };
};

