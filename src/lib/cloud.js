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
export const READING_FIELDS = ['status', 'progress', 'history', 'finishedAt'];
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
    let hidden = share ? PRIVATE_FIELDS : [...PRIVATE_FIELDS, ...READING_FIELDS];
    if (b.drive && b.driveShared) hidden = hidden.filter((k) => k !== 'drive');
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
  const stats = store.readingStats(state);
  return {
    pub: {
      v: 2,
      seedVersion: state.seedVersion,
      removedSections: state.removedSections || [],
      sections: state.sections,
      books,
      reviews: reviews.slice(0, 200),
      reading,
      done: share ? state.books.filter((b) => b.status === 'lido').map((b) => ({ k: bookKey(b), at: b.finishedAt || null })).slice(0, 1000) : [],
      summary: {
        stats: share ? stats : null,
        count: books.length,
        sections: state.sections.length,
        reading: reading.length,
        read: share ? books.filter((b) => b.status === 'lido').length : null,
        reviews: reviews.length,
        covers: books.map((b) => plainCover(b.cover)).filter(Boolean).slice(-4),
      },
    },
    priv: { v: 2, books: priv, settings: state.settings || {}, pageLog: state.pageLog || {} },
  };
}

export function joinState(pub, priv) {
  const extra = (priv && priv.books) || {};
  const { summary, v, reviews, reading, done, ...rest } = pub || {};
  const books = (rest.books || []).map((b) => {
    const e = extra[b.id] || {};
    const out = { ...b, ...e };
    if (b.reviews || e.reviews) out.reviews = [...(b.reviews || []), ...(e.reviews || [])].sort((x, y) => String(y.at).localeCompare(String(x.at)));
    return out;
  });
  const out = { ...rest, books };
  if (priv && priv.settings) out.settings = priv.settings;
  if (priv && priv.pageLog) out.pageLog = priv.pageLog;
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

const PROFILE_COLS = 'id, username, display_name, is_admin';

export async function loadProfile() {
  if (!user) return null;
  let { data, error } = await sb.from('profiles').select(PROFILE_COLS).eq('id', user.id).maybeSingle();
  if (error && /is_admin/.test(error.message || '')) {
    // Database without part 2 of the setup yet.
    ({ data, error } = await sb.from('profiles').select('id, username, display_name').eq('id', user.id).maybeSingle());
  }
  if (error) throw error;
  profile = data;
  return data;
}

function profileError(error) {
  const m = (error && error.message) || '';
  if (error && error.code === '23505') return new Error('Esse @usuário já está em uso. Escolha outro.');
  if (error && error.code === '23514') return new Error('O @usuário deve ter de 3 a 20 letras minúsculas, números ou _.');
  if (/invite_invalid/.test(m)) return Object.assign(new Error('Código de convite não confere. Peça o código a quem te chamou para a Estante.'), { invite: true });
  return error;
}

/** Opens the reader's card. Needs the house invite code, except for the very first reader. */
export async function saveProfile({ username, display_name, code }) {
  let { data, error } = await sb.rpc('join_house', { code: code || '', uname: username.toLowerCase(), dname: display_name.trim() });
  if (error && /join_house/.test(error.message || '') && /find|exist/i.test(error.message || '')) {
    // Database without part 2 of the setup: fall back to the open sign-up.
    ({ data, error } = await sb.from('profiles').upsert({ id: user.id, username: username.toLowerCase(), display_name: display_name.trim() }).select('id, username, display_name').single());
  }
  if (error) throw profileError(error);
  profile = data;
  emit('profile');
  if (!syncing) await startSync();
  return data;
}

export async function renameProfile(display_name) {
  const { data, error } = await sb.from('profiles').update({ display_name: display_name.trim() }).eq('id', user.id).select(PROFILE_COLS).single();
  if (error) throw error;
  profile = data;
  emit('profile');
}

export async function getInvite() {
  const { data, error } = await sb.rpc('get_invite');
  if (error) throw error;
  return data;
}

export async function setInvite(code) {
  const { data, error } = await sb.rpc('set_invite', { code });
  if (error) {
    if (/invite_short/.test(error.message || '')) throw new Error('Use pelo menos 6 caracteres.');
    throw error;
  }
  return data;
}

export async function listReaders() {
  const [{ data: people, error }, { data: shelves }] = await Promise.all([
    sb.from('profiles').select('id, username, display_name, created_at').order('created_at'),
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
    sb.from('shelves').select('user_id, updated_at, reviews:data->reviews, reading:data->reading, done:data->done, stats:data->summary->stats'),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const who = new Map((people || []).map((p) => [p.id, p]));
  const reviews = [];
  const reading = [];
  const done = new Map(); // book key -> readers who finished it
  const stats = [];
  for (const s of shelves || []) {
    const p = who.get(s.user_id);
    if (!p) continue;
    (s.reviews || []).forEach((r) => reviews.push({ ...r, who: p }));
    (s.reading || []).forEach((r) => reading.push({ ...r, who: p }));
    (s.done || []).forEach((d) => {
      const k = typeof d === 'string' ? d : d.k;
      if (!done.has(k)) done.set(k, []);
      done.get(k).push({ who: p, at: typeof d === 'string' ? null : d.at });
    });
    if (s.stats) stats.push({ ...s.stats, who: p });
  }
  reviews.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  reading.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  const data = { reviews, reading, done, stats, people: people || [] };
  feedCache = { t: Date.now(), data };
  return data;
}
export const dropFeedCache = () => { feedCache = null; };

/* ---------------- likes and comments ---------------- */

let social = null; // { likes: Map, comments: Map, t }
const sk = (owner, rid) => owner + ':' + rid;

export async function loadSocial({ fresh = false } = {}) {
  if (!fresh && social && Date.now() - social.t < 30000) return social;
  const [l, c] = await Promise.all([
    sb.from('review_likes').select('owner_id, review_id, user_id'),
    sb.from('review_comments').select('id, owner_id, review_id, user_id, body, created_at').order('created_at').limit(2000),
  ]);
  if (l.error || c.error) { social = { likes: new Map(), comments: new Map(), t: Date.now(), off: true }; return social; }
  const likes = new Map();
  (l.data || []).forEach((r) => { const k = sk(r.owner_id, r.review_id); if (!likes.has(k)) likes.set(k, new Set()); likes.get(k).add(r.user_id); });
  const comments = new Map();
  (c.data || []).forEach((r) => { const k = sk(r.owner_id, r.review_id); if (!comments.has(k)) comments.set(k, []); comments.get(k).push(r); });
  social = { likes, comments, t: Date.now() };
  return social;
}
export const socialFor = (owner, rid) => ({
  likes: (social && social.likes.get(sk(owner, rid))) || new Set(),
  comments: (social && social.comments.get(sk(owner, rid))) || [],
  off: !social || social.off,
});

export async function toggleLike(owner, rid) {
  await loadSocial();
  const k = sk(owner, rid);
  const set = social.likes.get(k) || new Set();
  const liked = set.has(user.id);
  const q = liked
    ? sb.from('review_likes').delete().match({ owner_id: owner, review_id: rid, user_id: user.id })
    : sb.from('review_likes').insert({ owner_id: owner, review_id: rid, user_id: user.id });
  const { error } = await q;
  if (error) throw error;
  liked ? set.delete(user.id) : set.add(user.id);
  social.likes.set(k, set);
  return !liked;
}

export async function addComment(owner, rid, body) {
  const { data, error } = await sb.from('review_comments').insert({ owner_id: owner, review_id: rid, user_id: user.id, body: body.trim() }).select().single();
  if (error) throw error;
  await loadSocial();
  const k = sk(owner, rid);
  social.comments.set(k, [...(social.comments.get(k) || []), data]);
  return data;
}

export async function removeComment(owner, rid, id) {
  const { error } = await sb.from('review_comments').delete().eq('id', id);
  if (error) throw error;
  const k = sk(owner, rid);
  if (social) social.comments.set(k, (social.comments.get(k) || []).filter((c) => c.id !== id));
}

/* ---------------- leitura da casa ---------------- */

export async function loadHouseReads() {
  const { data, error } = await sb.from('house_reads').select('id, book, note, ends_on, created_by, created_at, closed').eq('closed', false).order('created_at', { ascending: false });
  if (error) return null; // part 2 of the setup not applied yet
  return data || [];
}

export async function proposeHouseRead(book, { note, ends_on }) {
  const payload = { key: bookKey(book), title: book.title, authors: (book.authors || []).slice(0, 3), cover: plainCover(book.cover), color: book.color, ink: book.ink, year: book.year || '', pageCount: book.pageCount || (book.progress && book.progress.total) || 0, synopsis: (book.synopsis || '').slice(0, 600), isbn: book.isbn || '' };
  const { data, error } = await sb.from('house_reads').insert({ book: payload, note: note || null, ends_on: ends_on || null, created_by: user.id }).select().single();
  if (error) throw error;
  return data;
}

export async function closeHouseRead(id) {
  const { error } = await sb.from('house_reads').update({ closed: true }).eq('id', id);
  if (error) throw error;
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

let baseAt = 0; // cloud version this browser last saw or wrote
let startChoice = null;
export const needsStartChoice = () => !!startChoice;
export const startChoiceInfo = () => startChoice && startChoice.info;
export function chooseStart(kind) {
  if (startChoice) startChoice.resolve(kind);
}

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
      // First sign-in: the reader chooses how the shelf starts.
      const mine = !owner || owner === user.id;
      const local = store.getState();
      const info = { localCount: mine && !store.isPristine(local) ? local.books.length : 0 };
      const kind = await new Promise((resolve) => { startChoice = { resolve, info }; emit('choose-start'); });
      startChoice = null;
      if (kind === 'empty') store.replaceAll(store.emptyCollection(), { cloud: true });
      else if (kind === 'seed' || !mine) store.replaceAll(null, { cloud: true });
      ls.set(OWNER_KEY, user.id);
      emit('started');
      await pushNow(true);
    } else if (owner === user.id && dirty > cloudAt) {
      // Changes made here that never reached the cloud win.
      baseAt = cloudAt;
      await pushNow(true);
    } else {
      ls.set(OWNER_KEY, user.id);
      store.replaceAll(joinState(pub.data, priv && priv.data), { cloud: true });
      ls.set(DIRTY_KEY, null);
      baseAt = cloudAt;
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

/** Brings the account's version into this browser, replacing what is here. */
export async function pullNow() {
  if (!user) return;
  const [{ data: pub, error: e1 }, { data: priv }] = await Promise.all([
    sb.from('shelves').select('data, updated_at').eq('user_id', user.id).maybeSingle(),
    sb.from('shelves_private').select('data').eq('user_id', user.id).maybeSingle(),
  ]);
  if (e1 || !pub) return;
  clearTimeout(pushT);
  store.endVisit();
  store.replaceAll(joinState(pub.data, priv && priv.data), { cloud: true });
  ls.set(DIRTY_KEY, null);
  baseAt = Date.parse(pub.updated_at);
  setStatus('saved');
  emit('pulled');
}

async function remoteAt() {
  const { data } = await sb.from('shelves').select('updated_at').eq('user_id', user.id).maybeSingle();
  return data ? Date.parse(data.updated_at) : 0;
}

// Coming back to this tab: another device may have changed the shelf meanwhile.
async function checkRemote() {
  if (!user || !syncing || store.isReadOnly() || !baseAt) return;
  if (status.state === 'saving' || status.state === 'loading' || status.state === 'conflict') return;
  const at = await remoteAt().catch(() => 0);
  if (at <= baseAt + 1000) return;
  if (status.state === 'pending') { setStatus('conflict'); emit('conflict'); return; }
  await pullNow();
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkRemote(); });
  window.addEventListener('focus', () => checkRemote());
}

/** Photos taken on the phone go to the Storage bucket instead of inside the shelf data. */
async function uploadCovers() {
  const local = store.getState().books.filter((b) => b.cover && String(b.cover).startsWith('data:'));
  for (const b of local) {
    try {
      const blob = await (await fetch(b.cover)).blob();
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${user.id}/${b.id}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('covers').upload(path, blob, { contentType: blob.type || 'image/jpeg', cacheControl: '31536000' });
      if (error) return; // bucket missing (part 2 of the setup) or no permission: keep the photo inline
      const url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
      store.updateBook(b.id, { cover: url }, { cloud: true });
    } catch (e) {
      return;
    }
  }
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

export function pushNow(force = false, { override = false } = {}) {
  clearTimeout(pushT);
  if (!user || (!force && status.state !== 'pending')) return pushing;
  if (store.isReadOnly()) return pushing;
  pushing = pushing.then(async () => {
    if (!override && baseAt) {
      const at = await remoteAt().catch(() => 0);
      if (at > baseAt + 1000) { setStatus('conflict'); emit('conflict'); return; }
    }
    setStatus('saving');
    await uploadCovers();
    const { pub, priv } = splitState(store.getState());
    const now = new Date().toISOString();
    const [r1, r2] = await Promise.all([
      sb.from('shelves').upsert({ user_id: user.id, data: pub, updated_at: now }),
      sb.from('shelves_private').upsert({ user_id: user.id, data: priv, updated_at: now }),
    ]);
    const err = r1.error || r2.error;
    if (err) { setStatus('error', err); return; }
    baseAt = Date.parse(now);
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
    baseAt = 0;
    if (startChoice) { startChoice.resolve('seed'); startChoice = null; }
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
        try { await saveProfile({ username: m.username, display_name: m.display_name, code: m.invite || '' }); } catch (e) { /* name taken or wrong code: ask */ }
      }
    }
  } catch (e) {
    setStatus('error', e);
  }
  emit('signed-in');
  if (profile) await startSync();
}
