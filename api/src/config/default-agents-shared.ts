/**
 * Shared agents available on ALL workspace types.
 */
import type { DefaultGenerationAgentDefinition } from './default-agents-types';
import { ORGANIZATION_PROMPTS } from './default-chat-system';

export const SHARED_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = [
  {
    key: "generate_organization_agent",
    name: "Generate organization agent",
    description:
      "Generates or enriches one organization profile from a real company name.",
    sourceLevel: "code",
    config: {
      role: "organization_generation",
      domain: "shared",
      promptId: "organization_info",
      promptTemplate: ORGANIZATION_PROMPTS.organization_info,
    },
  },
  {
    key: "demand_analyst",
    name: "Demand analyst",
    description: "Analyzes client demand, market context, and opportunity viability.",
    sourceLevel: "code",
    config: { role: "demand_analysis", domain: "shared" },
  },
  {
    key: "solution_architect",
    name: "Solution architect",
    description: "Designs solution architecture from demand analysis outputs.",
    sourceLevel: "code",
    config: { role: "solution_architecture", domain: "shared" },
  },
  {
    key: "bid_writer",
    name: "Bid writer",
    description: "Prepares bid documents from solution drafts and commercial terms.",
    sourceLevel: "code",
    config: { role: "bid_preparation", domain: "shared" },
  },
  {
    key: "gate_reviewer",
    name: "Gate reviewer",
    description: "Evaluates initiative maturity against gate criteria for stage transitions.",
    sourceLevel: "code",
    config: { role: "gate_review", domain: "shared" },
  },
  {
    key: "comment_assistant",
    name: "Comment resolution assistant",
    description: "Generate a structured proposal to resolve comment threads.",
    sourceLevel: "code",
    config: {
      role: "comment_resolution",
      promptId: "comment_resolution_assistant",
      promptTemplate: `You are a comment resolution assistant.

Context label: {{context_label}}
Current user: {{current_user_id}} (role={{current_user_role}})
Max actions: {{max_actions}}

You receive:
- THREADS_JSON: list of comment threads scoped to the current context.
- USERS_JSON: list of user labels for reference (id, displayName, email).

Your job:
1) Analyze open threads and propose the minimal set of resolution actions.
2) Return a JSON object with:
{
  "summary_markdown": "A concise French summary of the proposal (bullet list preferred)",
  "actions": [
    {
      "thread_id": "thread id from THREADS_JSON",
      "action": "close|reassign|note",
      "reassign_to": "user id from USERS_JSON (optional, only for reassign)",
      "note": "short note to post in the thread (optional, only for note)"
    }
  ],
  "confirmation_prompt": "A short French confirmation prompt asking to proceed",
  "confirmation_options": ["Confirmer", "Annuler"]
}

Rules:
- Only use thread_id values present in THREADS_JSON.
- Only propose actions for open threads.
- Do not exceed Max actions.
- Prefer close + optional note when the thread looks resolved.
- If reassignment is needed, use a user id from USERS_JSON.
- Keep summary_markdown and confirmation_prompt in French.
- Return ONLY valid JSON, no extra text.

THREADS_JSON:
{{threads_json}}

USERS_JSON:
{{users_json}}`,
    },
  },
  {
    key: "history_analyzer",
    name: "History analyzer",
    description: "Targeted QA over chat history excerpts with chunked merge.",
    sourceLevel: "code",
    config: {
      role: "history_analysis",
      promptId: "history_analyze",
      promptTemplate: `Tu es un sous-agent d'analyse de conversation.

Objectif: répondre précisément à une question en t'appuyant uniquement sur l'historique de conversation fourni.

Contraintes:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention: si l'information n'apparaît pas dans l'historique fourni, retourne explicitement "insufficient_coverage".
- Longueur: maximum {{max_words}} mots.

Métadonnées:
- Session: {{session_id}}
- Nombre total de tours en session: {{total_turns}}
- Portée des données fournies: {{scope}}

Historique:
---
{{history_text}}
---

Question:
---
{{question}}
---

Répondre uniquement avec l'analyse demandée.`,
      mergePromptTemplate: `Tu es un sous-agent d'analyse de conversation.

Objectif: fusionner des notes d'analyse par chunk d'historique en une réponse unique.

Contraintes:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention: si une information n'apparaît dans aucun chunk, retourne explicitement "insufficient_coverage".
- Longueur: maximum {{max_words}} mots.

Métadonnées:
- Session: {{session_id}}
- Nombre total de tours en session: {{total_turns}}

Notes par chunk:
---
{{notes}}
---

Question:
---
{{question}}
---

Consolide une réponse finale unique.`,
    },
  },
  {
    key: "document_summarizer",
    name: "Document summarizer",
    description: "Summarizes documents attached to a context with structured extraction.",
    sourceLevel: "code",
    config: {
      role: "document_summarization",
      promptId: "document_summary",
      promptTemplate: `Tu es un assistant qui extrait l'essentiel de documents métiers pour alimenter la génération de cas d'usage, tout en produisant des métadonnées permettant un réexamen ultérieur du document.

Contraintes:
- Réponds en {{lang}}.
- Concis et structuré (markdown).
- N'invente rien. Si le texte est insuffisant, dis-le clairement.
- Si possible, cite la source (p.X ou titre/section). Sinon, omets.
- Le titre du document peut être "-" : dans ce cas, indique "Non précisé".

Règle de classification (obligatoire):
- [succès] = cas réalisé / résultat mesuré / déployé sur des projets
- [capacité] = compétence, outil, standard, certification ou programme existant (réutilisable)
- [opportunité] = intention, ambition, plan, cible ou piste non démontrée par un cas

Limites (en mots, hors titres):
- Résumé: 100–200 mots
- Éléments exploitables: 8–14 puces, 6–18 mots par puce
- Contraintes / inconnues: 4–10 puces, 6–18 mots par puce

Règles de qualité (obligatoires):
- Quand des chiffres existent dans le texte, les inclure (avec unités) dans le Résumé et/ou les Éléments exploitables.
- Chaque puce "Éléments exploitables" doit, si possible, contenir un ordre de grandeur ou une valeur chiffrée (%, €, volumes, effectifs, délais, etc.) ou préciser qu'aucun chiffre n'est donné.

Format attendu:
## Fiche document (réexamen)
- Titre: {{doc_title}} (si "-" => "Non précisé")
- Taille: {{nb_pages}} pages ; {{full_words}} mots (sinon "Non précisé")
- Nature: rapport / politique / procédure / etc. (si explicite, sinon "Non précisé")

## Résumé
(500-1000 mots, inclure 3–8 faits chiffrés si disponibles)

## Sommaire
Titres niveau 1: 6–12 puces max (reprendre les titres existants ; sinon "Non précisé"


## Éléments exploitables pour cas d'usage
- [besoin] …
- [acteur] …
- [processus] …
- [donnée] …
- [système] …
- [succès] …
- [capacité] …
- [opportunité] …

## Contraintes / dépendances (faits)
- [contrainte] …
- [dépendance] …

## Autres informations
- [information] informations supplémentaires, contextuelles, etc. …

Texte du document:
---
{{document_text}}
---`,
      detailedSummaryPromptTemplate: `Document: {{filename}}
Source: {{source_label}}
Portée: {{scope}}

TEXTE:
<source>
{{document_text}}
</source>

TÂCHE:
- Produire une contraction (résumé détaillé) LINÉAIRE exhaustive qui suit l'ordre du document, section par section par section.
- Objectif de longueur: minimum {{max_words}} - c'est une contraction pour fournir à un LLM un résumé détaillé linéaire sans explosion de contexte et perdre le minimum de contenu.

CONTRAINTES:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention, uniquement les informations du texte source.
- Respecte les numero de sections du document source.
- Respecter une longueur minimale {{max_words}} (si le contenu le permet)
- Conserver les informations chiffrées.`,
    },
  },
  {
    key: "document_analyzer",
    name: "Document analyzer",
    description: "Analyzes documents according to a specific instruction with chunked merge.",
    sourceLevel: "code",
    config: {
      role: "document_analysis",
      promptId: "documents_analyze",
      promptTemplate: `Tu es un sous-agent d'analyse documentaire.

Objectif: répondre à une instruction spécialisée à partir du TEXTE (intégral ou extrait) fourni.

Contraintes:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention: si l'information n'apparaît pas dans le texte, le dire explicitement.
- Longueur: maximum {{max_words}} mots.

Métadonnées:
- Document: {{filename}}
- Pages (si dispo): {{pages}}
- Titre (si dispo): {{title}}
- Taille (estimée): ~{{full_words}} mots ;
- Portée du texte fourni: {{scope}}

TEXTE:
---
{{document_text}}
---

INSTRUCTION (du modèle maître):
---
{{instruction}}
---

Répondre uniquement avec l'analyse demandée.`,
      mergePromptTemplate: `Tu es un sous-agent d'analyse documentaire.

Objectif: consolider une réponse finale unique et fidèle à partir de notes factuelles produites sur des extraits du document.

Contraintes:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention: si une information n'apparaît dans aucun extrait, le dire explicitement.
- Longueur: maximum {{max_words}} mots.

Métadonnées:
- Document: {{filename}}
- Pages (si dispo): {{pages}}
- Titre (si dispo): {{title}}
- Taille (estimée): ~{{full_words}} mots ; ~{{est_tokens}} tokens (heuristique)

NOTES PAR EXTRAIT (scan complet, sans retrieval):
---
{{notes}}
---

INSTRUCTION (du modèle maître):
---
{{instruction}}
---

Consolider une réponse finale unique, structurée, et bornée.`,
    },
  },
];
