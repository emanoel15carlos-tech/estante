// Accounts and sync (Supabase). The browser copy in localStorage stays the working copy;
// the account keeps it in the cloud so it follows the reader to any device and friends can see it.
//
// What friends see lives in `shelves`. What only the owner sees (personal links, the Drive
// file, reading status) lives in `shelves_private`, protected by row-level security.
import { createClient } from '@supabase/supabase-js';
import * as store from './store.js';

const URL_ = (import.meta.env && import.meta.env.VITE_SUPABASE_URL) || 'https://ltgdtdkieiqstmquroll.supabase.co';
// Public "anon" key: safe in the browser, access is governed by the policies in the database.
const ANON = (import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0Z2R0ZGtpZWlxc3RtcXVyb2xsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMTQ4NTMsImV4cCI6MjEwNzY5MDg1M30.k8KjHTxTxAvF3m4KTfbbGQX0DMln5MDFfVj7_M5ljVY';

export const PRIVATE_FIELDS = ['links', 'drive', 'status'];
const OWNER_KEY = 'estante:owner';
const DIRTY_KEY = 'estante:dirty';

export const sb = createClient(URL_, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'estante-auth' },
});

/* ---------------- splitting the collection ---------------- */

/** Splits the collection into what friends may see and what stays with the owner. */
export function splitState(state) {
  const priv = {};
  const books = state.books.map((b) => {
    const pub = { ...b };
    const mine = {};
    for (const k of PRIVATE_FIELDS) {
      if (pub[k] !== undefined && pub[k] !== null && !(Array.isArray(pub[k]) && !pub[k].length)) mine[k] = pub[k];
      delete pub[k];
    }
    if (Object.keys(mine).length) priv[b.id] = mine;
    return pub;
  });
  return {
    pub: {
      v: 1,
      seedVersion: state.seedVersion,
      removedSections: state.removedSections || [],
      sections: state.sections,
      books,
      summary: { count: books.length, sections: state.sections.length, covers: books.filter((b) => b.cover && !String(b.cover).startsWith('data:')).slice(-4).map((b) => b.cover) },
    },
    priv: { v: 1, books: priv },
  };
}

export function joinState(pub, priv) {
  const extra = (priv && priv.books) || {};
  const { summary, v, ...rest } = pub || {};
  return { ...rest, books: (rest.books || []).map((b) => ({ ...b, ...(extra[b.id] || {}) })) };
}

/* ---------------- session ---------------- */

let user = null;
let profile = null;
const listeners = new Set();
export const currentUser = () => user;
export const currentProfile = () => profile;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (event) => listeners.forEach((fn) => fn({ event, user, profile }));

const redirectTo = () => location.origin + location.pathname;

export async function signUp(email, password, meta) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: meta, emailRedirectTo: redirectTo() } });
  if (error) throw error;
  return { needsConfirm: !data.session };
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function sendReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  if (error) throw error;
}

export async function setPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await pushNow();
  await sb.auth.signOut();
}

/* ---------------- profiles ---------------- */

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export async function loadProfile() {
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select('id, username, display_name').eq('id', user.id).maybeSingle();
  if (error) throw error;
  profile = data;
  return data;
}

export async function saveProfile({ username, display_name }) {
  const row = { id: user.id, username: username.toLowerCase(), display_name: display_name.trim() };
  const { data, error } = await sb.from('profiles').upsert(row).select('id, username, display_name').single();
  if (error) {
    if (error.code === '23505') throw new Error('Esse @usuário já está em uso. Escolha outro.');
    if (error.code === '23514') throw new Error('O @usuário deve ter de 3 a 20 letras minúsculas, números ou _.');
    throw error;
  }
  profile = data;
  emit('profile');
  if (!syncing) await startSync();
  return data;
}

export async function listReaders() {
  const [{ data: people, error }, { data: shelves }] = await Promise.all([
    sb.from('profiles').select('id, username, display_name, created_at').order('display_name'),
    sb.from('shelves').select('user_id, updated_at, summary:data->summary'),
  ]);
  if (error) throw error;
  const byId = new Map((shelves || []).map((s) => [s.user_id, s]));
  return (people || []).map((p) => ({ ...p, shelf: byId.get(p.id) || null }));
}

export async function loadShelf(username) {
  const { data: p, error } = await sb.from('profiles').select('id, username, display_name').eq('username', username.toLowerCase()).maybeSingle();
  if (error) throw error;
  if (!p) return null;
  const { data: s, error: e2 } = await sb.from('shelves').select('data, updated_at').eq('user_id', p.id).maybeSingle();
  if (e2) throw e2;
  return { profile: p, data: s ? joinState(s.data, null) : null, updated_at: s && s.updated_at };
}

/* ---------------- sync ---------------- */

let syncing = false;
let pushT = null;
let pushing = Promise.resolve();
let unsub = null;
const status = { state: 'idle', at: null, error: null };
export const syncStatus = () => ({ ...status });

function setStatus(state, error = null) {
  status.state = state;
  status.error = error;
  if (state === 'saved') status.at = new Date();
  emit('sync');
}

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* blocked */ } },
};

async function startSync() {
  if (!user || !profile || syncing) return;
  syncing = true;
  setStatus('loading');
  try {
    const [{ data: pub, error: e1 }, { data: priv, error: e2 }] = await Promise.all([
      sb.from('shelves').select('data, updated_at').eq('user_id', user.id).maybeSingle(),
      sb.from('shelves_private').select('data').eq('user_id', user.id).maybeSingle(),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const owner = ls.get(OWNER_KEY);
    const dirty = Number(ls.get(DIRTY_KEY) || 0);
    const cloudAt = pub ? Date.parse(pub.updated_at) : 0;

    if (!pub) {
      // First sign-in: the books in this browser become the account's collection,
      // unless they belong to someone else who used this browser before.
      if (owner && owner !== user.id) store.replaceAll(null, { cloud: true });
      ls.set(OWNER_KEY, user.id);
      await pushNow(true);
    } else if (owner === user.id && dirty > cloudAt) {
      // Changes made here that never reached the cloud win.
      await pushNow(true);
    } else {
      ls.set(OWNER_KEY, user.id);
      store.replaceAll(joinState(pub.data, priv && priv.data), { cloud: true });
      ls.set(DIRTY_KEY, null);
      setStatus('saved');
    }
  } catch (e) {
    syncing = false;
    setStatus('error', e);
    return;
  }
  unsub = store.subscribe((_, meta) => {
    if (meta.cloud || meta.visit || store.isReadOnly()) return;
    ls.set(DIRTY_KEY, String(Date.now()));
    schedulePush();
  });
}

function stopSync() {
  syncing = false;
  clearTimeout(pushT);
  if (unsub) unsub();
  unsub = null;
}

function schedulePush() {
  clearTimeout(pushT);
  setStatus('pending');
  pushT = setTimeout(() => pushNow(), 1500);
}

export function pushNow(force = false) {
  clearTimeout(pushT);
  if (!user || (!force && status.state !== 'pending')) return pushing;
  const state = store.isReadOnly() ? null : store.getState();
  if (!state) return pushing;
  pushing = pushing.then(async () => {
    setStatus('saving');
    const { pub, priv } = splitState(state);
    const now = new Date().toISOString();
    const [r1, r2] = await Promise.all([
      sb.from('shelves').upsert({ user_id: user.id, data: pub, updated_at: now }),
      sb.from('shelves_private').upsert({ user_id: user.id, data: priv, updated_at: now }),
    ]);
    const err = r1.error || r2.error;
    if (err) { setStatus('error', err); return; }
    ls.set(DIRTY_KEY, null);
    ls.set(OWNER_KEY, user.id);
    setStatus('saved');
  }).catch((e) => setStatus('error', e));
  return pushing;
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (status.state === 'pending') pushNow(); });

/* ---------------- boot ---------------- */

let recovering = false;
export const isRecovering = () => recovering;

export async function boot() {
  sb.auth.onAuthStateChange((event, session) => {
    // Supabase advises against awaiting other calls inside this callback.
    setTimeout(() => handleAuth(event, session), 0);
  });
}

let lastUid = undefined;
async function handleAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; }
  const next = session ? session.user : null;
  if ((next && next.id) === (lastUid || null) && event !== 'PASSWORD_RECOVERY' && event !== 'USER_UPDATED') {
    user = next;
    return;
  }
  lastUid = next ? next.id : null;
  user = next;
  if (!user) {
    const wasSyncing = syncing;
    stopSync();
    profile = null;
    if (wasSyncing && ls.get(OWNER_KEY)) {
      // Leaving the account: don't keep someone's private links in a shared browser.
      ls.set(OWNER_KEY, null);
      ls.set(DIRTY_KEY, null);
      store.endVisit();
      store.replaceAll(null, { cloud: true });
    }
    emit('signed-out');
    return;
  }
  try {
    await loadProfile();
    if (!profile) {
      const m = user.user_metadata || {};
      if (m.username && USERNAME_RE.test(m.username) && m.display_name) {
        try { await saveProfile({ username: m.username, display_name: m.display_name }); } catch (e) { /* name taken: ask */ }
      }
    }
  } catch (e) {
    setStatus('error', e);
  }
  emit('signed-in');
  if (profile) await startSync();
}
