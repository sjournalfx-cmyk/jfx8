// Plain-ESM copy of the ProtoOA payload-type constants used by the harvester.
// Keep values in sync with api/_lib/protoTypes.ts and services/ctraderService.ts.
export const PT = {
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  ERROR_RES: 2142,
  HEARTBEAT_EVENT: 51,
};

export const WS_DEMO = 'wss://demo.ctraderapi.com:5036';
export const WS_LIVE = 'wss://live.ctraderapi.com:5036';

export function mapTimeframeToCtraderPeriod(tf) {
  const norm = String(tf || '').toUpperCase().trim();
  switch (norm) {
    case 'M1': case '1M': return 1;
    case 'M2': case '2M': return 2;
    case 'M3': case '3M': return 3;
    case 'M4': case '4M': return 4;
    case 'M5': case '5M': return 5;
    case 'M10': case '10M': return 6;
    case 'M15': case '15M': return 7;
    case 'M30': case '30M': return 8;
    case 'H1': case '1H': return 9;
    case 'H4': case '4H': return 10;
    case 'D1': case '1D': return 11;
    case 'W1': case '1W': return 12;
    case 'MN1': case 'MN': return 13;
    default: return 9;
  }
}
