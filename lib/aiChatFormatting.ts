const STRUCTURED_WIDGET_REGEX = /\[WIDGET:(CHECKLIST|MERMAID)(?::[^\]]+)?\][\s\S]*?\[\/WIDGET:\1\]/g;

const preserveStructuredWidgets = (text: string) => {
  const widgets: string[] = [];
  const masked = text.replace(STRUCTURED_WIDGET_REGEX, (match) => {
    const token = `__JFX_WIDGET_${widgets.length}__`;
    widgets.push(match);
    return token;
  });

  return { masked, widgets };
};

const restoreStructuredWidgets = (text: string, widgets: string[]) => (
  widgets.reduce((result, widget, index) => (
    result.replace(`__JFX_WIDGET_${index}__`, widget)
  ), text)
);

const stripLeakedToolCalls = (text: string) => (
  text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[^>\n]+>\s*(?:<parameter=[^>\n]+>[\s\S]*?<\/parameter>\s*)*<\/function>/gi, '')
);

export const stripAssistantWidgetMarkup = (text: string): string => {
  if (!text) return '';

  return text
    .replace(/\[WIDGET:CHECKLIST(?::[^\]]+)?\]([\s\S]*?)(?:\[\/WIDGET:CHECKLIST\]|\[\/WIDGET\])/gi, (_match, body: string) => body.trim())
    .replace(/\[WIDGET:MERMAID(?::[^\]]+)?\][\s\S]*?(?:\[\/WIDGET:MERMAID\]|\[\/WIDGET\])/gi, '')
    .replace(/\[\/?WIDGET(?::[A-Z]+)?(?::[^\]]+)?\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const normalizeAssistantMarkdown = (text: string): string => {
  if (!text) return '';

  const { masked, widgets } = preserveStructuredWidgets(stripLeakedToolCalls(text).replace(/\r\n/g, '\n').trim());
  let result = masked;

  result = result.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
  result = result.replace(/\n{3,}/g, '\n\n');

  return restoreStructuredWidgets(result.trim(), widgets);
};
