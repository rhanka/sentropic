import { env } from '../config/env';
import fetch from "node-fetch";
import { callOpenAIResponseStream } from './openai';
import type { StreamEventType } from './openai';
import type OpenAI from 'openai';
import { generateStreamId, getNextSequence, writeStreamEvent } from './stream-service';

// Fonction pour Tavily Search
const TAVILY_API_KEY = env.TAVILY_API_KEY;

// Prompts d'orchestration web tools (DOIVENT rester identiques entre non-streaming et streaming)
const WEB_TOOLS_SYSTEM_PROMPT =
  "Tu es un assistant qui utilise la recherche web et l'extraction de contenu pour fournir des informations récentes et précises. Utilise l'outil de recherche web pour trouver des informations, puis l'outil d'extraction pour obtenir le contenu détaillé des URLs pertinentes. CRITICAL: Si tu dois extraire plusieurs URLs avec web_extract, tu DOIS passer TOUTES les URLs dans un seul appel en utilisant le paramètre urls (array). NE FAIS JAMAIS plusieurs appels séparés pour chaque URL. Exemple: si tu as 9 URLs, appelle une fois avec {\"urls\": [\"url1\", \"url2\", ..., \"url9\"]} au lieu d'appeler 9 fois avec une URL chacune. Ne JAMAIS appeler web_extract avec un array vide: JAMAIS web_extract avec {\"urls\":[]}.";

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
    description: "Extract and retrieve the full content of one or more existing web page URLs. Use this tool when the user asks for details about references (URLs already present in the use case) or when you need to analyze the full content of specific URLs. CRITICAL: If you need to extract multiple URLs (e.g., 9 URLs from references), you MUST pass ALL of them in a SINGLE call using the `urls` array parameter. NEVER make separate calls for each URL. Example: if you have 9 URLs, call once with `{\"urls\": [\"url1\", \"url2\", ..., \"url9\"]}` instead of calling 9 times with one URL each.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Array of URLs to extract content from. MUST contain ALL URLs you need to extract in a single call. Example: if you have 9 URLs, pass all 9 in this array: [\"url1\", \"url2\", ..., \"url9\"]. Do NOT make separate calls for each URL."
        }
      },
      required: ["urls"]
    }
  }
};

/**
 * Tool pour lire un use case complet.
 * Retourne la structure `use_cases.data` complète.
 */
export const readUseCaseTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_usecase",
    description:
      "Lit un use case (structure use_cases.data). Utilise ce tool pour connaître l'état actuel avant de proposer des modifications. IMPORTANT: utilise `select` dès que possible pour ne récupérer que les champs nécessaires (réduit fortement les tokens et évite de renvoyer un blob complet).",
    parameters: {
      type: "object",
      properties: {
        useCaseId: { type: "string", description: "ID du use case à lire" },
        select: {
          type: "array",
          items: { type: "string" },
          description:
            "Liste de champs de `data` à inclure. Exemples: ['references'] ou ['problem','solution','description']. Si absent, renvoie `data` complet."
        }
      },
      required: ["useCaseId"]
    }
  }
};

/**
 * Alias (Option B): `usecase_get` — preferred name for the use case read tool.
 * Keeps backward-compatibility with the legacy `read_usecase` tool id.
 */
export const useCaseGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'usecase_get',
    description:
      "Lit un use case (structure use_cases.data). (Nom standard Option B: usecase_get). IMPORTANT: utilise `select` dès que possible pour ne récupérer que les champs nécessaires.",
    parameters: readUseCaseTool.function.parameters
  }
};

/**
 * Tool générique: met à jour un ou plusieurs champs de `use_cases.data.*`.
 * Le mapping DB est pris en charge côté `tool-service.ts`.
 */
export const updateUseCaseFieldTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "update_usecase_field",
    description:
      "OBLIGATOIRE : Utilise ce tool quand l'utilisateur demande de modifier, reformuler ou mettre à jour des champs du use case. Ne réponds pas dans le texte, utilise ce tool pour appliquer les modifications directement en base de données. Met à jour un ou plusieurs champs d'un use case (JSONB use_cases.data). Utilise des paths dot-notation. Exemples de paths : 'description', 'problem', 'solution', 'solution.bullets' (pour un tableau), 'solution.bullets.0' (pour un élément spécifique).",
    parameters: {
      type: "object",
      properties: {
        useCaseId: { type: "string", description: "ID du use case à modifier" },
        updates: {
          type: "array",
          description: "Liste des modifications à appliquer (max 50). path cible use_cases.data.*",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Chemin du champ (ex: description, problem, solution.bullets.0)" },
              value: { description: "Nouvelle valeur (JSON)" }
            },
            required: ["path", "value"]
          }
        }
      },
      required: ["useCaseId", "updates"]
    }
  }
};

/**
 * Alias (Option B): `usecase_update` — preferred name for updating a use case.
 * Keeps backward-compatibility with the legacy `update_usecase_field` tool id.
 */
export const useCaseUpdateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'usecase_update',
    description:
      "OBLIGATOIRE : Utilise ce tool quand l'utilisateur demande de modifier des champs du use case. (Nom standard Option B: usecase_update). Met à jour un ou plusieurs champs d'un use case (JSONB use_cases.data) via des paths dot-notation.",
    parameters: updateUseCaseFieldTool.function.parameters
  }
};

/**
 * Organizations (batch / list scope) tools
 */
export const organizationsListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'organizations_list',
    description:
      'List organizations in the current workspace. Use idsOnly to get just IDs, or use select to limit returned fields.',
    parameters: {
      type: 'object',
      properties: {
        idsOnly: { type: 'boolean', description: 'If true, return only organization IDs.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of organization fields to include (e.g. ["name","industry","size"]). If omitted, returns full organization rows.'
        }
      },
      required: []
    }
  }
};

/**
 * Organization (detail scope) tools
 */
export const organizationGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'organization_get',
    description:
      'Read a single organization by id. Prefer using select to reduce tokens.',
    parameters: {
      type: 'object',
      properties: {
        organizationId: { type: 'string', description: 'Organization ID to read.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of fields to include (e.g. ["name","processes"]).'
        }
      },
      required: ['organizationId']
    }
  }
};

export const organizationUpdateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'organization_update',
    description:
      "Met à jour les champs d'une organisation. IMPORTANT: tu dois utiliser le NOM EXACT du champ, sinon l'API répondra \"Unsupported field\".\n\n" +
      'Mapping champ (API) ↔ intitulé (UI) :\n' +
      '- name ↔ Nom\n' +
      '- industry ↔ Secteur\n' +
      '- size ↔ Taille\n' +
      '- products ↔ Produits et Services\n' +
      '- processes ↔ Processus Métier\n' +
      '- kpis ↔ Indicateurs de performance\n' +
      '- references ↔ Références\n' +
      '- challenges ↔ Défis Principaux\n' +
      '- objectives ↔ Objectifs Stratégiques\n' +
      '- technologies ↔ Technologies\n' +
      '- status ↔ Statut\n\n' +
      "Quand l'utilisateur parle en intitulé UI (ex: \"Indicateurs de performance\"), tu dois TOUJOURS utiliser le champ API correspondant (ex: kpis).",
    parameters: {
      type: 'object',
      properties: {
        organizationId: { type: 'string', description: 'Organization ID to update.' },
        updates: {
          type: 'array',
          description: 'List of field updates to apply.',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                enum: [
                  'name',
                  'industry',
                  'size',
                  'products',
                  'processes',
                  'kpis',
                  'references',
                  'challenges',
                  'objectives',
                  'technologies',
                  'status'
                ],
                description:
                  "Nom exact du champ (API). Tu dois choisir une valeur dans l'enum. Le champ UI \"Indicateurs de performance\" correspond à `kpis`."
              },
              value: { description: 'New value (string or null).' }
            },
            required: ['field', 'value']
          }
        }
      },
      required: ['organizationId', 'updates']
    }
  }
};

/**
 * Folders (batch / list scope) tools
 */
export const foldersListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'folders_list',
    description:
      'List folders in the current workspace. Optionally filter by organizationId. Use idsOnly or select to reduce payload.',
    parameters: {
      type: 'object',
      properties: {
        organizationId: { type: 'string', description: 'Optional organization ID to filter folders.' },
        idsOnly: { type: 'boolean', description: 'If true, return only folder IDs.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of folder fields to include (e.g. ["name","description","organizationId"]). If omitted, returns full folder rows.'
        }
      },
      required: []
    }
  }
};

/**
 * Folder (detail scope) tools
 */
export const folderGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'folder_get',
    description:
      'Read a single folder by id (including parsed matrixConfig / executiveSummary when available). Prefer select to reduce tokens.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID to read.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of folder fields to include.'
        }
      },
      required: ['folderId']
    }
  }
};

export const folderUpdateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'folder_update',
    description:
      'Update fields of a single folder by id. Use this tool when the user explicitly requests changes.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID to update.' },
        updates: {
          type: 'array',
          description: 'List of field updates to apply.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Folder field name (e.g. name, description, organizationId, executiveSummary).' },
              value: { description: 'New value (JSON). For matrixConfig/executiveSummary, pass an object.' }
            },
            required: ['field', 'value']
          }
        }
      },
      required: ['folderId', 'updates']
    }
  }
};

/**
 * Use cases list within a folder context
 */
export const useCasesListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'usecases_list',
    description:
      'List use cases for a folder. Use idsOnly to get only IDs, or select to limit returned fields from use_cases.data.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID to list use cases for.' },
        idsOnly: { type: 'boolean', description: 'If true, return only use case IDs.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of fields from use_cases.data to include (top-level only, like read_usecase).'
        }
      },
      required: ['folderId']
    }
  }
};

/**
 * Executive summary tools (stored on folders.executiveSummary)
 */
export const executiveSummaryGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'executive_summary_get',
    description:
      'Read the executive summary for a folder (stored on folders.executiveSummary).',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID owning the executive summary.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of executive summary fields to include (e.g. ["introduction","analyse"]).'
        }
      },
      required: ['folderId']
    }
  }
};

export const executiveSummaryUpdateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'executive_summary_update',
    description:
      'Update the executive summary fields for a folder. Use this tool when the user explicitly requests changes.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID owning the executive summary.' },
        updates: {
          type: 'array',
          description: 'List of executive summary field updates to apply.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Executive summary field (introduction, analyse, recommandation, synthese_executive, references).' },
              value: { description: 'New value (string or JSON).' }
            },
            required: ['field', 'value']
          }
        }
      },
      required: ['folderId', 'updates']
    }
  }
};

/**
 * Matrix tools (folders.matrixConfig)
 */
export const matrixGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'matrix_get',
    description: 'Read the matrix configuration (folders.matrixConfig) for a folder.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID owning the matrix configuration.' }
      },
      required: ['folderId']
    }
  }
};

export const matrixUpdateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'matrix_update',
    description:
      'Update the matrix configuration (folders.matrixConfig) for a folder. Use this tool when the user explicitly requests changes.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID owning the matrix configuration.' },
        matrixConfig: {
          type: 'object',
          description: 'New matrix configuration object. This replaces the stored matrixConfig.'
        }
      },
      required: ['folderId', 'matrixConfig']
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
  // Tavily retourne un objet avec 'results' (array) et autres champs
  results?: Array<{
    url: string;
    title?: string;
    raw_content?: string;  // Le contenu est dans 'raw_content', pas 'markdown' ni 'content'
    markdown?: string;
    content?: string;
  }>;
  failed_results?: unknown[];
  response_time?: number;
  request_id?: string;
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
  urls: string | string[],
  signal?: AbortSignal
): Promise<ExtractResult | ExtractResult[]> => {
  if (signal?.aborted) throw new Error("AbortError");

  const urlArray = Array.isArray(urls) ? urls : [urls];

  const resp = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      urls: urlArray,  // Tavily API accepte un array d'URLs - un seul appel pour toutes les URLs
      format: "markdown",      // "markdown" | "text"
      extract_depth: "advanced" // "basic" | "advanced"
    }),
    signal
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    const urlsStr = Array.isArray(urls) ? urls.join(', ') : urls;
    console.error(`❌ Tavily extract failed for ${urlsStr}: ${resp.status} ${resp.statusText} - ${errorText}`);
    throw new Error(`Tavily extract failed: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as TavilyExtractResponse;

  // Tavily retourne un objet avec 'results' (array de résultats)
  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    if (Array.isArray(urls)) {
      // Retourner un array de résultats pour un array d'URLs
      const results: ExtractResult[] = urlArray.map((url, i) => {
        const result = data.results!.find((r) => r.url === url) || data.results![i] || data.results![0];
        const content = result.raw_content ?? result.markdown ?? result.content ?? "";
        if (content.length === 0) {
          console.warn(`⚠️ Tavily returned empty content for ${url}`);
        }
  return {
    url,
          content
        };
      });
      return results;
    } else {
      // Retourner un seul résultat pour une seule URL (compatibilité)
      const result = data.results.find((r) => r.url === urls) || data.results[0];
      const content = result.raw_content ?? result.markdown ?? result.content ?? "";
      if (content.length === 0) {
        console.warn(`⚠️ Tavily returned empty content for ${urls}`);
      }
      return {
        url: urls,
        content
      };
    }
  } else {
    // Fallback: format objet simple (si pas de results array)
    const content = data.markdown ?? data.content ?? "";
    if (Array.isArray(urls)) {
      // Si array d'URLs mais pas de results, retourner un array avec le contenu pour la première URL
      return urlArray.map((url, i) => ({
        url,
        content: i === 0 ? content : ""
      }));
    } else {
      return {
        url: urls,
        content
      };
    }
  }
};


export interface ExecuteWithToolsStreamOptions {
  model?: string;
  useWebSearch?: boolean;
  responseFormat?: 'json_object';
  signal?: AbortSignal;
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

// executeWithTools a été supprimé - utiliser executeWithToolsStream à la place

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
      const data = (event.data ?? {}) as Record<string, unknown>;
      await write(event.type, data);
      if (event.type === 'content_delta') accumulatedContent += (typeof data.delta === 'string' ? data.delta : '');
      if (event.type === 'error') throw new Error(typeof data.message === 'string' ? data.message : 'Erreur lors du streaming');
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
    const data = (event.data ?? {}) as Record<string, unknown>;
    await write(event.type, data);

    if (event.type === 'content_delta') accumulatedContent += (typeof data.delta === 'string' ? data.delta : '');

    if (event.type === 'tool_call_start') {
      const toolCallId = typeof data.tool_call_id === 'string' ? data.tool_call_id : '';
      const existingIndex = toolCalls.findIndex(tc => tc.id === toolCallId);
      if (existingIndex === -1) {
        toolCalls.push({
          id: toolCallId,
          name: typeof data.name === 'string' ? data.name : '',
          args: typeof data.args === 'string' ? data.args : ''
        });
      } else {
        const nextName = typeof data.name === 'string' ? data.name : '';
        const nextArgs = typeof data.args === 'string' ? data.args : '';
        toolCalls[existingIndex].name = nextName || toolCalls[existingIndex].name;
        toolCalls[existingIndex].args = (toolCalls[existingIndex].args || '') + (nextArgs || '');
      }
    } else if (event.type === 'tool_call_delta') {
      const toolCallId = typeof data.tool_call_id === 'string' ? data.tool_call_id : '';
      const delta = typeof data.delta === 'string' ? data.delta : '';
      const toolCall = toolCalls.find(tc => tc.id === toolCallId);
      if (toolCall) {
        toolCall.args += delta;
      } else {
        toolCalls.push({ id: toolCallId, name: '', args: delta });
      }
    }

    if (event.type === 'error') throw new Error(typeof data.message === 'string' ? data.message : 'Erreur lors du streaming');
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
        
        // Validation : rejeter les appels avec array vide
        if (urls.length === 0) {
          await write('tool_call_result', {
            tool_call_id: toolCall.id,
            result: {
              status: 'error',
              error: 'web_extract requires at least one URL. No URLs provided in the urls array.'
            }
          });
          continue; // Passer au tool call suivant
        }
        
        // Appel unique avec toutes les URLs (un seul appel Tavily au lieu de N appels)
        const extractResults = await extractUrlContent(urls, signal);
        const resultsArray = Array.isArray(extractResults) ? extractResults : [extractResults];
        allExtractResults.push(...resultsArray);
        await write('tool_call_result', { tool_call_id: toolCall.id, result: { status: 'completed', results: resultsArray } });
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
    const data = (event.data ?? {}) as Record<string, unknown>;
    await write(event.type, data);
    if (event.type === 'content_delta') accumulatedContent += (typeof data.delta === 'string' ? data.delta : '');
    if (event.type === 'error') throw new Error(typeof data.message === 'string' ? data.message : 'Erreur lors du streaming');
  }

  return { streamId: finalStreamId, content: accumulatedContent };
};
