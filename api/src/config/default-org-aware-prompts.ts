const ORG_AWARE_LIST_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titre: { type: 'string' },
    description: { type: 'string' },
    ref: { type: 'string' },
    organizationIds: {
      type: 'array',
      items: { type: 'string' },
    },
    organizationName: { type: ['string', 'null'] },
  },
  required: ['titre', 'description', 'ref', 'organizationIds', 'organizationName'],
};

export const ORG_AWARE_LIST_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dossier: { type: 'string' },
    initiatives: {
      type: 'array',
      items: ORG_AWARE_LIST_ITEM_SCHEMA,
    },
  },
  required: ['dossier', 'initiatives'],
};

type OrgAwareListPromptOptions = {
  listHeadline: string;
  countLabel: string;
  researchFocus: string;
  itemLabelSingular: string;
  itemDescriptionLabel: string;
};

export function buildOrgAwareListPrompt(options: OrgAwareListPromptOptions): string {
  return `${options.listHeadline}

Contexte:
- Demande utilisateur: {{user_input}}
- Nom de dossier (si non vide): {{folder_name}}
- Informations de l'organisation principale: {{organization_info}}
- ${options.countLabel}: {{use_case_count}}

Organisations sélectionnées (contexte détaillé):
{{organizations_context}}

Pour chaque ${options.itemLabelSingular}, produis le meilleur appariement métier possible avec une organisation réelle pertinente.
Format: JSON

IMPORTANT:
- Génère exactement {{use_case_count}} ${options.itemDescriptionLabel} (ni plus, ni moins)
- Si {{folder_name}} est non vide, réutiliser ce nom tel quel dans le champ JSON "dossier" (ne pas inventer un autre nom)
- Si {{folder_name}} est vide, générer un nom de dossier pertinent (ne jamais utiliser "Brouillon")
- Fais une recherche avec le tool web_search pour ${options.researchFocus}. Utilise web_extract uniquement pour approfondir des résultats déjà identifiés comme pertinents.
- Base-toi sur des exemples concrets, des sources récentes et des entreprises réelles.
- Génère le titre et la description pour chaque ${options.itemLabelSingular}
- La description doit être en markdown, avec mise en exergue en gras, et le cas échéant en liste bullet point pour être percutante
- Pour chaque ${options.itemLabelSingular}, numérote les références (1, 2, 3...) et utilise [1], [2], [3] dans la description pour référencer ces numéros
- Renseigne toujours les deux clés "organizationIds" et "organizationName".
- Si une organisation déjà présente dans le workspace est clairement la meilleure cible, renseigne "organizationIds" avec son ou ses IDs et mets "organizationName" à null.
- Si aucune organisation du workspace ne convient mais qu'une entreprise réelle, existante et identifiable avec forte confiance est la meilleure cible, renseigne "organizationIds" à [] et "organizationName" avec le nom officiel ou couramment utilisé de cette entreprise.
- Si aucune entreprise réelle ne peut être identifiée avec forte confiance, renseigne "organizationIds" à [] et "organizationName" à null.
- N'invente jamais de nom d'entreprise.
- N'utilise jamais comme "organizationName" un produit, un concept, un archétype, un persona, un secteur, un département, une zone géographique seule, une administration générique ou un client type.
- Mieux vaut aucune organisation qu'une fausse organisation.
- Préfère une organisation principale claire par item. N'utilise plusieurs IDs que si c'est vraiment central au même item.

Réponds UNIQUEMENT avec un JSON valide:
{
  "dossier": "titre court du dossier",
  "initiatives": [
    {
      "titre": "titre court 1",
      "description": "Description courte (60-100 mots)",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n...",
      "organizationIds": ["org_id_1"],
      "organizationName": null
    },
    {
      "titre": "titre court 2",
      "description": "Description courte (60-100 mots)",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n...",
      "organizationIds": [],
      "organizationName": "Nom d'une entreprise réelle"
    },
    {
      "titre": "titre court 3",
      "description": "Description courte (60-100 mots)",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n...",
      "organizationIds": [],
      "organizationName": null
    }
  ]
}`;
}
