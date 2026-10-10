import { Trade, AssetType } from '../types';
import { getSessionFromTime } from './trade-calculations';

const normalizeHeader = (value: string) => value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

const parseDelimitedLine = (line: string, delimiter: string) => {
    const values: string[] = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
            if (quoted && line[i + 1] === '"') {
                value += '"';
                i += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === delimiter && !quoted) {
            values.push(value.trim());
            value = '';
        } else {
            value += char;
        }
    }

    values.push(value.trim());
    return values;
};

const detectDelimiter = (line: string) => {
    const candidates = [',', '\t', ';', '|'];
    return candidates
        .map(delimiter => ({ delimiter, count: parseDelimitedLine(line, delimiter).length }))
        .sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
};

const aliases = {
    ticket: ['ticket', 'ticketid', 'order', 'ordernumber', 'deal', 'dealid', 'tradeid', 'id'],
    symbol: ['symbol', 'item', 'instrument', 'market', 'product', 'pair', 'ticker'],
    side: ['type', 'side', 'direction', 'action', 'tradetype', 'tradedirection', 'ordertype'],
    volume: ['size', 'volume', 'lots', 'lot', 'quantity', 'qty', 'units', 'contracts'],
    openTime: ['opentime', 'entrytime', 'opened', 'opendate', 'entrydate', 'starttime', 'datetime', 'date', 'tradedate'],
    closeTime: ['closetime', 'exittime', 'closed', 'closedate', 'exitdate', 'endtime'],
    openPrice: ['openprice', 'entryprice', 'open', 'entry', 'priceopen', 'averageentryprice'],
    closePrice: ['closeprice', 'exitprice', 'close', 'exit', 'priceclose', 'averageexitprice'],
    stopLoss: ['sl', 'stoploss', 'stop'],
    takeProfit: ['tp', 'takeprofit', 'target'],
    profit: ['profit', 'pnl', 'pandl', 'pl', 'netprofit', 'netpnl', 'netpl', 'realizedpnl', 'realizedpl', 'realizedprofit', 'profitloss', 'gainloss', 'netresult'],
    commission: ['commission', 'commissions', 'brokercommission'],
    swap: ['swap', 'financing', 'rollover'],
    fees: ['fee', 'fees', 'charges', 'costs'],
};

const readField = (row: Record<string, string>, names: string[]) => {
    for (const name of names) {
        const value = row[normalizeHeader(name)];
        if (value !== undefined && value.trim() !== '') return value.trim();
    }
    return '';
};

const parseNumber = (value: string) => {
    if (!value) return 0;
    const cleaned = value.replace(/[\s$€£R]/g, '').replace(/\(([^)]+)\)/, '-$1');
    const commaDecimal = cleaned.includes(',') && !cleaned.includes('.') && /,\d{1,4}$/.test(cleaned);
    const normalized = commaDecimal ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
    const parsed = Number(normalized.replace(/[^\d.+-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

const parseDateTime = (value: string) => {
    if (!value) return { date: new Date().toISOString().slice(0, 10), time: '00:00', iso: '' };

    const cleaned = value.trim().replace(/\./g, '/').replace(/\s+/g, ' ');
    const match = cleaned.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) {
        const parsed = new Date(value);
        const date = Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
        return { date, time: '00:00', iso: value };
    }

    let [, first, second, third, hour = '00', minute = '00', secondValue = '00'] = match;
    let year: string;
    let month: string;
    let day: string;
    if (first.length === 4) {
        year = first; month = second; day = third;
    } else if (Number(first) > 12) {
        day = first; month = second; year = third;
    } else if (Number(second) > 12) {
        month = first; day = second; year = third;
    } else {
        day = first; month = second; year = third;
    }
    if (year.length === 2) year = `20${year}`;

    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const time = `${hour.padStart(2, '0')}:${minute}`;
    return { date, time, iso: `${date}T${time}:${secondValue.padStart(2, '0')}` };
};

const inferAssetType = (symbol: string): AssetType => {
    const upper = symbol.toUpperCase();
    if (upper.includes('BTC') || upper.includes('ETH') || upper.includes('SOL')) return 'Crypto';
    if (upper.includes('XAU') || upper.includes('GOLD') || upper.includes('OIL') || upper.includes('XAG')) return 'Commodities';
    if (upper.includes('NAS') || upper.includes('US30') || upper.includes('GER') || upper.includes('DAX') || upper.includes('SPX')) return 'Indices';
    if (upper.includes('USD') || upper.includes('EUR') || upper.includes('GBP') || upper.includes('JPY') || upper.includes('AUD') || upper.includes('CAD')) return 'Forex';
    return 'Stocks';
};

const normalizeSide = (value: string): 'Long' | 'Short' | null => {
    const side = value.toLowerCase();
    if (/buy|long|bull/.test(side)) return 'Long';
    if (/sell|short|bear/.test(side)) return 'Short';
    return null;
};

export const parseMTTradeCSV = (text: string): Trade[] => {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const delimiter = detectDelimiter(lines[0]);
    const headerIndex = lines.findIndex(line => {
        const headers = parseDelimitedLine(line, delimiter).map(normalizeHeader);
        const hasSymbol = headers.some(header => aliases.symbol.includes(header));
        const hasPnl = headers.some(header => aliases.profit.includes(header));
        const hasSide = headers.some(header => aliases.side.includes(header));
        return hasSymbol && hasPnl && hasSide;
    });
    if (headerIndex === -1) return [];

    const headers = parseDelimitedLine(lines[headerIndex], delimiter).map(normalizeHeader);
    // MT4/MT5 history exports repeat the bare "Price" header for open and
    // close prices. A header→value map would let the close overwrite the
    // open, and neither openPrice/closePrice alias list contains generic
    // "price", so both parsed as 0. Track positional duplicates instead.
    const barePriceIdxs: number[] = [];
    headers.forEach((h, i) => { if (h === 'price') barePriceIdxs.push(i); });
    const importedTrades: Trade[] = [];

    lines.slice(headerIndex + 1).forEach((line, rowIndex) => {
        const values = parseDelimitedLine(line, delimiter);
        if (!values.some(Boolean)) return;

        const row: Record<string, string> = {};
        headers.forEach((header, index) => { row[header] = values[index] || ''; });

        const symbol = readField(row, aliases.symbol);
        const side = normalizeSide(readField(row, aliases.side));
        const profit = parseNumber(readField(row, aliases.profit));
        if (!symbol || !side) return;

        const commission = parseNumber(readField(row, aliases.commission));
        const swap = parseNumber(readField(row, aliases.swap));
        const fees = parseNumber(readField(row, aliases.fees));
        const pnl = profit + commission + swap + fees;
        const open = parseDateTime(readField(row, aliases.openTime));
        const close = parseDateTime(readField(row, aliases.closeTime) || readField(row, aliases.openTime));
        let openPriceRaw = readField(row, aliases.openPrice);
        let closePriceRaw = readField(row, aliases.closePrice);
        if (barePriceIdxs.length >= 2) {
            openPriceRaw = values[barePriceIdxs[0]] || openPriceRaw;
            closePriceRaw = values[barePriceIdxs[1]] || closePriceRaw;
        } else if (barePriceIdxs.length === 1 && !openPriceRaw) {
            openPriceRaw = values[barePriceIdxs[0]];
        }
        const openPrice = parseNumber(openPriceRaw);
        const closePrice = parseNumber(closePriceRaw);
        const stopLoss = parseNumber(readField(row, aliases.stopLoss));
        const takeProfit = parseNumber(readField(row, aliases.takeProfit));
        const ticket = readField(row, aliases.ticket) || `row-${rowIndex + 1}`;

        importedTrades.push({
            id: `imported-${ticket}-${rowIndex}`,
            ticketId: ticket,
            pair: symbol.toUpperCase(),
            assetType: inferAssetType(symbol),
            date: close.date,
            time: close.time,
            session: getSessionFromTime(close.time),
            direction: side,
            entryPrice: openPrice,
            exitPrice: closePrice,
            stopLoss,
            takeProfit,
            lots: parseNumber(readField(row, aliases.volume)),
            result: pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'BE',
            pnl,
            commissions: commission,
            fees,
            swap,
            rr: stopLoss && openPrice && takeProfit ? Math.abs(openPrice - takeProfit) / Math.abs(openPrice - stopLoss) : 0,
            rating: 0,
            tags: ['Imported'],
            notes: `Imported trade ${ticket}`,
            planAdherence: 'No Plan',
            mindset: 'Neutral',
            emotions: [],
            openTime: open.iso,
            closeTime: close.iso,
        });
    });

    return importedTrades;
};
