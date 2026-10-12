/**
 * Last-save receipt: what happened to the most recent manual save attempt,
 * when, and where the trade went. Surfaced in Diagnostics so a "saved but
 * missing" report is answerable without Supabase access.
 */
export type SaveKind = 'saved' | 'updated' | 'blocked-limit' | 'queued-offline' | 'failed';

/** Outcome reported by handleAddTrade so callers can navigate correctly. */
export type AddTradeOutcome = 'saved' | 'updated' | 'blocked-limit' | 'queued-offline' | 'failed';

export interface SaveReceipt {
  at: string; // ISO timestamp
  kind: SaveKind;
  detail: string;
}

const KEY = 'jfx_last_save_receipt';
let mem: SaveReceipt | null = null;

export const recordSaveReceipt = (entry: SaveReceipt): void => {
  mem = entry;
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* non-fatal */
  }
};

export const getSaveReceipt = (): SaveReceipt | null => {
  if (mem) return mem;
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.at === 'string' && typeof parsed.kind === 'string') {
      mem = parsed as SaveReceipt;
      return mem;
    }
    return null;
  } catch {
    return null;
  }
};
