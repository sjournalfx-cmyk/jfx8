const randomPart = (): string => {
  const value = Math.random().toString(36).slice(2, 10);
  return value.padEnd(6, '0');
};

export const genId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Secure contexts (and test runners without crypto.randomUUID) still need
  // ids that stay unique across rapid calls.
  return `${Date.now().toString(36)}-${randomPart()}${randomPart()}`;
};

export const COLUMN_WIDTH_INC = 80;

export const CANVAS_MIN_WIDTH = 480;
export const CANVAS_MAX_WIDTH = 2000;

export const MIN_TABLE_ROWS = 1;
export const MIN_TABLE_COLS = 1;

export const AUTOSAVE_DELAY_MS = 400;
