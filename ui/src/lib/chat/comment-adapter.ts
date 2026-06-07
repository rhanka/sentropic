/**
 * comment-adapter.ts
 *
 * Sentropic-specific comment binding: section label keys + i18n resolution.
 * Generic comment helpers (mentions, threads, timestamps, author labels)
 * live in `@sentropic/chat-ui/comments` — import them from there.
 */

const SECTION_LABEL_KEYS: Record<string, Record<string, string>> = {
  usecase: {
    name: 'common.name',
    description: 'chat.sections.usecase.description',
    problem: 'chat.sections.usecase.problem',
    solution: 'chat.sections.usecase.solution',
    benefits: 'chat.sections.usecase.benefits',
    constraints: 'chat.sections.usecase.constraints',
    risks: 'chat.sections.usecase.risks',
    metrics: 'chat.sections.usecase.metrics',
    nextSteps: 'chat.sections.usecase.nextSteps',
    technologies: 'chat.sections.usecase.technologies',
    dataSources: 'chat.sections.usecase.dataSources',
    dataObjects: 'chat.sections.usecase.dataObjects',
    valueScores: 'chat.sections.usecase.valueScores',
    complexityScores: 'chat.sections.usecase.complexityScores',
    references: 'chat.sections.usecase.references',
    contact: 'chat.sections.usecase.contact',
    domain: 'chat.sections.usecase.domain',
    deadline: 'chat.sections.usecase.deadline',
  },
  organization: {
    name: 'common.name',
    industry: 'organization.fields.industry',
    size: 'chat.sections.organization.size',
    technologies: 'chat.sections.organization.technologies',
    products: 'chat.sections.organization.products',
    processes: 'chat.sections.organization.processes',
    kpis: 'chat.sections.organization.kpis',
    challenges: 'chat.sections.organization.challenges',
    objectives: 'chat.sections.organization.objectives',
    references: 'chat.sections.organization.references',
  },
  folder: {
    description: 'chat.sections.folder.description',
    name: 'chat.sections.folder.name',
  },
  executive_summary: {
    name: 'chat.sections.folder.name',
    introduction: 'chat.sections.executiveSummary.introduction',
    analyse: 'chat.sections.executiveSummary.analysis',
    analysis: 'chat.sections.executiveSummary.analysis',
    recommandation: 'chat.sections.executiveSummary.recommendations',
    recommendations: 'chat.sections.executiveSummary.recommendations',
    synthese_executive: 'chat.sections.executiveSummary.summary',
    synthese: 'chat.sections.executiveSummary.summary',
    summary: 'chat.sections.executiveSummary.summary',
    references: 'chat.sections.executiveSummary.references',
  },
};

export const getCommentSectionLabel = (
  type: string | null,
  key: string | null,
  translate: (key: string) => string,
): string | null => {
  if (!type) return null;
  if (!key) return translate('common.general');
  const i18nKey = SECTION_LABEL_KEYS[type]?.[key];
  return i18nKey ? translate(i18nKey) : key;
};
