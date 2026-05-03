import { NVIDIA_CHAT_MODEL_ID } from './nvidiaAiService';

export type NotebookPromptPreset = 'expand' | 'rewrite' | 'bulletize' | 'summarize';

export type NotebookListItem = {
  text: string;
};

export type NotebookTableData = {
  rows: Array<Array<{ text: string }>>;
};

export const NOTEBOOK_PROMPT_PRESETS: Array<{
  id: NotebookPromptPreset;
  label: string;
  description: string;
}> = [
  {
    id: 'expand',
    label: 'Expand',
    description: 'Add more useful detail and structure.',
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Polish the note while keeping the meaning.',
  },
  {
    id: 'bulletize',
    label: 'Bulletize',
    description: 'Turn the note into short bullet points or checklist items.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Compress the note into the key points only.',
  },
];

export const shouldReplaceNotebookContent = (preset: NotebookPromptPreset) => (
  preset === 'rewrite' || preset === 'bulletize' || preset === 'summarize'
);

type NotebookAiOptions = {
  preset?: NotebookPromptPreset;
  title?: string;
  content?: string;
  currentContent?: string;
  isList?: boolean;
  listItems?: NotebookListItem[];
  tableData?: NotebookTableData;
};

const BASE_URL = '/api/nvidia';

const stripOuterCodeFence = (value: string) => {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed
    .replace(/^```(?:[a-zA-Z0-9_-]+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
};

export const cleanNotebookAiText = (value: string) => {
  let text = (value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  text = stripOuterCodeFence(text);
  text = text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  text = text.replace(/^(here(?:'s| is)|sure[,! ]+here(?:'s| is)|absolutely[,! ]+here(?:'s| is))\s+(?:the\s+)?/i, '');
  text = text.replace(/^(improved|rewritten|expanded|summary|bullets?|checklist)(?:\s+version)?[:\-]\s*/i, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
};

export const splitNotebookLines = (value: string) => {
  return cleanNotebookAiText(value)
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
};

const buildSourceBlock = (options: NotebookAiOptions) => {
  const parts: string[] = [];

  if (options.title?.trim()) {
    parts.push(`Title: ${options.title.trim()}`);
  }

  if (options.currentContent?.trim()) {
    parts.push(`Current content:\n${options.currentContent.trim()}`);
  } else if (options.content?.trim()) {
    parts.push(`Current content:\n${options.content.trim()}`);
  }

  if (options.isList) {
    const items = (options.listItems || [])
      .map((item) => item.text.trim())
      .filter(Boolean);
    if (items.length > 0) {
      parts.push(`List items:\n- ${items.join('\n- ')}`);
    }
  }

  if (options.tableData?.rows?.length) {
    const rows = options.tableData.rows
      .map((row) => row.map((cell) => cell.text.trim()).join(' | '))
      .join('\n');
    parts.push(`Table data:\n${rows}`);
  }

  return parts.join('\n\n');
};

const buildPresetPrompt = (options: NotebookAiOptions) => {
  const source = buildSourceBlock(options);
  const preset = options.preset || 'rewrite';

  const presetInstructions: Record<NotebookPromptPreset, string> = {
    expand: 'Expand this note with clearer structure, more context, and practical detail. Keep it notebook-ready.',
    rewrite: 'Rewrite this note cleanly and naturally while preserving the original meaning.',
    bulletize: 'Turn this note into concise bullets or checklist items. Keep each line focused and useful.',
    summarize: 'Summarize this note into a shorter version with only the essential points.',
  };

  const listNote = options.isList
    ? '\nIf the content is a list, keep it as a list or checklist format.'
    : '';
  const tableNote = options.tableData
    ? '\nIf the content is a table, preserve the table-friendly structure and keep entries concise.'
    : '';

  return [
    presetInstructions[preset],
    'Do not mention the provider or model in the output.',
    'Return only the note content. No preamble, no explanation, no markdown fences.',
    listNote,
    tableNote,
    source ? `\nSource:\n${source}` : '',
  ].join('\n').trim();
};

const hasNvidiaKey = () => Boolean(import.meta.env.VITE_NVIDIA_API_KEY);

async function requestNotebookCompletion(prompt: string): Promise<string> {
  if (!hasNvidiaKey()) {
    throw new Error('NVIDIA API key is not configured.');
  }

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NVIDIA_CHAT_MODEL_ID,
      messages: [
        {
          role: 'system',
          content: 'You are a concise notebook writing assistant. Return only the text to insert into the note.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 512,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`NVIDIA API error: ${response.status} - ${error}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content || '';
  return cleanNotebookAiText(content);
}

export const generateNotebookDraft = async (options: NotebookAiOptions): Promise<string> => {
  const prompt = buildPresetPrompt(options);
  return requestNotebookCompletion(prompt);
};

export const insertTextAtSelection = (
  target: HTMLTextAreaElement | null,
  currentValue: string,
  insertion: string
) => {
  if (!target) {
    const nextValue = currentValue ? `${currentValue}\n\n${insertion}` : insertion;
    return {
      nextValue,
      nextSelectionStart: nextValue.length,
      nextSelectionEnd: nextValue.length,
    };
  }

  const start = target.selectionStart ?? currentValue.length;
  const end = target.selectionEnd ?? currentValue.length;
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const needsSpacingBefore = before.length > 0 && !/\n\n$/.test(before) && !before.endsWith('\n');
  const needsSpacingAfter = after.length > 0 && !after.startsWith('\n') ? '\n\n' : '';
  const nextValue = `${before}${needsSpacingBefore ? '\n\n' : ''}${insertion}${needsSpacingAfter}${after}`;
  const nextSelectionStart = (before + (needsSpacingBefore ? '\n\n' : '') + insertion).length;
  return {
    nextValue,
    nextSelectionStart,
    nextSelectionEnd: nextSelectionStart,
  };
};
