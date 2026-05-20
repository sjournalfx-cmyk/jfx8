import { getSASTDateTime } from './timeUtils';

export type PsychologyInsightsEntry = {
  date: string;
  generatedAt: string;
  content: string;
};

export type PsychologyInsightsCache = Record<string, PsychologyInsightsEntry>;

export const PSYCHOLOGY_INSIGHTS_STORAGE_KEY = 'jfx_psychology_key_insights_by_scope_v2';

export const getPsychologyInsightsDayKey = (date = new Date()) => getSASTDateTime(date).date;

export const getPsychologyInsightsScopeKey = (userId?: string | null, isDemoMode = false) => (
  `${isDemoMode ? 'demo' : 'live'}:${userId || 'guest'}`
);

export const buildPsychologyInsightsPrompt = (sourceFacts: unknown) => `
Generate the trader's daily Key Insights & Warnings.

Use exactly one section:
[SECTION:KEY_INSIGHTS_WARNINGS]

Inside that section, use this structure:
### Key Insights
- 3 to 5 concise cards grounded in the private journal context
- Format each item as \`Title: detail\`

### Warnings
- 2 to 3 concise warning cards or risks that need attention
- Format each item as \`Title: detail\`

### Immediate Action
- 1 short action card the trader should take next
- Format it as \`Title: detail\`

Rules:
- Use only the facts in SOURCE FACTS below.
- Do not invent any trade, metric, percentage, amount, pattern, or count that is not explicitly present in SOURCE FACTS.
- Do not calculate new percentages or dollar values unless the exact value already appears in SOURCE FACTS.
- If there is not enough evidence for a claim, write that the evidence is insufficient or unavailable.
- Do not return only the section tag or only headings without content.
- Do not repeat [SECTION:KEY_INSIGHTS_WARNINGS] inside the body.
- Be specific, practical, and direct.
- Do not mention the model, provider, or internal reasoning.
- Return only the section content. No preamble, no code fences.

SOURCE FACTS
${JSON.stringify(sourceFacts, null, 2)}
`.trim();

export const extractSectionBody = (content: string, sectionName: string) => {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`\\[SECTION:${escaped}\\]([\\s\\S]*?)(?=\\[SECTION:[A-Z_]+\\]|$)`));
  return match?.[1]?.trim() || '';
};
