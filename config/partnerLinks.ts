export interface PartnerLink {
  name: string;
  url: string;
}

/**
 * Partner links shown on the Log Trade "no connection" screen.
 * Edit these lists to change where the broker and prop firm cards point.
 */
export const BROKER_PARTNERS: PartnerLink[] = [
  { name: 'Deriv', url: 'https://deriv.com' },
  { name: 'Fusion Markets', url: 'https://fusionmarkets.com' },
  { name: 'Pepperstone', url: 'https://pepperstone.com' },
  { name: 'IC Markets', url: 'https://www.icmarkets.com' },
];

export const PROP_FIRM_PARTNERS: PartnerLink[] = [
  { name: 'FTMO', url: 'https://ftmo.com' },
  { name: 'FundedNext', url: 'https://fundednext.com' },
];

export const BROKER_PARTNERS_CAPTION =
  'cTrader and MT5 brokers sync through the JFX desktop connection.';
