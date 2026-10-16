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

// Always private: personal links and the Drive file. Reading status and page are shared
// unless the reader turns that off; each review says whether it is published.
export const PRIVATE_FIELDS = ['links', 'drive'];
export const READING_FIELDS = ['status', 'progress'];
const OWNER_KEY = 'estante:owner';
const DIRTY_KEY = 'estante:dirty';

export const sb = createClient(URL_, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'estante-auth' },
});

/* ---------------- splitting the collection ---------------- */

const plainCover = (c) => (c && !String(c).startsWith('data:') ? c : null);
const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Same book on two shelves: title + author surname, without accents or punctuation. */
export function bookKey(b) {
  const surname = fold((b.authors || [])[0] || '').split(' ').pop() || '';
  return fold(b.searchTitle || b.title) + '|' + surname;
}

const has = (v) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length);

/** Splits the collection into what friends may see and what stays with the owner. */
export function splitState(state) {
  const share = !(state.settings && state.settings.shareReading === false);
  const priv = {};
  const reviews = [];
  const reading = [];
  const books = state.books.map((b) => {
    const pub = { ...b };
    const mine = {};
    const hidden = share ? PRIVATE_FIELDS : [...PRIVATE_FIELDS, ...READING_FIELDS];
    for (const k of hidden) {
      if (has(pub[k])) mine[k] = pub[k];
      delete pub[k];
    }
    if (Array.isArray(b.reviews)) {
      pub.reviews = b.reviews.filter((r) => r.public);
      const own = b.reviews.filter((r) => !r.public);
      if (own.length) mine.reviews = own;
      if (!pub.reviews.length) delete pub.reviews;
    }
    if (Object.keys(mine).length) priv[b.id] = mine;
    const info = { bookId: b.id, key: bookKey(b), title: b.title, authors: (b.authors || []).slice(0, 2), cover: plainCover(b.cover), color: b.color, ink: b.ink };
    (pub.reviews || []).forEach((r) => reviews.push({ ...info, ...r }));
    if (share && b.status === 'lendo') reading.push({ ...info, page: (b.progress && b.progress.page) || 0, total: (b.progress && b.progress.total) || b.pageCount || 0, at: (b.progress && b.progress.at) || null });
    return pub;
  });
  reviews.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  return {
    pub: {
      v: 2,
      seedVersion: state.seedVersion,
      removedSections: state.removedSections || [],
      sections: state.sections,
      books,
      reviews: reviews.slice(0, 200),
      reading,
      summary: {
        count: books.length,
        sections: state.sections.length,
        reading: reading.length,
        read: share ? books.filter((b) => b.status === 'lido').length : null,
        reviews: reviews.length,
        covers: books.map((b) => plainCover(b.cover)).filter(Boolean).slice(-4),
      },
    },
    priv: { v: 2, books: priv, settings: state.settings || {} },
  };
}

export function joinState(pub, priv) {
  const extra = (priv && priv.books) || {};
  const { summary, v, reviews, reading, ...rest } = pub || {};
  const books = (rest.books || []).map((b) => {
    const e = extra[b.id] || {};
    const out = { ...b, ...e };
    if (b.reviews || e.reviews) out.reviews = [...(b.reviews || []), ...(e.reviews || [])].sort((x, y) => String(y.at).localeCompare(String(x.at)));
    return out;
  });
  const out = { ...rest, books };
  if (priv && priv.settings) out.settings = priv.settings;
  return out;
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

let feedCache = null;
/** Published reviews and current reads of everyone in the house. Cached for a minute. */
export async function loadFeed({ fresh = false } = {}) {
  if (!fresh && feedCache && Date.now() - feedCache.t < 60000) return feedCache.data;
  const [{ data: people, error }, { data: shelves, error: e2 }] = await Promise.all([
    sb.from('profiles').select('id, username, display_name'),
    sb.from('shelves').select('user_id, updated_at, reviews:data->reviews, reading:data->reading'),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const who = new Map((people || []).map((p) => [p.id, p]));
  const reviews = [];
  const reading = [];
  for (const s of shelves || []) {
    const p = who.get(s.user_id);
    if (!p) continue;
    (s.reviews || []).forEach((r) => reviews.push({ ...r, who: p }));
    (s.reading || []).forEach((r) => reading.push({ ...r, who: p }));
  }
  reviews.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  reading.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  const data = { reviews, reading };
  feedCache = { t: Date.now(), data };
  return data;
}
export const dropFeedCache = () => { feedCache = null; };

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
    feedCache = null;
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
