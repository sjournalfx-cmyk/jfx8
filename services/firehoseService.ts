import { supabase } from '../lib/supabase';
import { FirehoseRule, FirehoseEvent, DBFirehoseRule, DBFirehoseEvent } from '../types';

function mapRuleFromDB(db: DBFirehoseRule): FirehoseRule {
  return {
    id: db.id,
    name: db.name,
    luceneQuery: db.lucene_query,
    active: db.active,
    createdBy: db.created_by,
    createdAt: db.created_at,
    lastEventAt: db.last_event_at,
  };
}

function mapEventFromDB(db: DBFirehoseEvent): FirehoseEvent {
  return {
    id: db.id,
    ruleId: db.rule_id,
    title: db.title,
    url: db.url,
    source: db.source,
    summary: db.summary,
    publishedAt: db.published_at,
    seen: db.seen,
    createdAt: db.created_at,
  };
}

export const firehoseService = {
  async getRules(userId: string): Promise<FirehoseRule[]> {
    const { data, error } = await supabase
      .from('firehose_rules')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapRuleFromDB);
  },

  async createRule(userId: string, name: string, luceneQuery: string, createdBy: 'ai' | 'manual'): Promise<FirehoseRule> {
    const { data, error } = await supabase
      .from('firehose_rules')
      .insert({
        user_id: userId,
        name,
        lucene_query: luceneQuery,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) throw error;
    return mapRuleFromDB(data);
  },

  async updateRule(ruleId: string, updates: { name?: string; luceneQuery?: string }): Promise<FirehoseRule> {
    const dbUpdates: Record<string, string> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.luceneQuery !== undefined) dbUpdates.lucene_query = updates.luceneQuery;
    const { data, error } = await supabase
      .from('firehose_rules')
      .update(dbUpdates)
      .eq('id', ruleId)
      .select()
      .single();
    if (error) throw error;
    return mapRuleFromDB(data);
  },

  async toggleRule(ruleId: string, active: boolean): Promise<void> {
    const { error } = await supabase
      .from('firehose_rules')
      .update({ active })
      .eq('id', ruleId);

    if (error) throw error;
  },

  async deleteRule(ruleId: string): Promise<void> {
    const { error } = await supabase
      .from('firehose_rules')
      .delete()
      .eq('id', ruleId);

    if (error) throw error;
  },

  async getEvents(userId: string): Promise<FirehoseEvent[]> {
    const { data, error } = await supabase
      .from('firehose_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return (data || []).map(mapEventFromDB);
  },

  async getUnseenCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('firehose_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('seen', false);

    if (error) throw error;
    return count || 0;
  },

  async markEventSeen(eventId: string): Promise<void> {
    const { error } = await supabase
      .from('firehose_events')
      .update({ seen: true })
      .eq('id', eventId);

    if (error) throw error;
  },

  async markAllEventsSeen(userId: string): Promise<void> {
    const { error } = await supabase
      .from('firehose_events')
      .update({ seen: true })
      .eq('user_id', userId)
      .eq('seen', false);

    if (error) throw error;
  },

  async syncEvents(userId: string, force: boolean = false): Promise<void> {
    try {
      // Check last sync time
      const { data, error: fetchError } = await supabase
        .from('firehose_sync_state')
        .select('last_sync_at')
        .eq('user_id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Failed to fetch sync state:', fetchError);
      }

      const lastSync = data ? new Date(data.last_sync_at).getTime() : 0;
      const now = Date.now();

      if (!force && now - lastSync < 60000) {
        return; // Skip if within 60 seconds
      }

      // Update timestamp to prevent concurrent calls
      await supabase
        .from('firehose_sync_state')
        .upsert({ user_id: userId, last_sync_at: new Date().toISOString() });

      const { error } = await supabase.functions.invoke('sync-firehose');
      if (error) {
        throw error;
      }
    } catch (err) {
      console.error('Failed to sync firehose events:', err);
      throw err; // Re-throw so UI can catch and show toast
    }
  },

  async checkHealth(): Promise<boolean> {
    try {
      const { data, error } = await supabase.functions.invoke('sync-firehose', { method: 'GET' });
      return !error && data?.status === 'ok';
    } catch {
      return false;
    }
  },
};
