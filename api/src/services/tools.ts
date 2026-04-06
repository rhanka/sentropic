import { env } from '../config/env';
import fetch from "node-fetch";
import { callLLMStream } from './llm-runtime';
import type { StreamEventType } from './llm-runtime';
import type OpenAI from 'openai';
import { generateStreamId, getNextSequence, writeStreamEvent } from './stream-service';
import { toolService } from './tool-service';

// Fonction pour Tavily Search
const TAVILY_API_KEY = env.TAVILY_API_KEY;

// Prompts d'orchestration web tools (DOIVENT rester identiques entre non-streaming et streaming)
const WEB_TOOLS_SYSTEM_PROMPT =
  "Tu es un assistant qui utilise la recherche web et l'extraction de contenu pour fournir des informations récentes et précises. Utilise l'outil de recherche web pour trouver des informations, puis l'outil d'extraction pour obtenir le contenu détaillé des URLs pertinentes. CRITICAL: Si tu dois extraire plusieurs URLs avec web_extract, tu DOIS passer TOUTES les URLs dans un seul appel en utilisant le paramètre urls (array). NE FAIS JAMAIS plusieurs appels séparés pour chaque URL. Exemple: si tu as 9 URLs, appelle une fois avec {\"urls\": [\"url1\", \"url2\", ..., \"url9\"]} au lieu d'appeler 9 fois avec une URL chacune. Ne JAMAIS appeler web_extract avec un array vide: JAMAIS web_extract avec {\"urls\":[]}. IMPORTANT: Ne JAMAIS écrire des pseudo-appels d'outils dans le texte (ex: du JSON du type {\"tool\":\"documents\"...} ou {\"action\":\"web_extract\"...}). Si tu as besoin d'un outil, tu dois l'appeler via un tool call (function call) — pas en le décrivant. Lorsque `responseFormat` demande un JSON, la réponse finale doit être un UNIQUE objet JSON valide (aucun texte ou JSON parasite avant/après).";

const WEB_TOOLS_FOLLOWUP_SYSTEM_PROMPT =
  "Tu es un assistant qui fournit une réponse finale basée sur les résultats fournis. IMPORTANT: aucun outil n'est disponible à cette étape. Ne JAMAIS écrire de pseudo-appels d'outils dans le texte. Si un JSON est demandé, la sortie doit être un UNIQUE objet JSON valide, sans texte avant/après.";

const WEB_TOOLS_FOLLOWUP_ASSISTANT_PROMPT =
  "Je vais maintenant produire la réponse finale à partir des résultats fournis.";

const WEB_TOOLS_RESULTS_SUFFIX =
  "Produis maintenant la réponse finale. IMPORTANT: si un JSON est demandé, renvoie uniquement l'objet JSON final (aucun texte ou JSON parasite).";

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
 * Retourne la structure `initiatives.data` complète.
 */
export const readInitiativeTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_initiative",
    description:
      "Lit un use case (structure initiatives.data). Utilise ce tool pour connaître l'état actuel avant de proposer des modifications. IMPORTANT: utilise `select` dès que possible pour ne récupérer que les champs nécessaires (réduit fortement les tokens et évite de renvoyer un blob complet).",
    parameters: {
      type: "object",
      properties: {
        initiativeId: { type: "string", description: "ID du use case à lire" },
        select: {
          type: "array",
          items: { type: "string" },
          description:
            "Liste de champs de `data` à inclure. Exemples: ['references'] ou ['problem','solution','description']. Si absent, renvoie `data` complet."
        }
      },
      required: ["initiativeId"]
    }
  }
};

/**
 * Tool générique: met à jour un ou plusieurs champs de `initiatives.data.*`.
 * Le mapping DB est pris en charge côté `tool-service.ts`.
 */
export const updateInitiativeTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "update_initiative",
    description:
      "OBLIGATOIRE : Utilise ce tool quand l'utilisateur demande de modifier, reformuler ou mettre à jour des champs de l'initiative. Ne réponds pas dans le texte, utilise ce tool pour appliquer les modifications directement en base de données. Met à jour un ou plusieurs champs d'une initiative (JSONB initiatives.data). Chaque update est un objet {path, value}. Paths disponibles : 'description' (string), 'problem' (string), 'solution' (string), 'benefits' (array de strings), 'risks' (array de strings), 'constraints' (array de strings), 'metrics' (array de strings), 'nextSteps' (array de strings), 'technologies' (array de strings), 'dataSources' (array de strings), 'dataObjects' (array de strings). Exemple pour un champ string : {path: 'problem', value: 'Nouveau texte'}. Exemple pour un champ liste : {path: 'metrics', value: ['Métrique 1', 'Métrique 2', 'Métrique 3']}.",
    parameters: {
      type: "object",
      properties: {
        initiativeId: { type: "string", description: "ID du use case à modifier" },
        updates: {
          type: "array",
          description: "Liste des modifications à appliquer (max 50). path cible initiatives.data.*",
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
      required: ["initiativeId", "updates"]
    }
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
export const initiativesListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'initiatives_list',
    description:
      'List use cases for a folder. Use idsOnly to get only IDs, or select to limit returned fields from initiatives.data.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID to list use cases for.' },
        idsOnly: { type: 'boolean', description: 'If true, return only use case IDs.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of fields from initiatives.data to include (top-level only, like read_initiative).'
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

/**
 * Documents tool (single tool) — list documents + fetch summary/content (bounded).
 * IMPORTANT: Security checks are enforced in ChatService (context match + workspace scope).
 */
export const documentsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'documents',
    description: `
      Accède aux documents attachés à un contexte (organization/folder/usecase/chat_session).
      
      Les documents sont fournis par l'utilisateurs et supposés être une source importante d'information.

      Permet de:
       - lister les documents + statuts,
       - lire un RÉSUMÉ COURT (get_summary) pour une information de surface,
       - lire le CONTENU (get_content) : soit le text complet (petit doc) soit un résumé (10k mots si le document est long) - pour une information détaillée
       - lancer une analyse ciblée (analyze) - pour une requête ciblée (recherche d'un contenu).
       `,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get_summary', 'get_content', 'analyze'],
          description: 'Action à effectuer.'
        },
        contextType: {
          type: 'string',
          enum: ['organization', 'folder', 'initiative', 'chat_session'],
          description: 'Type du contexte.'
        },
        contextId: { type: 'string', description: 'ID du contexte.' },
        documentId: { type: 'string', description: 'ID du document (requis pour get_summary/get_content).' },
        maxChars: {
          type: 'number',
          description: 'Optionnel: borne de caractères pour get_content (max 50000).'
        },
        prompt: {
          type: 'string',
          description:
            "Requis pour analyze: prompt/instruction ciblée à exécuter par un sous-agent à partir du document (texte intégral si possible; sinon scan complet par extraits + consolidation)."
        },
        maxWords: {
          type: 'number',
          description: 'Optionnel: borne en mots pour analyze (max 10000, défaut 10000).'
        }
      },
      required: ['action', 'contextType', 'contextId']
    }
  }
};

/**
 * Conversation history analyzer (read-only).
 */
export const historyAnalyzeTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'history_analyze',
    description:
      'Answer targeted questions over conversation history with evidence references. Read-only tool.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Targeted question to answer from chat history.'
        },
        from_message_id: {
          type: 'string',
          description: 'Optional lower bound message id (inclusive).'
        },
        to_message_id: {
          type: 'string',
          description: 'Optional upper bound message id (inclusive).'
        },
        max_turns: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Optional bound on scanned turns.'
        },
        target_tool_call_id: {
          type: 'string',
          description:
            'Optional tool call id to focus on one specific oversized tool result path.'
        },
        target_tool_result_message_id: {
          type: 'string',
          description:
            'Optional tool-result message id to focus the analysis scope.'
        },
        include_tool_results: {
          type: 'boolean',
          description: 'Include tool-result messages in analysis scope (default true).'
        },
        include_system_messages: {
          type: 'boolean',
          description: 'Include system messages in analysis scope (default false).'
        },
        max_words: {
          type: 'integer',
          minimum: 200,
          maximum: 6000,
          description: 'Optional answer bound in words.'
        }
      },
      required: ['question']
    }
  }
};

/**
 * Comment assistant tool (analysis + resolution with explicit confirmation).
 */
export const commentAssistantTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'comment_assistant',
    description:
      'Analyze comment threads in the current context and propose resolution actions. ' +
      'Use mode="suggest" to get a proposal; use mode="resolve" to execute actions ONLY after explicit user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['suggest', 'resolve'],
          description: 'suggest = propose actions, resolve = execute actions after user confirmation.'
        },
        contextType: {
          type: 'string',
          enum: ['organization', 'folder', 'initiative', 'matrix', 'executive_summary'],
          description: 'Context type for the comment scope.'
        },
        contextId: { type: 'string', description: 'Context ID for the comment scope.' },
        sectionKey: { type: 'string', description: 'Optional section key to narrow the analysis.' },
        threadId: { type: 'string', description: 'Optional thread ID to focus on a single thread.' },
        status: {
          type: 'string',
          enum: ['open', 'closed'],
          description: 'Optional status filter (default: open).'
        },
        confirmation: {
          type: 'string',
          description: 'Required for resolve: explicit user confirmation (e.g., "yes").'
        },
        actions: {
          type: 'array',
          description: 'Actions to apply in resolve mode.',
          items: {
            type: 'object',
            properties: {
              thread_id: { type: 'string', description: 'Thread ID to act on.' },
              action: {
                type: 'string',
                enum: ['close', 'reassign', 'note'],
                description: 'Action to execute.'
              },
              reassign_to: {
                type: 'string',
                description: 'User ID for reassign (required when action=reassign).'
              },
              note: {
                type: 'string',
                description: 'Resolution note content (required when action=note).'
              }
            },
            required: ['thread_id', 'action']
          }
        }
      },
      required: ['mode', 'contextType', 'contextId']
    }
  }
};

/**
 * Plan runtime tool (chat orchestration -> plan/todo/task entities).
 */
export const planTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'plan',
    description:
      'Unified plan runtime orchestration tool. Use action=create to create a checklist plan, action=update_plan to update plan-level progression, and action=update_task to progress a task.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update_plan', 'update_task'],
          description:
            'Operation to execute. create=create checklist; update_plan=update TODO status/content; update_task=update task status/content.',
        },
        title: {
          type: 'string',
          description: 'TODO/task title depending on action.'
        },
        description: {
          type: 'string',
          description: 'Optional TODO/task description depending on action.'
        },
        planId: {
          type: 'string',
          description: 'Optional existing plan ID (create action).'
        },
        planTitle: {
          type: 'string',
          description: 'Optional plan title; creates a new plan when planId is not provided (create action).'
        },
        tasks: {
          type: 'array',
          description: 'Optional initial tasks to create under the TODO (create action).',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title (required).' },
              description: { type: 'string', description: 'Optional task description.' }
            },
            required: ['title']
          }
        },
        todoId: {
          type: 'string',
          description: 'TODO id to update (update_plan action).'
        },
        ownerUserId: {
          type: 'string',
          description: 'Optional TODO owner user id (update_plan action, reassignment permission required).'
        },
        closed: {
          type: 'boolean',
          description: 'Optional explicit TODO close flag (update_plan action).'
        },
        taskId: {
          type: 'string',
          description: 'Task id to update (update_task action).'
        },
        assigneeUserId: {
          type: 'string',
          description: 'Optional task assignee user id (update_task action, reassignment permission required).'
        },
        status: {
          type: 'string',
          enum: ['todo', 'planned', 'in_progress', 'blocked', 'done', 'deferred', 'cancelled'],
          description: 'Status transition target (update_plan/update_task).'
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata object (create/update_plan/update_task).'
        }
      },
      required: ['action']
    }
  }
};

// --- Extended object tools (opportunity workspace) ---

export const solutionsListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'solutions_list',
    description: 'List solutions for an initiative in the current workspace.',
    parameters: {
      type: 'object',
      properties: {
        initiativeId: { type: 'string', description: 'Initiative ID to list solutions for.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Optional fields to select.' }
      },
      required: ['initiativeId']
    }
  }
};

export const solutionGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'solution_get',
    description: 'Get details of a specific solution.',
    parameters: {
      type: 'object',
      properties: {
        solutionId: { type: 'string', description: 'Solution ID.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Optional fields to select.' }
      },
      required: ['solutionId']
    }
  }
};

export const bidsListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'bids_list',
    description: 'List bids for an initiative in the current workspace.',
    parameters: {
      type: 'object',
      properties: {
        initiativeId: { type: 'string', description: 'Initiative ID to list bids for.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Optional fields to select.' }
      },
      required: ['initiativeId']
    }
  }
};

export const bidGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'bid_get',
    description: 'Get details of a specific bid.',
    parameters: {
      type: 'object',
      properties: {
        bidId: { type: 'string', description: 'Bid ID.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Optional fields to select.' }
      },
      required: ['bidId']
    }
  }
};

export const productsListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'products_list',
    description: 'List products in the current workspace, optionally filtered by initiative.',
    parameters: {
      type: 'object',
      properties: {
        initiativeId: { type: 'string', description: 'Optional initiative ID to filter products.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Optional fields to select.' }
      }
    }
  }
};

export const productGetTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'product_get',
    description: 'Get details of a specific product.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product ID.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Optional fields to select.' }
      },
      required: ['productId']
    }
  }
};

export const gateReviewTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'gate_review',
    description: 'Review gate criteria for an initiative maturity stage transition. Returns warnings/blockers based on workspace gate configuration.',
    parameters: {
      type: 'object',
      properties: {
        initiativeId: { type: 'string', description: 'Initiative ID.' },
        targetStage: { type: 'string', description: 'Target maturity stage (e.g. G0, G2, G5, G7).' }
      },
      required: ['initiativeId', 'targetStage']
    }
  }
};

// --- Cross-workspace tools (neutral workspace) ---

export const workspaceListTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'workspace_list',
    description: 'List all workspaces accessible to the current user with summary stats.',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
};

export const initiativeSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'initiative_search',
    description: 'Search initiatives across all accessible workspaces by name, status, or maturity stage.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (matches initiative name or description).' },
        status: { type: 'string', description: 'Optional status filter.' },
        maturityStage: { type: 'string', description: 'Optional maturity stage filter (e.g. G0, G2).' }
      }
    }
  }
};

export const taskDispatchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'task_dispatch',
    description: 'Dispatch a task (todo) to a specific workspace on behalf of the current user.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Target workspace ID.' },
        title: { type: 'string', description: 'Task title.' },
        description: { type: 'string', description: 'Optional task description.' }
      },
      required: ['workspaceId', 'title']
    }
  }
};

/**
 * Tool for generating a DOCX document from the current context.
 * Enqueues a document generation job via queue-manager.
 */
export const documentGenerateTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'document_generate',
    description:
      'Generate a DOCX document from the current context (initiative, folder/dashboard, etc.). ' +
      'Before generating your first document in a conversation, call this tool with `action: "upskill"` to learn DOCX best practices. ' +
      'Then call with `action: "generate"` with your code. ' +
      'For generate: two sub-modes — (1) Template mode with templateId, (2) Freeform mode with code (mutually exclusive).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['upskill', 'generate'],
          description:
            'Action to perform. Call "upskill" first to learn DOCX creation best practices, then "generate" with your code.',
        },
        templateId: {
          type: 'string',
          description:
            'Document template identifier. Examples: "usecase-onepage" for initiative one-pager, ' +
            '"executive-synthesis-multipage" for folder executive summary report. ' +
            'Mutually exclusive with code. Only for action "generate".',
        },
        entityType: {
          type: 'string',
          enum: ['initiative', 'folder'],
          description: 'Type of entity to generate the document for. Only for action "generate".',
        },
        entityId: {
          type: 'string',
          description: 'ID of the entity (initiative ID or folder ID). Only for action "generate".',
        },
        code: {
          type: 'string',
          description:
            'JavaScript code using docx helpers (doc, h, p, bold, italic, list, table, pageBreak, hr) ' +
            'that returns a Document object. Available data: context.entity, context.initiatives, ' +
            'context.matrix, context.workspace. Mutually exclusive with templateId. Only for action "generate".',
        },
        title: {
          type: 'string',
          description:
            'Document title used as the file name. Example: "Rapport initiatives dossier X". Only for action "generate".',
        },
      },
      required: ['action'],
    },
  },
};

/**
 * Tool for batch-creating organizations from a prompt description.
 */
export const batchCreateOrganizationsTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'batch_create_organizations',
    description:
      'Create multiple organizations at once from a text description. ' +
      'The AI will parse the description and create structured organization entries in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            'Text description of organizations to create. Can include names, industries, sizes, and other details.',
        },
      },
      required: ['description'],
    },
  },
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
  /**
   * Enable the `documents` tool (executed server-side) and attach it to a single authorized context.
   * IMPORTANT: The model must call `documents` with the exact contextType/contextId provided here.
   */
  useDocuments?: boolean;
  documentsContext?: {
    workspaceId: string;
    contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
    contextId: string;
  };
  /**
   * Multi-context variant for the `documents` tool (e.g., allow folder + organization in the same execution).
   * Security: the model may only call documents for the exact (contextType, contextId) pairs listed here.
   */
  documentsContexts?: Array<{
    workspaceId: string;
    contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
    contextId: string;
  }>;
  responseFormat?: 'json_object';
  /**
   * Structured Outputs (Responses API): JSON Schema strict for the FINAL answer (phase 2).
   * When set, it overrides responseFormat for phase 2.
   */
  structuredOutput?: {
    name: string;
    schema: Record<string, unknown>;
    description?: string;
    strict?: boolean;
  };
  signal?: AbortSignal;
/**
   * ID du stream à utiliser (si non fourni, généré à partir des champs ci-dessous).
   */
  streamId?: string;
  promptId?: string;
  jobId?: string;
  messageId?: string;
  /**
   * Résumé de reasoning (provider-agnostic).
   * Passed through to the LLM runtime which maps to provider-native format:
   * - OpenAI: `reasoning.summary`
   * - Claude: ignored (no equivalent)
   * - Mistral/Cohere: ignored (no reasoning support)
   * If not provided, no reasoning parameter is sent.
   */
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  /**
   * Effort de reasoning (provider-agnostic). Optionnel (override).
   * Passed through to the LLM runtime which maps to provider-native format:
   * - OpenAI: `reasoning.effort`
   * - Claude: `thinking.budget_tokens` (for opus models only)
   * - Mistral/Cohere: ignored (no reasoning support)
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  /**
   * Max output tokens for the model output (Responses API).
   * IMPORTANT: required for long-form outputs; otherwise OpenAI may use a small default.
   */
  maxOutputTokens?: number;
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
    useDocuments = false,
    documentsContext,
    documentsContexts,
    responseFormat,
    structuredOutput,
    reasoningSummary,
    reasoningEffort,
    maxOutputTokens,
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
    for await (const event of callLLMStream({
      messages: [{ role: 'user', content: prompt }],
      model,
      responseFormat,
      structuredOutput,
      reasoningSummary,
      reasoningEffort,
      maxOutputTokens,
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
  const allowedDocumentsContexts =
    (Array.isArray(documentsContexts) && documentsContexts.length > 0)
      ? documentsContexts
      : (documentsContext ? [documentsContext] : []);
  const enabledTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    webSearchTool,
    webExtractTool,
    ...(useDocuments && allowedDocumentsContexts.length > 0 ? [documentsTool] : [])
  ];

  for await (const event of callLLMStream({
    messages: [
      { role: 'system', content: WEB_TOOLS_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    model,
    tools: enabledTools,
    responseFormat,
    reasoningSummary,
    reasoningEffort,
    maxOutputTokens,
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
    const allDocumentsResults: Array<{ action: string; result: unknown }> = [];

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
        } else if (toolCall.name === 'documents') {
          if (!useDocuments || allowedDocumentsContexts.length === 0) {
            await write('tool_call_result', {
              tool_call_id: toolCall.id,
              result: { status: 'error', error: 'documents tool is not enabled for this execution' }
            });
            continue;
          }

          const action = typeof args.action === 'string' ? args.action : '';
          const ctxType = typeof args.contextType === 'string' ? args.contextType : '';
          const ctxId = typeof args.contextId === 'string' ? args.contextId : '';
          const matched = allowedDocumentsContexts.find((c) => c.contextType === ctxType && c.contextId === ctxId);
          if (!matched) {
            await write('tool_call_result', {
              tool_call_id: toolCall.id,
              result: { status: 'error', error: 'Security: context does not match authorized documentsContexts' }
            });
            continue;
          }

          await write('tool_call_result', { tool_call_id: toolCall.id, result: { status: 'executing' } });
          let result: unknown;
          if (action === 'list') {
            result = await toolService.listContextDocuments({
              workspaceId: matched.workspaceId,
              contextType: matched.contextType,
              contextId: matched.contextId,
            });
          } else if (action === 'get_summary') {
            const documentId = typeof args.documentId === 'string' ? args.documentId : '';
            if (!documentId) throw new Error('documents.get_summary: documentId is required');
            result = await toolService.getDocumentSummary({
              workspaceId: matched.workspaceId,
              contextType: matched.contextType,
              contextId: matched.contextId,
              documentId,
            });
          } else if (action === 'get_content') {
            const documentId = typeof args.documentId === 'string' ? args.documentId : '';
            if (!documentId) throw new Error('documents.get_content: documentId is required');
            const maxChars = typeof args.maxChars === 'number' ? args.maxChars : undefined;
            result = await toolService.getDocumentContent({
              workspaceId: matched.workspaceId,
              contextType: matched.contextType,
              contextId: matched.contextId,
              documentId,
              maxChars,
            });
          } else if (action === 'analyze') {
            const documentId = typeof args.documentId === 'string' ? args.documentId : '';
            if (!documentId) throw new Error('documents.analyze: documentId is required');
            const promptText = typeof args.prompt === 'string' ? args.prompt : '';
            if (!promptText.trim()) throw new Error('documents.analyze: prompt is required');
            const maxWords = typeof args.maxWords === 'number' ? args.maxWords : undefined;
            result = await toolService.analyzeDocument({
              workspaceId: matched.workspaceId,
              contextType: matched.contextType,
              contextId: matched.contextId,
              documentId,
              prompt: promptText,
              maxWords,
              signal
            });
          } else {
            throw new Error(`documents: unknown action ${action}`);
          }

          allDocumentsResults.push({ action, result });
          const payload =
            result && typeof result === 'object' && !Array.isArray(result)
              ? (result as Record<string, unknown>)
              : { value: result };
          await write('tool_call_result', { tool_call_id: toolCall.id, result: { status: 'completed', ...payload } });
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
    if (allDocumentsResults.length > 0) {
      resultsMessage += `Voici les résultats documents (outil documents):\n${JSON.stringify(allDocumentsResults, null, 2)}\n\n`;
    }
  resultsMessage += WEB_TOOLS_RESULTS_SUFFIX;

  // 2e appel (streaming) avec les résultats — identique à executeWithTools
  accumulatedContent = '';
  for await (const event of callLLMStream({
      messages: [
      { role: 'system', content: WEB_TOOLS_FOLLOWUP_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
      { role: 'assistant', content: WEB_TOOLS_FOLLOWUP_ASSISTANT_PROMPT },
      { role: 'user', content: resultsMessage }
      ],
      model,
      ...(structuredOutput ? { structuredOutput } : (responseFormat ? { responseFormat } : {})),
    reasoningSummary,
    reasoningEffort,
      signal
  })) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    await write(event.type, data);
    if (event.type === 'content_delta') accumulatedContent += (typeof data.delta === 'string' ? data.delta : '');
    if (event.type === 'error') throw new Error(typeof data.message === 'string' ? data.message : 'Erreur lors du streaming');
  }

  return { streamId: finalStreamId, content: accumulatedContent };
};
