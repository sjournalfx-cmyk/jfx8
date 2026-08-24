export const genId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const COLUMN_WIDTH_INC = 80;

export const CANVAS_MIN_WIDTH = 480;
export const CANVAS_MAX_WIDTH = 2000;

export const MIN_TABLE_ROWS = 1;
export const MIN_TABLE_COLS = 1;

export const AUTOSAVE_DELAY_MS = 400;
