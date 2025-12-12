import { executeWithTools } from './tools';
import { callOpenAIResponseStream, type StreamEvent } from './openai';
import { writeStreamEvent, getNextSequence, generateStreamId } from './stream-service';
import { searchWeb, extractUrlContent, type SearchResult, type ExtractResult } from './tools';
import { defaultPrompts } from '../config/default-prompts';
import type OpenAI from 'openai';

export interface CompanyData {
  industry: string;
  size: string;
  products: string;
  processes: string;
  challenges: string;
  objectives: string;
  technologies: string;
}

// Configuration métier par défaut
const industries = {
  industries: [
    { name: 'Technologie' },
    { name: 'Santé' },
    { name: 'Finance' },
    { name: 'Éducation' },
    { name: 'Retail' },
    { name: 'Manufacturing' },
    { name: 'Services' },
    { name: 'Immobilier' },
    { name: 'Transport' },
    { name: 'Énergie' },
    { name: 'Agroalimentaire' },
    { name: 'Média' },
    { name: 'Télécommunications' },
    { name: 'Automobile' },
    { name: 'Aéronautique' }
  ]
};

/**
 * Enrichir une entreprise avec l'IA
 * Si streamId est fourni, utilise le streaming et écrit les événements dans chat_stream_events
 * Sinon, utilise l'ancienne méthode (non-streaming) pour compatibilité
 */
export const enrichCompany = async (
  companyName: string, 
  model?: string, 
  signal?: AbortSignal,
  streamId?: string
): Promise<CompanyData> => {
  // Si streamId est fourni, utiliser la version streaming
  if (streamId) {
    // enrichCompanyStream attend : (companyName, streamId, model, signal)
    // enrichCompany reçoit : (companyName, model, signal, streamId)
    return enrichCompanyStream(companyName, streamId, model, signal);
  }

  // Sinon, utiliser l'ancienne méthode (non-streaming) pour compatibilité
  const companyInfoPrompt = defaultPrompts.find(p => p.id === 'company_info')?.content || '';
  
  if (!companyInfoPrompt) {
    throw new Error('Prompt company_info non trouvé');
  }

  const industriesList = industries.industries.map(i => i.name).join(', ');
  const prompt = companyInfoPrompt
    .replace('{{company_name}}', companyName)
    .replace('{{industries}}', industriesList);

  const response = await executeWithTools(prompt, { 
    model: model || 'gpt-4.1-nano', 
    useWebSearch: true,
    responseFormat: 'json_object',
    signal
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Aucune réponse reçue de l\'IA');
  }

  try {
    const parsedData = JSON.parse(content);
    return parsedData;
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', content);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA');
  }
};

/**
 * Enrichir une entreprise avec l'IA en streaming
 * @param companyName - Nom de l'entreprise
 * @param streamId - ID du stream pour écrire les événements (optionnel, généré si non fourni)
 * @param model - Modèle OpenAI à utiliser (optionnel, utilise le défaut depuis settings)
 * @param signal - AbortSignal pour annulation
 * @returns Données enrichies de l'entreprise
 */
export const enrichCompanyStream = async (
  companyName: string,
  streamId?: string,
  model?: string,
  signal?: AbortSignal
): Promise<CompanyData> => {
  const companyInfoPrompt = defaultPrompts.find(p => p.id === 'company_info')?.content || '';
  
  if (!companyInfoPrompt) {
    throw new Error('Prompt company_info non trouvé');
  }

  // Générer streamId si non fourni
  const finalStreamId = streamId || generateStreamId('company_info');

  const industriesList = industries.industries.map(i => i.name).join(', ');
  const prompt = companyInfoPrompt
    .replace('{{company_name}}', companyName)
    .replace('{{industries}}', industriesList);

  // Définir les tools pour recherche web
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

  // Premier appel avec tools (streaming)
  let sequence = await getNextSequence(finalStreamId);
  await writeStreamEvent(finalStreamId, 'status', { state: 'started' }, sequence);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "Tu es un assistant qui utilise la recherche web et l'extraction de contenu pour fournir des informations récentes et précises. Utilise l'outil de recherche web pour trouver des informations, puis l'outil d'extraction pour obtenir le contenu détaillé des URLs pertinentes."
    },
    {
      role: "user",
      content: prompt
    }
  ];

  // État pour collecter le contenu et les tool calls
  let accumulatedContent = '';
  const toolCalls: Array<{
    id: string;
    name: string;
    args: string;
  }> = [];
  let streamDone = false;

  // Premier tour : appel avec tools
  for await (const event of callOpenAIResponseStream({
    messages,
    model,
    tools: [webSearchTool, webExtractTool],
    responseFormat: 'json_object',
    reasoningSummary: 'detailed',
    signal
  })) {
    if (!event || !event.type) {
      continue;
    }
    const data = event.data || {};

    // DEBUG TEMP (à retirer après diagnostic)
    if (!data || (!data.delta && !data.tool_call_id && event.type !== 'status' && event.type !== 'done')) {
      console.log('[DEBUG enrichCompanyStream] event', {
        type: event.type,
        dataKeys: data ? Object.keys(data) : [],
        rawEvent: event
      });
    }

    sequence = await getNextSequence(finalStreamId);
    
    // Écrire l'événement dans la DB
    await writeStreamEvent(finalStreamId, event.type, data, sequence);

    // Collecter le contenu pour le résultat final
    if (event.type === 'content_delta') {
      accumulatedContent += data.delta || '';
    }

    // Collecter les tool calls
    if (event.type === 'tool_call_start') {
      const existingIndex = toolCalls.findIndex(tc => tc.id === data.tool_call_id);
      if (existingIndex === -1) {
        toolCalls.push({
          id: data.tool_call_id || '',
          name: data.name || '',
          args: data.args || ''
        });
      } else {
        // Mettre à jour le tool call existant
        toolCalls[existingIndex].name = data.name || toolCalls[existingIndex].name;
        toolCalls[existingIndex].args = (toolCalls[existingIndex].args || '') + (data.args || '');
      }
    } else if (event.type === 'tool_call_delta') {
      const toolCall = toolCalls.find(tc => tc.id === data.tool_call_id);
      if (toolCall) {
        toolCall.args += data.delta || '';
      } else {
        // Tool call non encore créé, le créer (cas où on reçoit d'abord un delta)
        toolCalls.push({
          id: data.tool_call_id || '',
          name: '',
          args: data.delta || ''
        });
      }
    }

    // Si done, marquer que le stream est terminé
    if (event.type === 'done') {
      streamDone = true;
    }

    // Si erreur, arrêter
    if (event.type === 'error') {
      throw new Error(data.message || 'Erreur lors du streaming');
    }
  }

  // S'assurer que le stream est terminé avant d'exécuter les tools
  if (!streamDone) {
    sequence = await getNextSequence(finalStreamId);
    await writeStreamEvent(finalStreamId, 'done', {}, sequence);
  }

  // Exécuter les tool calls
  const allSearchResults: Array<{ query: string; results: SearchResult[] }> = [];
  const allExtractResults: ExtractResult[] = [];

  for (const toolCall of toolCalls) {
    if (signal?.aborted) {
      throw new Error('AbortError');
    }

    try {
      const args = JSON.parse(toolCall.args);
      
      if (toolCall.name === 'web_search') {
        sequence = await getNextSequence(finalStreamId);
        await writeStreamEvent(finalStreamId, 'tool_call_result', {
          tool_call_id: toolCall.id,
          result: { status: 'executing' }
        }, sequence);

        const searchResults = await searchWeb(args.query, signal);
        allSearchResults.push({
          query: args.query,
          results: searchResults
        });

        sequence = await getNextSequence(finalStreamId);
        await writeStreamEvent(finalStreamId, 'tool_call_result', {
          tool_call_id: toolCall.id,
          result: { status: 'completed', results: searchResults }
        }, sequence);
      } else if (toolCall.name === 'web_extract') {
        sequence = await getNextSequence(finalStreamId);
        await writeStreamEvent(finalStreamId, 'tool_call_result', {
          tool_call_id: toolCall.id,
          result: { status: 'executing' }
        }, sequence);

        const urls = Array.isArray(args.urls) ? args.urls : [args.url || args.urls];
        const extractPromises = urls.map((url: string) => extractUrlContent(url, signal));
        const extractResults = await Promise.all(extractPromises);
        allExtractResults.push(...extractResults);

        sequence = await getNextSequence(finalStreamId);
        await writeStreamEvent(finalStreamId, 'tool_call_result', {
          tool_call_id: toolCall.id,
          result: { status: 'completed', results: extractResults }
        }, sequence);
      }
    } catch (error) {
      console.error(`Erreur lors de l'exécution du tool ${toolCall.name}:`, error);
      sequence = await getNextSequence(finalStreamId);
      await writeStreamEvent(finalStreamId, 'tool_call_result', {
        tool_call_id: toolCall.id,
        result: { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
      }, sequence);
    }
  }

  // Si on a des tool calls, faire un deuxième appel avec les résultats
  if (toolCalls.length > 0) {
    let resultsMessage = '';
    if (allSearchResults.length > 0) {
      resultsMessage += `Voici les résultats de recherche web:\n${JSON.stringify(allSearchResults, null, 2)}\n\n`;
    }
    if (allExtractResults.length > 0) {
      resultsMessage += `Voici les contenus extraits des URLs:\n${JSON.stringify(allExtractResults, null, 2)}\n\n`;
    }
    resultsMessage += 'Réponds à la question originale en utilisant ces informations récentes.';

    // Réinitialiser le contenu accumulé pour le deuxième tour
    accumulatedContent = '';

    const followUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
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
    ];

    // Deuxième appel (streaming) avec les résultats
    for await (const event of callOpenAIResponseStream({
      messages: followUpMessages,
      model,
      responseFormat: 'json_object',
      reasoningSummary: 'detailed',
      signal
    })) {
      if (!event || !event.type) continue;
      const data = event.data || {};

      // DEBUG TEMP (à retirer après diagnostic)
      if (!data || (!data.delta && !data.tool_call_id && event.type !== 'status' && event.type !== 'done')) {
        console.log('[DEBUG enrichCompanyStream followUp] event', {
          type: event.type,
          dataKeys: data ? Object.keys(data) : [],
          rawEvent: event
        });
      }
      sequence = await getNextSequence(finalStreamId);
      
      // Écrire l'événement dans la DB
      await writeStreamEvent(finalStreamId, event.type, data, sequence);

      // Collecter le contenu pour le résultat final
      if (event.type === 'content_delta') {
        accumulatedContent += data.delta || '';
      }

      // Si erreur, arrêter
      if (event.type === 'error') {
        throw new Error(data.message || 'Erreur lors du streaming');
      }
    }
  }

  // Écrire l'événement 'done'
  sequence = await getNextSequence(finalStreamId);
  await writeStreamEvent(finalStreamId, 'done', {}, sequence);

  // Parser le contenu final
  if (!accumulatedContent) {
    throw new Error('Aucune réponse reçue de l\'IA');
  }

  try {
    const cleaned = accumulatedContent
      .trim()
      // retirer d'éventuels code fences
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const tryParse = (s: string) => JSON.parse(s);

    let parsedData: any;
    try {
      parsedData = tryParse(cleaned);
    } catch {
      // Fallback: extraire le premier objet JSON plausible (au cas où du texte parasite s'ajoute)
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        parsedData = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error('No JSON object boundaries found');
      }
    }
    return parsedData;
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', accumulatedContent);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA');
  }
};
