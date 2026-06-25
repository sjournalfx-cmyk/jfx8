
import { useState, useEffect } from 'react';
import { Trade, Note, DailyBias, UserProfile, EASession, CashTransaction } from '../types';
import { dataService, mapTradeFromDB, mapCashTransactionFromDB } from '../services/dataService';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/Toast';
import { getSASTDateTime } from '../lib/timeUtils';

import { useLocalStorage } from './useLocalStorage';

export const useData = (userId: string | null, userProfile: UserProfile | null) => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [dailyBias, setDailyBias] = useState<DailyBias[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);
  const [cashTransactionsAvailable, setCashTransactionsAvailable] = useLocalStorage<boolean>('jfx_cash_transactions_available', true);
  const [eaSession, setEASession] = useLocalStorage<EASession | null>(`jfx_ea_session_${userId}`, null);
  const [lastKnownBridgeBalance, setLastKnownBridgeBalance] = useLocalStorage<number | null>(`jfx_last_bridge_balance_${userId}`, null);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isBridgeOnline, setIsBridgeOnline] = useState(false);
  const [offlineQueue, setOfflineQueue] = useLocalStorage<Trade[]>(`jfx_offline_trades_${userId}`, []);
  const [isSyncing, setIsSyncing] = useState(false);
  const { addToast } = useToast();

  const addToOfflineQueue = (trade: Trade) => {
    setOfflineQueue(prev => [...prev, trade]);
    addToast({
      type: 'info',
      title: 'Offline Mode',
      message: 'Trade saved locally. It will sync automatically when you are back online.',
      duration: 5000
    });
  };

  const syncOfflineTrades = async () => {
    if (!userId || offlineQueue.length === 0 || isSyncing) return;
    
    setIsSyncing(true);
    const successfullySynced: string[] = [];
    
    // We use a temporary array to avoid state staleness issues during the loop
    const queueToProcess = [...offlineQueue];
    
    for (const trade of queueToProcess) {
      try {
        await dataService.addTrade(trade);
        successfullySynced.push(trade.ticketId || trade.id || Math.random().toString());
      } catch (error) {
        console.error("Failed to sync offline trade:", error);
        // Stop processing if we hit a network error again
        break; 
      }
    }

    if (successfullySynced.length > 0) {
      setOfflineQueue(prev => prev.filter(t => !successfullySynced.includes(t.ticketId || t.id || '')));
      addToast({
        type: 'success',
        title: 'Sync Complete',
        message: `Successfully synced ${successfullySynced.length} offline trade(s).`,
        duration: 5000
      });
    }
    setIsSyncing(false);
  };

  useEffect(() => {
    const handleOnline = () => {
      syncOfflineTrades();
    };

    window.addEventListener('online', handleOnline);
    // Also try syncing on mount if online
    if (navigator.onLine) {
      syncOfflineTrades();
    }

    return () => window.removeEventListener('online', handleOnline);
  }, [offlineQueue, userId]);

  const loadInitialData = async (currentUserId: string, currentUserProfile: UserProfile | null) => {
    setIsDataLoading(true);
    try {
      const [fetchedTrades, fetchedNotes, fetchedBias] = await Promise.all([
        dataService.getTrades(currentUserId),
        dataService.getNotes(currentUserId),
        dataService.getDailyBias(currentUserId)
      ]);

      // Cash transactions table may not exist yet - fetch separately with try/catch
      let fetchedCashTransactions: CashTransaction[] = [];
      if (cashTransactionsAvailable) {
        try {
          fetchedCashTransactions = await dataService.getCashTransactions(currentUserId);
          setCashTransactionsAvailable(true);
        } catch (cashError) {
          // Table likely doesn't exist yet, ignore further attempts until it is created.
          setCashTransactionsAvailable(false);
        }
      }

      setTrades(fetchedTrades);
      setNotes(fetchedNotes);
      setDailyBias(fetchedBias);
      setCashTransactions(fetchedCashTransactions);
      
      if (currentUserProfile && currentUserProfile.eaConnected && currentUserProfile.syncKey) {
        const session = await dataService.getEASession(currentUserProfile.syncKey);
        if (session) {
          setEASession(session);
        }
      }

      if (fetchedTrades.length > 0) {
        const lastTradeDate = new Date(fetchedTrades[0].date); // First is newest
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - lastTradeDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays > 3) {
          setTimeout(() => {
            addToast({
              type: 'info',
              title: 'Time to Journal?',
              message: `It's been ${diffDays} days since your last logged trade. Consistency is key!`,
              duration: 6000
            });
          }, 2000);
        }
      }
    } catch (error) {
      console.error("Error loading user data:", error);
    } finally {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      loadInitialData(userId, userProfile);
    }
  }, [userId, userProfile, cashTransactionsAvailable]);

  useEffect(() => {
    if (!userId) return;

    const handleCashTransactionsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId !== userId) return;

      dataService.getCashTransactions(userId)
        .then(setCashTransactions)
        .catch((error) => {
          console.error('Failed to refresh cash transactions:', error);
        });
    };

    window.addEventListener('jfx-cash-transactions-changed', handleCashTransactionsChanged as EventListener);
    return () => window.removeEventListener('jfx-cash-transactions-changed', handleCashTransactionsChanged as EventListener);
  }, [userId]);

  useEffect(() => {
    const handleCashTransactionsAvailability = (event: Event) => {
      const detail = (event as CustomEvent<{ available?: boolean }>).detail;
      if (typeof detail?.available === 'boolean') {
        setCashTransactionsAvailable(detail.available);
      }
    };

    window.addEventListener('jfx-cash-transactions-availability', handleCashTransactionsAvailability as EventListener);
    return () => window.removeEventListener('jfx-cash-transactions-availability', handleCashTransactionsAvailability as EventListener);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const channels = [];

    if (userProfile?.syncKey) {
      const sessionChannel = supabase
        .channel('ea_session_global_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ea_sessions', filter: `sync_key=eq.${userProfile.syncKey}` }, (payload) => {
          if (payload.new) setEASession(payload.new as EASession);
        })
        .subscribe();

      channels.push(sessionChannel);
    }

    const tradesChannel = supabase
      .channel(`trades_sync_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades', filter: `user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (payload.new.deleted_at) return;
          const newTrade = mapTradeFromDB(payload.new as any);
          setTrades(prev => {
            if (prev.some(t => t.id === newTrade.id)) return prev;
            return [newTrade, ...prev];
          });
        }
        else if (payload.eventType === 'UPDATE') {
          if (payload.new.deleted_at) {
            setTrades(prev => prev.filter(t => t.id !== payload.new.id));
          } else {
            setTrades(prev => prev.map(t => t.id === payload.new.id ? mapTradeFromDB(payload.new as any) : t));
          }
        }
        else if (payload.eventType === 'DELETE') {
          setTrades(prev => prev.filter(t => t.id !== (payload.old as any).id));
        }
      })
      .subscribe();

    const notesChannel = supabase
      .channel(`notes_sync_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${userId}` }, (payload) => {
        const mapNote = (dbNote: any): Note => ({
          ...dbNote,
          isPinned: dbNote.is_pinned,
          isArchived: dbNote.is_archived,
          isTrashed: dbNote.is_trashed,
          isList: dbNote.is_list,
          listItems: dbNote.list_items,
          tableData: dbNote.table_data,
          date: dbNote.date || dbNote.created_at
        });

        if (payload.eventType === 'INSERT') {
          const newNote = mapNote(payload.new);
          setNotes(prev => {
            if (prev.some(n => n.id === newNote.id)) return prev;
            return [newNote, ...prev];
          });
        }
        else if (payload.eventType === 'UPDATE') {
          const updatedNote = mapNote(payload.new);
          setNotes(prev => prev.map(n => n.id === payload.new.id ? updatedNote : n));
        }
        else if (payload.eventType === 'DELETE') {
          setNotes(prev => prev.filter(n => n.id !== (payload.old as any).id));
        }
      }).subscribe();

const biasChannel = supabase
    .channel(`bias_sync_${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_bias', filter: `user_id=eq.${userId}` }, (payload) => {
      if (payload.eventType === 'INSERT') {
        setDailyBias(prev => {
          if (prev.some(b => b.date === payload.new.date)) return prev;
          return [...prev, { ...payload.new, actualOutcome: (payload.new as any).actual_outcome } as DailyBias];
        });
      }
      else if (payload.eventType === 'UPDATE') {
        setDailyBias(prev => prev.map(b => b.date === payload.new.date ? { ...payload.new, actualOutcome: (payload.new as any).actual_outcome } as DailyBias : b));
      }
    }).subscribe();

  // Cash transactions table may not exist yet - wrap in try/catch
  try {
    const cashTransactionsChannel = supabase
      .channel(`cash_transactions_sync_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_transactions', filter: `user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newTx = mapCashTransactionFromDB(payload.new as any);
          setCashTransactions(prev => {
            if (prev.some(t => t.id === newTx.id)) return prev;
            return [newTx, ...prev];
          });
        }
        else if (payload.eventType === 'UPDATE') {
          const updatedTx = mapCashTransactionFromDB(payload.new as any);
          setCashTransactions(prev => prev.map(t => t.id === payload.new.id ? updatedTx : t));
        }
        else if (payload.eventType === 'DELETE') {
          setCashTransactions(prev => prev.filter(t => t.id !== (payload.old as any).id));
        }
      }).subscribe();
    channels.push(cashTransactionsChannel);
  } catch (e) {
    // Table doesn't exist, skip
  }

  channels.push(tradesChannel, notesChannel, biasChannel);

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [userId, userProfile?.syncKey]);

  // Track bridge online status by checking eaSession freshness (same 15s rule as Sidebar)
  useEffect(() => {
    const checkBridgeHealth = () => {
      if (!userProfile?.eaConnected || !eaSession?.last_updated) {
        setIsBridgeOnline(false);
        return;
      }
      if (eaSession.data?.isHeartbeat === false) {
        setIsBridgeOnline(false);
        return;
      }
      const diffSeconds = (Date.now() - new Date(eaSession.last_updated).getTime()) / 1000;
      setIsBridgeOnline(diffSeconds < 15);
    };

    checkBridgeHealth();
    const healthInterval = setInterval(checkBridgeHealth, 2000);
    return () => clearInterval(healthInterval);
  }, [eaSession, userProfile?.eaConnected]);

  // Poll the local MQL5 bridge in the background if the bridge connection is active
  useEffect(() => {
    if (!userId || !userProfile?.eaConnected) return;

    let isActive = true;
    const pollLocalBridge = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        
        const response = await fetch('http://localhost:8888/api/account', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
          const accData = await response.json();
          if (accData && accData.account && isActive) {
            // Persist the last known balance so it survives disconnects
            if (typeof accData.account.balance === 'number') {
              setLastKnownBridgeBalance(accData.account.balance);
            }
            setEASession(prev => {
              const currentData = prev?.data || {};
              return {
                id: prev?.id || 'local-session',
                sync_key: userProfile.syncKey || '',
                last_updated: new Date().toISOString(),
                data: {
                  ...currentData,
                  account: {
                    ...currentData.account,
                    ...accData.account
                  }
                }
              };
            });
          }
        }
      } catch (e) {
        // Ignore fetch errors
      }
    };

    const interval = setInterval(pollLocalBridge, 3000);
    pollLocalBridge();

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [userId, userProfile?.eaConnected, userProfile?.syncKey]);

  return {
    trades,
    notes,
    dailyBias,
    cashTransactions,
    eaSession,
    lastKnownBridgeBalance,
    isBridgeOnline,
    editingTrade,
    isDataLoading,
    setTrades,
    setNotes,
    setDailyBias,
    setCashTransactions,
    setEASession,
    setEditingTrade,
    offlineQueue,
    addToOfflineQueue
  };
};
