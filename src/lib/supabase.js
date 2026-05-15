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
