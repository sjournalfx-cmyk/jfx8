
export const ANALYTICS_TIMEZONE = 'Africa/Johannesburg';
export const ANALYTICS_TIMEZONE_LABEL = 'SAST';

export const getSASTDateTime = (date = new Date()) => {
    // Validate date - if invalid, use current date
    const validDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    
    // 1. Get components in SAST
    const sastFormatter = new Intl.DateTimeFormat('en-ZA', {
        timeZone: 'Africa/Johannesburg',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const parts = sastFormatter.formatToParts(validDate);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value;
    
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const second = getPart('second');

    const formattedDate = `${year}-${month}-${day}`;
    const formattedTime = `${hour}:${minute}`;
    const formattedFullTime = `${hour}:${minute}:${second}`;
    
    // 2. Get Day Index (0-6) reliably for SAST
    // We create a date object that represents the SAST time as if it were UTC, 
    // then get the day of the week from it.
    const sastDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    const dayIndex = sastDate.getUTCDay(); // 0 (Sun) to 6 (Sat)
    
    return { 
        date: formattedDate, 
        time: formattedTime, 
        fullTime: formattedFullTime,
        dayIndex: dayIndex,
        hour: parseInt(hour || '0')
    };
};

const TIME_ONLY_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const DATE_TIME_MINUTES_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_TIME_SECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const HAS_TIMEZONE_RE = /(Z|[+-]\d{2}:\d{2})$/;

const parseDateTimeInSast = (value: string) => {
    if (TIME_ONLY_RE.test(value)) return null;

    let normalized = value;
    if (!HAS_TIMEZONE_RE.test(value)) {
        if (DATE_TIME_MINUTES_RE.test(value)) {
            normalized = `${value}:00+02:00`;
        } else if (DATE_TIME_SECONDS_RE.test(value)) {
            normalized = `${value}+02:00`;
        }
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getSastHourFromTime = (value?: string | null): number | null => {
    if (!value) return null;

    if (TIME_ONLY_RE.test(value)) {
        const [hour] = value.split(':').map(Number);
        return Number.isFinite(hour) ? hour : null;
    }

    const parsed = parseDateTimeInSast(value);
    if (!parsed) return null;

    const hourParts = new Intl.DateTimeFormat('en-ZA', {
        timeZone: ANALYTICS_TIMEZONE,
        hour: '2-digit',
        hour12: false,
    }).formatToParts(parsed);

    const hour = Number(hourParts.find(part => part.type === 'hour')?.value);
    return Number.isFinite(hour) ? hour : null;
};

export const getSastHourFromTrade = (trade?: { date?: string; time?: string; openTime?: string; closeTime?: string }) => {
    if (!trade) return null;

    const candidates = [
        trade.openTime,
        trade.time,
        trade.date && trade.time ? `${trade.date}T${trade.time}` : null,
        trade.closeTime,
    ];

    for (const candidate of candidates) {
        const hour = getSastHourFromTime(candidate);
        if (hour !== null) return hour;
    }

    return null;
};

export const getSastWeekdayFromDate = (date?: string | null) => {
    if (!date) return null;

    const parsed = new Date(`${date}T12:00:00+02:00`);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed.toLocaleDateString('en-US', {
        timeZone: ANALYTICS_TIMEZONE,
        weekday: 'short',
    });
};
