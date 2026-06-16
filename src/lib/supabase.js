import { createClient } from '@supabase/supabase-js';

const SUPABASE_KEYS = { url: 'od_sb_url', key: 'od_sb_key' };

let _client = null;

// ── Init ────────────────────────────────────────────────────────────────────
export function initSupabase(url, anonKey) {
  if (!url || !anonKey) { _client = null; return false; }
  try {
    _client = createClient(url.trim(), anonKey.trim());
    localStorage.setItem(SUPABASE_KEYS.url, url.trim());
    localStorage.setItem(SUPABASE_KEYS.key, anonKey.trim());
    return true;
  } catch {
    _client = null;
    return false;
  }
}

// Try to restore from localStorage on page load
export function restoreSupabase() {
  const url = localStorage.getItem(SUPABASE_KEYS.url);
  const key = localStorage.getItem(SUPABASE_KEYS.key);
  if (url && key) {
    try {
      _client = createClient(url, key);
      return true;
    } catch { return false; }
  }
  return false;
}

export function getSupabaseCredentials() {
  return {
    url: localStorage.getItem(SUPABASE_KEYS.url) || '',
    key: localStorage.getItem(SUPABASE_KEYS.key) || '',
  };
}

export function clearSupabase() {
  _client = null;
  localStorage.removeItem(SUPABASE_KEYS.url);
  localStorage.removeItem(SUPABASE_KEYS.key);
}

export function isSupabaseReady() { return !!_client; }

// ── Test connection ─────────────────────────────────────────────────────────
export async function testConnection() {
  if (!_client) return { ok: false, error: 'Not initialised' };
  try {
    const { error } = await _client.from('od_data').select('key').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Save all data ───────────────────────────────────────────────────────────
export async function cloudSave(accounts, trades, settings) {
  if (!_client) return { ok: false, error: 'Supabase not connected' };
  try {
    const { error } = await _client.from('od_data').upsert(
      { key: 'main', value: { accounts, trades, settings }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Load all data ───────────────────────────────────────────────────────────
export async function cloudLoad() {
  if (!_client) return { ok: false, error: 'Supabase not connected' };
  try {
    const { data, error } = await _client
      .from('od_data')
      .select('value, updated_at')
      .eq('key', 'main')
      .single();
    if (error) {
      if (error.code === 'PGRST116') return { ok: true, data: null }; // no rows yet
      return { ok: false, error: error.message };
    }
    return { ok: true, data: data?.value || null, updatedAt: data?.updated_at };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Merge-and-save: fetches latest cloud data, merges by trade id, then saves ─
// This prevents one user's save from wiping out another user's concurrent edits.
// Strategy:
//  - trades: merge by id. Local trades overlay cloud trades (local wins for
//    conflicts). Trades present only in cloud (added by someone else, or not
//    yet pulled locally) are preserved rather than dropped.
//  - accounts: merge by id (union, local wins for conflicts).
//  - settings: deep-merge so partial local updates don't wipe other cloud keys.
export async function mergeAndSave(localAccounts, localTrades, localSettings, excludeIds = new Set()) {
  if (!_client) return { ok: false, error: 'Supabase not connected' };
  try {
    const { data: cloudRow, error: fetchErr } = await _client
      .from('od_data')
      .select('value')
      .eq('key', 'main')
      .single();

    let cloudData = null;
    if (!fetchErr && cloudRow?.value) cloudData = cloudRow.value;

    const cloudTrades   = cloudData?.trades   || [];
    const cloudAccounts = cloudData?.accounts || [];
    const cloudSettings = cloudData?.settings || {};

    // Merge trades by id — cloud first, then overlay local (local wins).
    // Trades explicitly deleted locally (excludeIds) are removed even if
    // the cloud snapshot still has them — this makes deletes authoritative
    // and immune to races with the cloud not having caught up yet.
    const tradeMap = new Map();
    cloudTrades.forEach(t => { if (t?.id && !excludeIds.has(t.id)) tradeMap.set(t.id, t); });
    localTrades.forEach(t => { if (t?.id && !excludeIds.has(t.id)) tradeMap.set(t.id, t); });
    const mergedTrades = Array.from(tradeMap.values());

    // Merge accounts by id — union, local wins for conflicts
    const accountMap = new Map();
    cloudAccounts.forEach(a => { if (a?.id) accountMap.set(a.id, a); });
    localAccounts.forEach(a => { if (a?.id) accountMap.set(a.id, a); });
    const mergedAccounts = Array.from(accountMap.values());

    // Deep-merge settings
    const mergedSettings = { ...cloudSettings, ...localSettings };
    if (cloudSettings.lotSizes || localSettings.lotSizes) {
      mergedSettings.lotSizes = { ...(cloudSettings.lotSizes || {}), ...(localSettings.lotSizes || {}) };
    }
    if (cloudSettings.brokerCredentials || localSettings.brokerCredentials) {
      mergedSettings.brokerCredentials = { ...(cloudSettings.brokerCredentials || {}), ...(localSettings.brokerCredentials || {}) };
    }

    const { error: saveErr } = await _client.from('od_data').upsert(
      { key: 'main', value: { accounts: mergedAccounts, trades: mergedTrades, settings: mergedSettings }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (saveErr) return { ok: false, error: saveErr.message };

    return { ok: true, merged: { accounts: mergedAccounts, trades: mergedTrades, settings: mergedSettings } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
