
import { supabase } from '../lib/supabase';
import { Trade, Note, DailyBias, UserProfile, Goal, StrategyDiagram, DBTrade, DBGoal, BacktestSession, CashTransaction, DBCashTransaction } from '../types';
import { APP_CONSTANTS, PLAN_FEATURES, normalizePlan } from '../lib/constants';
import { normalizeTrade } from '../lib/trade-normalization';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toStringArray = (value: unknown, fallback: string[] = []): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
};

const toSafeString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

// Helper to map DB Trade to App Trade
export const mapTradeFromDB = (dbTrade: DBTrade): Trade => normalizeTrade({
  id: dbTrade.id,
  ticketId: dbTrade.ticket_id || undefined,
  pair: dbTrade.pair || '',
  assetType: dbTrade.asset_type || 'Forex',
  date: dbTrade.date || '',
  time: dbTrade.time || '',
  session: dbTrade.session || 'London Session',
  direction: dbTrade.direction || 'Long',
  entryPrice: toFiniteNumber(dbTrade.entry_price, 0),
  exitPrice: dbTrade.exit_price !== undefined && dbTrade.exit_price !== null ? toFiniteNumber(dbTrade.exit_price, 0) : undefined,
  stopLoss: toFiniteNumber(dbTrade.stop_loss, 0),
  takeProfit: toFiniteNumber(dbTrade.take_profit, 0),
  lots: toFiniteNumber(dbTrade.lots, 0),
  result: dbTrade.result || 'Pending',
  pnl: toFiniteNumber(dbTrade.pnl, 0),
  commissions: dbTrade.commissions !== undefined ? toFiniteNumber(dbTrade.commissions, 0) : undefined,
  fees: dbTrade.fees !== undefined ? toFiniteNumber(dbTrade.fees, 0) : undefined,
  swap: dbTrade.swap !== undefined ? toFiniteNumber(dbTrade.swap, 0) : undefined,
  rr: toFiniteNumber(dbTrade.rr, 0),
  rating: toFiniteNumber(dbTrade.rating, 0),
  tags: dbTrade.tags || [],
  notes: dbTrade.notes || undefined,
  emotions: dbTrade.emotions || [],
  planAdherence: dbTrade.plan_adherence,
  tradingMistake: dbTrade.trading_mistake,
  mindset: dbTrade.mindset,
  exitComment: dbTrade.exit_comment,
  voiceNote: dbTrade.voice_note,
  openTime: dbTrade.open_time,
  closeTime: dbTrade.close_time,
  beforeScreenshot: dbTrade.before_screenshot,
  afterScreenshot: dbTrade.after_screenshot,
  setupId: dbTrade.setup_id,
  setupName: dbTrade.setup_name,
  deletedAt: dbTrade.deleted_at,
  chartCandles: dbTrade.chart_candles || undefined,
  chartTimeframe: dbTrade.chart_timeframe || undefined,
});

// Helper to map App Trade to DB Trade
const buildTradeDbPayload = (trade: Partial<Trade>, userId: string, fallback: Partial<Trade> = {}): Partial<DBTrade> => {
  const merged = normalizeTrade(
    {
      ...fallback,
      ...trade,
      id: toSafeString(trade.id, toSafeString(fallback.id, crypto.randomUUID())),
    },
    fallback
  );

  return {
    user_id: userId,
    ticket_id: merged.ticketId,
    pair: merged.pair,
    asset_type: merged.assetType,
    date: merged.date,
    time: merged.time,
    session: merged.session,
    direction: merged.direction,
    entry_price: merged.entryPrice,
    exit_price: merged.exitPrice,
    stop_loss: merged.stopLoss,
    take_profit: merged.takeProfit,
    lots: merged.lots,
    result: merged.result,
    pnl: merged.pnl,
    commissions: merged.commissions,
    fees: merged.fees,
    swap: merged.swap,
    rr: merged.rr,
    rating: merged.rating,
    tags: merged.tags,
    notes: merged.notes,
    emotions: merged.emotions,
    plan_adherence: merged.planAdherence,
    trading_mistake: merged.tradingMistake,
    mindset: merged.mindset,
    exit_comment: merged.exitComment,
    voice_note: merged.voiceNote,
    open_time: merged.openTime,
    close_time: merged.closeTime,
    before_screenshot: merged.beforeScreenshot,
    after_screenshot: merged.afterScreenshot,
    setup_id: merged.setupId || null,
    setup_name: merged.setupName || null,
    deleted_at: merged.deletedAt,
    chart_candles: merged.chartCandles || null,
    chart_timeframe: merged.chartTimeframe || null,
  };
};

// Helper to map DB Cash Transaction to App Cash Transaction
export const mapCashTransactionFromDB = (dbTx: DBCashTransaction): CashTransaction => ({
  id: dbTx.id,
  type: dbTx.type,
  amount: normalizeCashTransactionAmount({
    type: dbTx.type,
    amount: Number(dbTx.amount || 0),
  } as CashTransaction),
  date: dbTx.date,
  description: dbTx.description,
});

const normalizeCashTransactionAmount = (tx: Pick<CashTransaction, 'type' | 'amount'>) => {
  const amount = Number(tx.amount || 0);
  if (!Number.isFinite(amount)) return 0;

  switch (tx.type) {
    case 'Deposit':
    case 'Interest':
    case 'Promotion':
      return Math.abs(amount);
    case 'Withdrawal':
    case 'Fee':
    case 'Tax':
      return -Math.abs(amount);
    case 'Transfer':
    default:
      return amount;
  }
};

const CASH_TRANSACTION_CACHE_PREFIX = 'jfx_cash_transactions_cache_';
let cashTransactionsBackendUnavailable = false;

const getCashTransactionCacheKey = (userId: string) => `${CASH_TRANSACTION_CACHE_PREFIX}${userId}`;

const readCashTransactionCache = (userId: string): CashTransaction[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(getCashTransactionCacheKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((tx: any) => ({
        id: String(tx.id || crypto.randomUUID()),
        type: tx.type,
        amount: normalizeCashTransactionAmount({
          type: tx.type,
          amount: tx.amount,
        } as CashTransaction),
        date: tx.date,
        description: tx.description || '',
      }))
      .filter((tx: CashTransaction) => !!tx.type && !!tx.date);
  } catch (error) {
    console.warn('Failed to read cash transaction cache:', error);
    return [];
  }
};

const writeCashTransactionCache = (userId: string, transactions: CashTransaction[]) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getCashTransactionCacheKey(userId), JSON.stringify(transactions));
  } catch (error) {
    console.warn('Failed to write cash transaction cache:', error);
  }
};

const upsertCashTransactionCache = (userId: string, transaction: CashTransaction) => {
  const next = readCashTransactionCache(userId).filter(tx => tx.id !== transaction.id);
  next.unshift(transaction);
  writeCashTransactionCache(userId, next);
  return next;
};

const removeCashTransactionFromCache = (userId: string, transactionId: string) => {
  const next = readCashTransactionCache(userId).filter(tx => tx.id !== transactionId);
  writeCashTransactionCache(userId, next);
  return next;
};

const notifyCashTransactionsChanged = (userId: string) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('jfx-cash-transactions-changed', {
    detail: { userId }
  }));
};

const notifyCashTransactionsAvailability = (available: boolean) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('jfx-cash-transactions-availability', {
    detail: { available }
  }));
};

const isMissingCashTransactionsTableError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.status === 404 ||
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    message.includes('cash_transactions') ||
    message.includes('does not exist')
  );
};

// Helper to map App Cash Transaction to DB Cash Transaction
const mapCashTransactionToDB = (tx: CashTransaction, userId: string): Partial<DBCashTransaction> => ({
  user_id: userId,
  type: tx.type,
  amount: normalizeCashTransactionAmount(tx),
  date: tx.date,
  description: tx.description,
});

// Helper to map DB Goal to App Goal
export const mapGoalFromDB = (dbGoal: DBGoal): Goal => ({
  id: dbGoal.id,
  title: dbGoal.title,
  description: dbGoal.description,
  type: dbGoal.type,
  metric: dbGoal.metric,
  targetValue: Number(dbGoal.target_value || 0),
  startValue: Number(dbGoal.start_value || 0),
  startDate: dbGoal.start_date,
  endDate: dbGoal.end_date,
  status: dbGoal.status,
  createdAt: dbGoal.created_at,
  milestones: dbGoal.milestones || [],
  manualProgress: Number(dbGoal.current_value || 0),
  autoTrackRule: dbGoal.auto_track_rule,
  manualEntries: dbGoal.manual_entries || []
});

const uploadImage = async (userId: string, imageSource: string | undefined, type: 'before' | 'after'): Promise<string | undefined> => {
  if (!imageSource) return undefined;
  if (imageSource.startsWith('http')) return imageSource;

  try {
    // Convert base64 to Blob
    const response = await fetch(imageSource);
    const blob = await response.blob();

    // 1MB Limit check for sanity
    if (blob.size > 1024 * 1024) {
      console.warn(`Image ${type} is too large (${(blob.size / 1024).toFixed(1)}KB). Consider compressing.`);
    }

    const fileExt = 'png'; 
    const fileName = `${userId}/${Date.now()}-${type}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('trade-images')
      .upload(fileName, blob, {
        contentType: blob.type,
        upsert: true
      });

    if (error) {
      if (error.message === 'The resource was not found') {
        throw new Error('Storage bucket "trade-images" not found. Please create it in Supabase.');
      }
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('trade-images')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (err) {
    console.error(`Error uploading ${type} screenshot:`, err);
    // If it's a base64 string and upload failed, we only return it if it's small enough
    // to avoid DB payload errors (limit to ~100KB for inline storage)
    if (imageSource.length < 150000) {
      return imageSource; 
    }
    return undefined; // Drop it rather than crashing the DB save
  }
};

export const uploadNoteImage = async (file: File): Promise<string | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Check user plan limits
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    const currentPlan = profile?.plan || APP_CONSTANTS.PLANS.FREE;
    if (!PLAN_FEATURES[currentPlan]?.allowImageUploads) {
      alert('Image uploads are not available on your current plan. Please upgrade.');
      return null;
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `notes/${user.id}/${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('trade-images') // Reusing existing bucket
      .upload(fileName, file, {
        contentType: file.type,
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('trade-images')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (err) {
    console.error('Error uploading note image:', err);
    return null;
  }
};

const deleteImageFile = async (imageUrl: string | undefined) => {
  if (!imageUrl || !imageUrl.includes('trade-images')) return;

  try {
    // Extract path from public URL
    // URL format: .../storage/v1/object/public/trade-images/userId/filename.png
    const pathParts = imageUrl.split('trade-images/');
    if (pathParts.length < 2) return;

    const filePath = pathParts[1];

    const { error } = await supabase.storage
      .from('trade-images')
      .remove([filePath]);

    if (error) throw error;
  } catch (err) {
    console.error('Error deleting image file:', err);
  }
};

export const dataService = {
  // --- Audit Logs ---
  async logActivity(action: string, details: Record<string, any>) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('audit_logs').insert({
        user_id: user.id,
        action,
        details,
        ip_address: 'client-side',
        user_agent: navigator.userAgent
      });
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  },

  // --- Trades ---
  async getTrades(userId: string) {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('date', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapTradeFromDB);
  },

  async getMonthlyTradeCount(userId: string, year: number, month: number) {
    // Month is 1-indexed for the DB query (YYYY-MM-DD)
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    const { count, error } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;
    return count || 0;
  },

  async addTrade(trade: Trade) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const normalizedInput = normalizeTrade(trade, {}, { preserveProvidedPnl: trade.ticketId !== undefined });

    // Upload images if they are base64 (keep awaiting images as they are small and critical)
    const beforeUrl = await uploadImage(user.id, normalizedInput.beforeScreenshot, 'before');
    const afterUrl = await uploadImage(user.id, normalizedInput.afterScreenshot, 'after');

    const tradeToSave = {
      ...normalizedInput,
      beforeScreenshot: beforeUrl,
      afterScreenshot: afterUrl,
    };

    const dbTrade = buildTradeDbPayload(tradeToSave, user.id);

    // If it has a ticketId, we want to prevent duplicates
    if (dbTrade.ticket_id) {
      const { data: existing } = await supabase
        .from('trades')
        .select('id')
        .eq('user_id', user.id)
        .eq('ticket_id', dbTrade.ticket_id)
        .maybeSingle();

      if (existing) {
        console.warn(`Trade with ticket ${dbTrade.ticket_id} already exists. Skipping.`);
        // Return the existing trade
        const { data } = await supabase
          .from('trades')
          .select('*')
          .eq('id', existing.id)
          .single();
        return mapTradeFromDB(data);
      }
    }

    const { data, error } = await supabase
      .from('trades')
      .insert(dbTrade)
      .select()
      .single();

    if (error) throw error;
    return mapTradeFromDB(data);
  },

  async batchAddTrades(trades: Trade[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const normalizedTrades = trades.map(trade =>
      normalizeTrade(trade, {}, { preserveProvidedPnl: trade.ticketId !== undefined })
    );

    // Filter out duplicates before sending to DB if ticket IDs are provided
    const ticketIds = normalizedTrades.map(t => t.ticketId).filter(Boolean) as string[];
    
    let existingTicketIds = new Set<string>();
    if (ticketIds.length > 0) {
      const { data: existing } = await supabase
        .from('trades')
        .select('ticket_id')
        .eq('user_id', user.id)
        .in('ticket_id', ticketIds);
      
      existingTicketIds = new Set(existing?.map(t => t.ticket_id) || []);
    }

    const tradesToSave = normalizedTrades
      .filter(t => !t.ticketId || !existingTicketIds.has(t.ticketId))
      .map(t => buildTradeDbPayload(t, user.id));

    if (tradesToSave.length === 0) return [];

    const { data, error } = await supabase
      .from('trades')
      .insert(tradesToSave)
      .select();

    if (error) throw error;
    return (data || []).map(mapTradeFromDB);
  },

  async updateTrade(trade: Trade): Promise<Trade> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Get current record to check for deleted files
    const { data: currentTradeRow } = await supabase
      .from('trades')
      .select('*')
      .eq('id', trade.id)
      .single();

    const currentTrade = currentTradeRow ? mapTradeFromDB(currentTradeRow as DBTrade) : undefined;
    const isBridgeManagedTrade = Boolean(
      currentTrade?.ticketId ||
      currentTrade?.tags?.some(tag => /MT[45]_Auto_Journal|Imported/i.test(tag))
    );
    const hasOwnProperty = (key: keyof Pick<Trade, 'beforeScreenshot' | 'afterScreenshot'>) =>
      Object.prototype.hasOwnProperty.call(trade, key);
    const beforeScreenshotCleared = hasOwnProperty('beforeScreenshot') && !trade.beforeScreenshot;
    const afterScreenshotCleared = hasOwnProperty('afterScreenshot') && !trade.afterScreenshot;

    const tradeForSave = isBridgeManagedTrade && currentTrade
      ? {
          ...trade,
          date: currentTrade.date,
          time: currentTrade.time,
          entryPrice: currentTrade.entryPrice,
          exitPrice: currentTrade.exitPrice,
          result: currentTrade.result,
        }
      : trade;

    const normalizedInput = normalizeTrade(
      tradeForSave,
      currentTrade,
      { preserveProvidedPnl: true }
    );

    if (currentTradeRow) {
      // Handle images
      if (currentTradeRow.before_screenshot && (!normalizedInput.beforeScreenshot || normalizedInput.beforeScreenshot.startsWith('data:'))) {
        await deleteImageFile(currentTradeRow.before_screenshot);
      }
      if (currentTradeRow.after_screenshot && (!normalizedInput.afterScreenshot || normalizedInput.afterScreenshot.startsWith('data:'))) {
        await deleteImageFile(currentTradeRow.after_screenshot);
      }
    }

    // Upload images if they are base64
    const beforeUrl = await uploadImage(user.id, normalizedInput.beforeScreenshot, 'before');
    const afterUrl = await uploadImage(user.id, normalizedInput.afterScreenshot, 'after');

    const tradeToUpdate = {
      ...normalizedInput,
      beforeScreenshot: beforeUrl,
      afterScreenshot: afterUrl,
    };

    let updateData = buildTradeDbPayload(tradeToUpdate, user.id, currentTrade || trade);
    if (beforeScreenshotCleared) {
      (updateData as any).before_screenshot = null;
    }
    if (afterScreenshotCleared) {
      (updateData as any).after_screenshot = null;
    }
    
    // Recursive update function to handle missing columns
    const performUpdate = async (data: Partial<DBTrade>): Promise<void> => {
      const { error } = await supabase.from('trades').update(data).eq('id', trade.id);
      
      if (error) {
        if (error.code === '42703' || error.code === 'PGRST204' || ((error as any).status === 400 && error.message.includes('column'))) {
          const fieldMatch = error.message.match(/column "(.+)"/i) || 
                             error.message.match(/column (.+) of/i) || 
                             error.message.match(/'(.+)' column/i);
          if (fieldMatch && (fieldMatch[1] || fieldMatch[2] || fieldMatch[3])) {
            const missingField = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]).replace(/"/g, '').replace(/'/g, '') as keyof DBTrade;
            console.warn(`Column ${missingField} missing. Retrying without it.`);
            const { [missingField]: _, ...safeData } = data;
            return performUpdate(safeData);
          }
        }
        throw error;
      }
    };

    await performUpdate(updateData);

    const { data: refreshedTrade, error: refreshError } = await supabase
      .from('trades')
      .select('*')
      .eq('id', trade.id)
      .single();

    if (refreshError) throw refreshError;
    return mapTradeFromDB(refreshedTrade as DBTrade);
  },

  async batchUpdateTrades(trades: Trade[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const performBatch = async (dataList: { id: string, data: Partial<DBTrade> }[]): Promise<void> => {
      const promises = dataList.map(item => 
        supabase.from('trades').update(item.data).eq('id', item.id)
      );

      const results = await Promise.all(promises);
      const failedResult = results.find(r => r.error);
      
      if (failedResult && failedResult.error) {
        const error = failedResult.error;
        if (error.code === '42703' || error.code === 'PGRST204' || ((error as any).status === 400 && error.message.includes('column'))) {
          const fieldMatch = error.message.match(/column "(.+)"/i) || 
                             error.message.match(/column (.+) of/i) || 
                             error.message.match(/'(.+)' column/i);
          if (fieldMatch && (fieldMatch[1] || fieldMatch[2] || fieldMatch[3])) {
            const missingField = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]).replace(/"/g, '').replace(/'/g, '') as keyof DBTrade;
            console.warn(`Batch: Column ${missingField} missing. Stripping and retrying.`);
            
            const nextDataList = dataList.map(item => {
              const { [missingField]: _, ...safeData } = item.data;
              return { id: item.id, data: safeData };
            });
            return performBatch(nextDataList);
          }
        }
        throw error;
      }
    };

    const initialDataList = trades.map(t => ({
      id: t.id,
      data: buildTradeDbPayload(
        normalizeTrade(t, {}, { preserveProvidedPnl: t.ticketId !== undefined }),
        user.id
      )
    }));

    await performBatch(initialDataList);
  },

  async deleteTrades(tradeIds: string[]) {
    const { error } = await supabase
      .from('trades')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', tradeIds);

    if (error) throw error;
  },

  async restoreTrades(tradeIds: string[]) {
    const { error } = await supabase
      .from('trades')
      .update({ deleted_at: null })
      .in('id', tradeIds);

    if (error) throw error;
  },

  async deduplicateManualTrades() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Fetch all active manual trades (no ticket_id)
    const { data: manualTrades, error } = await supabase
      .from('trades')
      .select('id, pair, date, entry_price, direction, lots')
      .eq('user_id', user.id)
      .is('ticket_id', null)
      .is('deleted_at', null);

    if (error) throw error;
    if (!manualTrades || manualTrades.length === 0) return 0;

    const seen = new Set<string>();
    const duplicateIds: string[] = [];

    manualTrades.forEach(trade => {
      // Create a unique key for the trade properties
      const key = `${trade.date}-${trade.pair}-${trade.direction}-${trade.entry_price}-${trade.lots}`;
      if (seen.has(key)) {
        duplicateIds.push(trade.id);
      } else {
        seen.add(key);
      }
    });

    if (duplicateIds.length > 0) {
      await this.deleteTrades(duplicateIds);
    }

    return duplicateIds.length;
  },

  // --- Notes ---
  async getNotes(userId: string) {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map((note: any) => ({
      ...note,
      isPinned: note.is_pinned,
      isArchived: note.is_archived,
      isTrashed: note.is_trashed,
      isList: note.is_list,
      listItems: note.list_items,
      tableData: note.table_data,
      position: note.position
    }));
  },

  async addNote(note: Note) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Upload image if it is base64
    const imageUrl = await uploadImage(user.id, note.image, 'after');

    const insertData = {
      user_id: user.id,
      title: note.title,
      content: note.content,
      date: note.date,
      tags: note.tags,
      color: note.color,
      is_pinned: !!note.isPinned,
      is_archived: !!note.isArchived,
      is_trashed: !!note.isTrashed,
      is_list: !!note.isList,
      list_items: note.listItems || [],
      image: imageUrl ?? null,
      table_data: note.tableData || null,
      position: note.position || 0
    };

    const performInsert = async (data: any): Promise<any> => {
      const { data: result, error } = await supabase
        .from('notes')
        .insert(data)
        .select()
        .single();

      if (error) {
        console.error("Supabase addNote error:", error);
        // Handle missing columns by stripping them and retrying
        if (error.code === '42703' || error.code === 'PGRST204' || ((error as any).status === 400 && error.message.includes('column'))) {
          const fieldMatch = error.message.match(/column "(.+)"/i) || 
                             error.message.match(/column (.+) of/i) || 
                             error.message.match(/'(.+)' column/i);
          if (fieldMatch && (fieldMatch[1] || fieldMatch[2] || fieldMatch[3])) {
            const missingField = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]).replace(/"/g, '').replace(/'/g, '') as string;
            console.warn(`Column ${missingField} missing in notes table. Retrying insert without it.`);
            const { [missingField]: _, ...safeData } = data;
            return performInsert(safeData);
          }
        }
        throw error;
      }
      return result;
    };

    const data = await performInsert(insertData);
    
    // Fully map the returned note
    return {
      ...data,
      isPinned: data.is_pinned,
      isArchived: data.is_archived,
      isTrashed: data.is_trashed,
      isList: data.is_list,
      listItems: data.list_items,
      tableData: data.table_data,
      date: data.date || data.created_at,
      position: data.position
    };
  },

  async updateNote(note: Partial<Note> & { id: string }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const imageProvided = Object.prototype.hasOwnProperty.call(note, 'image');
    const nextImage = imageProvided ? (note.image ? await uploadImage(user.id, note.image, 'after') : null) : undefined;

    const { data: currentNote } = await supabase
      .from('notes')
      .select('image')
      .eq('id', note.id)
      .eq('user_id', user.id)
      .single();

    if (imageProvided && currentNote?.image && currentNote.image !== nextImage) {
      await deleteImageFile(currentNote.image);
    }

    const updateData: any = {};
    if (note.title !== undefined) updateData.title = note.title;
    if (note.content !== undefined) updateData.content = note.content;
    if (note.tags !== undefined) updateData.tags = note.tags;
    if (note.color !== undefined) updateData.color = note.color;
    if (note.isPinned !== undefined) updateData.is_pinned = !!note.isPinned;
    if (note.isArchived !== undefined) updateData.is_archived = !!note.isArchived;
    if (note.isTrashed !== undefined) updateData.is_trashed = !!note.isTrashed;
    if (note.isList !== undefined) updateData.is_list = !!note.isList;
    if (note.listItems !== undefined) updateData.list_items = note.listItems || [];
    if (imageProvided) {
      updateData.image = nextImage;
    }
    if (note.tableData !== undefined) updateData.table_data = note.tableData;
    if (note.date !== undefined) updateData.date = note.date;
    if (note.position !== undefined) updateData.position = note.position;

    const performUpdate = async (data: any): Promise<void> => {
      const { error } = await supabase
        .from('notes')
        .update(data)
        .eq('id', note.id)
        .eq('user_id', user.id);

      if (error) {
        console.error("Supabase updateNote error:", error);
        // Handle missing columns by stripping them and retrying
        if (error.code === '42703' || error.code === 'PGRST204' || ((error as any).status === 400 && error.message.includes('column'))) {
          const fieldMatch = error.message.match(/column "(.+)"/i) || 
                             error.message.match(/column (.+) of/i) || 
                             error.message.match(/'(.+)' column/i);
          if (fieldMatch && (fieldMatch[1] || fieldMatch[2] || fieldMatch[3])) {
            const missingField = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]).replace(/"/g, '').replace(/'/g, '') as string;
            console.warn(`Column ${missingField} missing in notes table. Retrying update without it.`);
            const { [missingField]: _, ...safeData } = data;
            return performUpdate(safeData);
          }
        }
        throw error;
      }
    };

    await performUpdate(updateData);
  },

  async deleteNote(noteId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', user.id);

    if (error) throw error;
  },

  // --- Daily Bias ---
  async getDailyBias(userId: string) {
    const { data, error } = await supabase
      .from('daily_bias')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data.map((bias: any) => ({
      ...bias,
      actualOutcome: bias.actual_outcome
    }));
  },

  async updateBias(bias: DailyBias) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('daily_bias')
      .upsert({
        user_id: user.id,
        date: bias.date,
        bias: bias.bias,
        notes: bias.notes,
        actual_outcome: bias.actualOutcome
      }, { onConflict: 'user_id,date' });

    if (error) throw error;
  },

  // --- Goals ---
  async getGoals(userId: string) {
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapGoalFromDB);
  },

  async addGoal(goal: Goal) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Check for potential duplicate goals (same title, type, target)
    const { data: existing } = await supabase
      .from('goals')
      .select('id')
      .eq('user_id', user.id)
      .eq('title', goal.title)
      .eq('type', goal.type)
      .eq('target_value', goal.targetValue)
      .maybeSingle();

    if (existing) {
      console.warn("Potential duplicate goal detected. Returning existing.");
      const { data } = await supabase.from('goals').select('*').eq('id', existing.id).single();
      return mapGoalFromDB(data);
    }

    const { data, error } = await supabase
      .from('goals')
      .insert({
        user_id: user.id,
        title: goal.title,
        description: goal.description,
        type: goal.type,
        metric: goal.metric,
        target_value: goal.targetValue,
        start_value: goal.startValue,
        current_value: goal.manualProgress || 0,
        start_date: goal.startDate,
        end_date: goal.endDate,
        status: goal.status,
        milestones: goal.milestones,
        auto_track_rule: goal.autoTrackRule,
        manual_entries: goal.manualEntries
      })
      .select()
      .single();

    if (error) throw error;
    return mapGoalFromDB(data);
  },

  async updateGoal(goal: Goal) {
    const { error } = await supabase
      .from('goals')
      .update({
        title: goal.title,
        description: goal.description,
        type: goal.type,
        metric: goal.metric,
        target_value: goal.targetValue,
        start_value: goal.startValue,
        current_value: goal.manualProgress,
        start_date: goal.startDate,
        end_date: goal.endDate,
        status: goal.status,
        milestones: goal.milestones,
        auto_track_rule: goal.autoTrackRule,
        manual_entries: goal.manualEntries
      })
      .eq('id', goal.id);

    if (error) throw error;
  },

  async deleteGoal(goalId: string) {
    const { error } = await supabase
      .from('goals')
      .delete()
      .eq('id', goalId);

    if (error) throw error;
  },

  // --- Profile ---
  async updateProfile(profile: Partial<UserProfile>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const dbProfile: Record<string, any> = {};
    if (profile.name !== undefined) dbProfile.name = profile.name;
    if (profile.country !== undefined) dbProfile.country = profile.country;
    if (profile.accountName !== undefined) dbProfile.account_name = profile.accountName;
    if (profile.initialBalance !== undefined) dbProfile.initial_balance = Number(profile.initialBalance);
    if (profile.currency !== undefined) dbProfile.currency = profile.currency;
    if (profile.currencySymbol !== undefined) dbProfile.currency_symbol = profile.currencySymbol;
    if (profile.syncMethod !== undefined) dbProfile.sync_method = profile.syncMethod;
    if (profile.experienceLevel !== undefined) dbProfile.experience_level = profile.experienceLevel;
    if (profile.tradingStyle !== undefined) dbProfile.trading_style = profile.tradingStyle;
    if (profile.onboarded !== undefined) dbProfile.onboarded = profile.onboarded;
    if (profile.plan !== undefined) dbProfile.plan = normalizePlan(profile.plan);
    if (profile.syncKey !== undefined) dbProfile.sync_key = profile.syncKey;
    if (profile.eaConnected !== undefined) dbProfile.ea_connected = profile.eaConnected;
    if (profile.autoJournal !== undefined) dbProfile.auto_journal = profile.autoJournal;
    if (profile.avatarUrl !== undefined) dbProfile.avatar_url = profile.avatarUrl;
    if (profile.themePreference !== undefined) dbProfile.theme_preference = profile.themePreference;
    if (profile.chartConfig !== undefined) dbProfile.chart_config = profile.chartConfig;
    if (profile.keepChartsAlive !== undefined) dbProfile.keep_charts_alive = profile.keepChartsAlive;
    if (profile.timezone !== undefined) dbProfile.timezone = profile.timezone;

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        ...dbProfile,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error updating profile:', error);
      // Fallback for missing columns (common in beta migrations)
      if (error.code === '42703' || error.code === 'PGRST204' || ((error as any).status === 400 && error.message.includes('column'))) {
        const fieldMatch = error.message.match(/column "(.+)"/i) || 
                           error.message.match(/column (.+) of/i) || 
                           error.message.match(/'(.+)' column/i);
        if (fieldMatch && (fieldMatch[1] || fieldMatch[2] || fieldMatch[3])) {
          const missingField = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]).replace(/"/g, '').replace(/'/g, '');
          console.warn(`Column ${missingField} missing in profiles table. Retrying without it.`);
          const { [missingField]: _, ...safeProfile } = dbProfile;
          const { error: retryError } = await supabase
            .from('profiles')
            .upsert({ id: user.id, ...safeProfile });
          if (retryError) throw retryError;
          return;
        }
      }
      throw error;
    }
  },

  // --- EA Session ---
  async getEASession(syncKey: string) {
    const { data, error } = await supabase
      .from('ea_sessions')
      .select('*')
      .eq('sync_key', syncKey)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  // --- Strategy Diagrams ---
  async getDiagrams(userId: string) {
    const { data, error } = await supabase
      .from('strategy_diagrams')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      category: d.category,
      description: d.description,
      createdAt: d.created_at,
      updatedAt: d.updated_at
    }));
  },

  async saveDiagram(diagram: Partial<StrategyDiagram>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const dbDiagram = {
      user_id: user.id,
      name: diagram.name,
      code: diagram.code,
      category: diagram.category,
      description: diagram.description,
      updated_at: new Date().toISOString()
    };

    if (diagram.id) {
      const { data, error } = await supabase
        .from('strategy_diagrams')
        .update(dbDiagram)
        .eq('id', diagram.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('strategy_diagrams')
        .insert(dbDiagram)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  async deleteDiagram(id: string) {
    const { error } = await supabase
      .from('strategy_diagrams')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // --- Backtest Sessions ---
  async saveBacktestSession(session: Omit<BacktestSession, 'id' | 'user_id' | 'updated_at'>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const basePayload = {
      user_id: user.id,
      symbol: session.symbol,
      timeframe: session.timeframe,
      data: session.data,
      drawings: session.drawings,
      trades: session.trades,
      updated_at: new Date().toISOString()
    };

    const { data: existingSession, error: findError } = await supabase
      .from('backtest_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('symbol', session.symbol)
      .eq('timeframe', session.timeframe)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (existingSession?.id) {
      const { data, error } = await supabase
        .from('backtest_sessions')
        .update(basePayload)
        .eq('id', existingSession.id)
        .select()
        .single();

      if (error) throw error;
      return data as BacktestSession;
    }

    const { data, error } = await supabase
      .from('backtest_sessions')
      .insert(basePayload)
      .select()
      .single();

    if (error) throw error;
    return data as BacktestSession;
  },

  async getBacktestSessions(): Promise<BacktestSession[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('backtest_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data || []) as BacktestSession[];
  },

  async deleteBacktestSession(id: string) {
    const { error } = await supabase
      .from('backtest_sessions')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  // --- Cash Transactions ---
  async getCashTransactions(userId: string) {
    if (cashTransactionsBackendUnavailable) {
      return readCashTransactionCache(userId);
    }

    const { data, error } = await supabase
      .from('cash_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) {
      if (isMissingCashTransactionsTableError(error)) {
        cashTransactionsBackendUnavailable = true;
        notifyCashTransactionsAvailability(false);
        return readCashTransactionCache(userId);
      }
      throw error;
    }

    const mapped = (data || []).map(mapCashTransactionFromDB);
    writeCashTransactionCache(userId, mapped);
    return mapped;
  },

  async addCashTransaction(transaction: CashTransaction) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const dbTransaction = mapCashTransactionToDB(transaction, user.id);

    if (cashTransactionsBackendUnavailable) {
      const saved = { ...transaction, id: transaction.id || crypto.randomUUID(), amount: normalizeCashTransactionAmount(transaction) };
      upsertCashTransactionCache(user.id, saved);
      notifyCashTransactionsChanged(user.id);
      return saved;
    }

    const { data, error } = await supabase
      .from('cash_transactions')
      .insert(dbTransaction)
      .select()
      .single();

    if (error) {
      if (isMissingCashTransactionsTableError(error)) {
        cashTransactionsBackendUnavailable = true;
        notifyCashTransactionsAvailability(false);
        const saved = { ...transaction, id: transaction.id || crypto.randomUUID(), amount: normalizeCashTransactionAmount(transaction) };
        upsertCashTransactionCache(user.id, saved);
        notifyCashTransactionsChanged(user.id);
        return saved;
      }
      throw error;
    }

    const mapped = mapCashTransactionFromDB(data);
    upsertCashTransactionCache(user.id, mapped);
    notifyCashTransactionsChanged(user.id);
    return mapped;
  },

  async updateCashTransaction(transaction: CashTransaction) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    if (cashTransactionsBackendUnavailable) {
      const updated = { ...transaction, amount: normalizeCashTransactionAmount(transaction) };
      upsertCashTransactionCache(user.id, updated);
      notifyCashTransactionsChanged(user.id);
      return;
    }

    const query = supabase
      .from('cash_transactions')
      .update({
        type: transaction.type,
        amount: normalizeCashTransactionAmount(transaction),
        date: transaction.date,
        description: transaction.description,
      })
      .eq('id', transaction.id)
      .eq('user_id', user.id);

    const { error } = await query;

    if (error) {
      if (isMissingCashTransactionsTableError(error)) {
        cashTransactionsBackendUnavailable = true;
        notifyCashTransactionsAvailability(false);
        const updated = { ...transaction, amount: normalizeCashTransactionAmount(transaction) };
        upsertCashTransactionCache(user.id, updated);
        notifyCashTransactionsChanged(user.id);
        return;
      }
      throw error;
    }

    const updated = { ...transaction, amount: normalizeCashTransactionAmount(transaction) };
    upsertCashTransactionCache(user.id, updated);
    notifyCashTransactionsChanged(user.id);
  },

  async deleteCashTransaction(transactionId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    if (cashTransactionsBackendUnavailable) {
      removeCashTransactionFromCache(user.id, transactionId);
      notifyCashTransactionsChanged(user.id);
      return;
    }

    const { error } = await supabase
      .from('cash_transactions')
      .delete()
      .eq('id', transactionId)
      .eq('user_id', user.id);

    if (error) {
      if (isMissingCashTransactionsTableError(error)) {
        cashTransactionsBackendUnavailable = true;
        notifyCashTransactionsAvailability(false);
        removeCashTransactionFromCache(user.id, transactionId);
        notifyCashTransactionsChanged(user.id);
        return;
      }
      throw error;
    }

    removeCashTransactionFromCache(user.id, transactionId);
    notifyCashTransactionsChanged(user.id);
  },
};

