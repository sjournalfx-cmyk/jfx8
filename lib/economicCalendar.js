import { JSDOM } from 'jsdom';

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_NAMES = new Set(Object.keys(MONTHS));
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TFOOT',
  'THEAD', 'TR', 'TD', 'TH', 'UL',
]);

const TIME_RE = /^\d{1,2}:\d{2}\s*[AP]M$/i;
const DAY_RE = /^\d{1,2}$/;
const MONTH_YEAR_RE = /^([A-Za-z]+)\s+(\d{4})$/;

const normalizeLine = (value) => String(value || '')
  .replace(/\u00a0/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const toIsoDate = (year, monthIndex, day) => {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
};

const extractVisibleLines = (html) => {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const lines = [];
  let buffer = '';

  const flush = () => {
    const line = normalizeLine(buffer);
    if (line) lines.push(line);
    buffer = '';
  };

  const append = (text) => {
    const normalized = normalizeLine(text);
    if (!normalized) return;
    buffer = buffer ? `${buffer} ${normalized}` : normalized;
  };

  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      append(node.textContent);
      return;
    }
    if (node.nodeType !== 1) return;

    const element = node;
    const tagName = element.tagName;
    if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT') return;
    if (tagName === 'BR' || tagName === 'HR') {
      flush();
      return;
    }

    const isBlock = BLOCK_TAGS.has(tagName);
    if (isBlock) flush();

    for (const child of element.childNodes) {
      walk(child);
    }

    if (isBlock) flush();
  };

  for (const child of document.body?.childNodes || []) {
    walk(child);
  }

  flush();
  return lines;
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (economic-calendar)',
      'accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response.text();
};

const classifyBlsImpact = (title, detail) => {
  const text = `${title} ${detail || ''}`.toLowerCase();
  if (/(consumer price index|producer price index|employment situation|job openings|labor turnover|inflation|unemployment|payroll|employment cost index|import and export price indexes)/.test(text)) {
    return 'high';
  }
  if (/(fomc|fed|interest rate|policy|meeting|productivity|real earnings|wages|county employment|state employment|metropolitan area employment)/.test(text)) {
    return 'medium';
  }
  return 'low';
};

const classifyFedImpact = () => 'high';

const parseBlsCalendar = (html) => {
  const lines = extractVisibleLines(html);
  const calendarStart = lines.findIndex((line) => line === 'Monday Tuesday Wednesday Thursday Friday');
  if (calendarStart === -1) return [];

  const headerLine = lines.slice(calendarStart + 1).find((line) => MONTH_YEAR_RE.test(line));
  const headerMatch = headerLine?.match(MONTH_YEAR_RE);
  if (!headerMatch) return [];

  const baseMonthName = headerMatch[1].toLowerCase();
  const baseMonthIndex = MONTHS[baseMonthName];
  const baseYear = Number(headerMatch[2]);
  if (!MONTH_NAMES.has(baseMonthName) || Number.isNaN(baseMonthIndex) || Number.isNaN(baseYear)) return [];

  const events = [];
  let currentMonthIndex = baseMonthIndex;
  let currentYear = baseYear;
  let previousDay = 0;
  let currentDate = '';

  for (let i = calendarStart + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === 'Monday Tuesday Wednesday Thursday Friday') continue;
    if (line.startsWith('NOTE:') || line.startsWith('Last Modified Date:')) break;

    if (DAY_RE.test(line)) {
      const day = Number(line);
      if (previousDay && day < previousDay && previousDay > 20) {
        currentMonthIndex += 1;
        if (currentMonthIndex > 11) {
          currentMonthIndex = 0;
          currentYear += 1;
        }
      }
      previousDay = day;
      currentDate = toIsoDate(currentYear, currentMonthIndex, day);
      continue;
    }

    if (!currentDate) continue;

    const next = lines[i + 1];
    const next2 = lines[i + 2];
    if (!next) continue;

    if (next === 'Holiday') {
      events.push({
        source: 'BLS',
        title: line,
        date: currentDate,
        detail: 'Holiday',
        impact: 'low',
        country: 'United States',
        category: 'Holiday',
      });
      i += 1;
      continue;
    }

    if (TIME_RE.test(next)) {
      events.push({
        source: 'BLS',
        title: line,
        date: currentDate,
        time: next,
        detail: '',
        impact: classifyBlsImpact(line, ''),
        country: 'United States',
        category: 'Economic release',
      });
      i += 1;
      continue;
    }

    if (next2 && TIME_RE.test(next2)) {
      events.push({
        source: 'BLS',
        title: line,
        date: currentDate,
        detail: next,
        time: next2,
        impact: classifyBlsImpact(line, next),
        country: 'United States',
        category: 'Economic release',
      });
      i += 2;
    }
  }

  return events;
};

const parseFedCalendar = (html) => {
  const lines = extractVisibleLines(html);
  const headingIndex = lines.findIndex((line) => /^2026 FOMC Meetings$/.test(line) || /^####\s+2026 FOMC Meetings$/.test(line));
  if (headingIndex === -1) return [];

  const events = [];
  let currentYear = 2026;
  let currentMonthIndex = null;

  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^2025 FOMC Meetings$/.test(line) || /^####\s+2025 FOMC Meetings$/.test(line)) break;

    const yearMatch = line.match(/^####\s+(\d{4}) FOMC Meetings$/) || line.match(/^(\d{4}) FOMC Meetings$/);
    if (yearMatch) {
      currentYear = Number(yearMatch[1]);
      currentMonthIndex = null;
      continue;
    }

    const monthName = line.toLowerCase();
    if (MONTH_NAMES.has(monthName)) {
      currentMonthIndex = MONTHS[monthName];
      continue;
    }

    if (currentMonthIndex == null) continue;

    const notationMatch = line.match(/^(\d{1,2}) \(notation vote\)$/i);
    if (notationMatch) {
      const day = Number(notationMatch[1]);
      events.push({
        source: 'Fed',
        title: 'FOMC notation vote',
        date: toIsoDate(currentYear, currentMonthIndex, day),
        detail: 'Policy notation vote',
        impact: 'medium',
        country: 'United States',
        category: 'Monetary policy',
      });
      continue;
    }

    const meetingMatch = line.match(/^(\d{1,2})(?:-(\d{1,2}))?\*?$/);
    if (!meetingMatch) continue;

    const startDay = Number(meetingMatch[1]);
    const endDay = meetingMatch[2] ? Number(meetingMatch[2]) : undefined;
    const lookahead = lines.slice(i + 1, i + 8);
    const hasPressConference = lookahead.includes('Press Conference');
    const hasProjectionMaterials = lookahead.includes('Projection Materials');

    const detailParts = ['Statement'];
    if (hasPressConference) detailParts.push('Press conference');
    if (hasProjectionMaterials) detailParts.push('Projection materials');

    events.push({
      source: 'Fed',
      title: 'FOMC Meeting',
      date: toIsoDate(currentYear, currentMonthIndex, startDay),
      endDate: endDay != null ? toIsoDate(currentYear, currentMonthIndex, endDay) : undefined,
      detail: detailParts.join(' • '),
      impact: classifyFedImpact(),
      country: 'United States',
      category: 'Monetary policy',
    });
  }

  return events;
};

const parseDateInput = (value) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isWithinRange = (event, fromTs, toTs) => {
  const startTs = Date.parse(`${event.date}T00:00:00Z`);
  const endTs = Date.parse(`${(event.endDate || event.date)}T23:59:59Z`);
  if (Number.isNaN(startTs) || Number.isNaN(endTs)) return false;
  return endTs >= fromTs && startTs <= toTs;
};

export const fetchPublicEconomicCalendar = async ({ from, to } = {}) => {
  const [blsResult, fedResult] = await Promise.allSettled([
    fetchText('https://www.bls.gov/schedule/news_release/').then(parseBlsCalendar),
    fetchText('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm').then(parseFedCalendar),
  ]);

  const warnings = [];
  const blsEvents = blsResult.status === 'fulfilled'
    ? blsResult.value
    : (warnings.push(`BLS: ${blsResult.reason?.message || String(blsResult.reason)}`), []);
  const fedEvents = fedResult.status === 'fulfilled'
    ? fedResult.value
    : (warnings.push(`Fed: ${fedResult.reason?.message || String(fedResult.reason)}`), []);

  const fromTs = parseDateInput(from) ?? Date.parse('1970-01-01T00:00:00Z');
  const toTs = parseDateInput(to) ?? Date.parse('9999-12-31T23:59:59Z');

  const data = [...blsEvents, ...fedEvents]
    .filter((event) => isWithinRange(event, fromTs, toTs))
    .sort((a, b) => {
      const aStart = Date.parse(`${a.date}T00:00:00Z`);
      const bStart = Date.parse(`${b.date}T00:00:00Z`);
      if (aStart !== bStart) return aStart - bStart;
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      return a.title.localeCompare(b.title);
    });

  return {
    data,
    warnings,
    source: ['BLS', 'Fed'],
  };
};
