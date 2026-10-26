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

// Links and the Drive file are seen by house mates unless the reader turns that off (for all
// books, or for one book). Reading status and page likewise; each review says if it is published.
export const PRIVATE_FIELDS = ['links', 'drive', 'audiobook'];
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
  const shareLinks = !(state.settings && state.settings.shareLinks === false);
  const files = [];
  const priv = {};
  const reviews = [];
  const reading = [];
  const books = state.books.map((b) => {
    const pub = { ...b };
    const mine = {};
    const linksOpen = shareLinks && !b.linksPrivate;
    let hidden = share ? [] : [...READING_FIELDS];
    if (!linksOpen) hidden = [...hidden, ...PRIVATE_FIELDS];
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
    const audio = b.audiobook && b.audiobook.tracks && b.audiobook.tracks.length ? { source: b.audiobook.source || 'link', tracks: b.audiobook.tracks.slice(0, 200) } : null;
    if (linksOpen && (b.drive || (b.links && b.links.length) || audio)) files.push({ ...info, drive: b.drive || null, links: (b.links || []).slice(0, 20), audiobook: audio });
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
      files: files.slice(0, 1000),
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
  const { summary, v, reviews, reading, done, files, ...rest } = pub || {};
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

const PROFILE_COLS = 'id, username, display_name';

export async function loadProfile() {
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select(PROFILE_COLS).eq('id', user.id).maybeSingle();
  if (error) throw error;
  profile = data;
  return data;
}

function profileError(error) {
  const m = (error && error.message) || '';
  if (error && error.code === '23505') return new Error('Esse @usuário já está em uso. Escolha outro.');
  if (error && error.code === '23514') return new Error('O @usuário deve ter de 3 a 20 letras minúsculas, números ou _.');
  if (error && (error.code === '42501' || /permission|row-level/i.test(m))) return new Error('O cadastro está fechado no servidor. Falta rodar a parte 3 da configuração do Supabase.');
  return error;
}

/** Opens the reader's card. Anyone with an account can; houses come later, from the profile. */
export async function saveProfile({ username, display_name }) {
  const { data, error } = await sb.from('profiles').insert({ id: user.id, username: username.toLowerCase(), display_name: display_name.trim() }).select(PROFILE_COLS).single();
  if (error) throw profileError(error);
  profile = data;
  emit('profile');
  if (!syncing) await startSync();
  await joinPendingInvite();
  return data;
}

export async function renameProfile(display_name) {
  const { data, error } = await sb.from('profiles').update({ display_name: display_name.trim() }).eq('id', user.id).select(PROFILE_COLS).single();
  if (error) throw error;
  profile = data;
  emit('profile');
}

/* ---------------- houses ---------------- */

let houses = null; // [{ id, name, owner_id, invite_code, role, members: [{ user_id, role, profile }] }]
export const myHouses = () => houses || [];
const PENDING_KEY = 'estante:invite';

function houseError(error) {
  const m = (error && error.message) || '';
  if (/invite_invalid/.test(m)) return new Error('Esse código não abre nenhuma casa. Confira com quem te convidou.');
  if (/owner_cannot_leave/.test(m)) return new Error('Quem criou a casa não pode sair dela. Você pode apagar a casa.');
  if (/not_owner/.test(m)) return new Error('Só quem criou a casa pode fazer isso.');
  if (/houses|house_members|create_house|enter_house/.test(m) && /exist|find|schema/i.test(m)) return Object.assign(new Error('Falta rodar a parte 3 da configuração do Supabase.'), { setup: true });
  return error;
}

export async function loadHouses() {
  if (!user || !profile) { houses = []; return houses; }
  const { data: mine, error } = await sb.from('house_members').select('role, house:houses(id, name, owner_id, invite_code, created_at)').eq('user_id', user.id);
  if (error) { houses = []; throw houseError(error); }
  const list = (mine || []).filter((r) => r.house).map((r) => ({ ...r.house, role: r.role, members: [] }));
  if (list.length) {
    const ids = list.map((h) => h.id);
    const [{ data: members }, { data: people }] = await Promise.all([
      sb.from('house_members').select('house_id, user_id, role, joined_at').in('house_id', ids).order('joined_at'),
      sb.from('profiles').select('id, username, display_name'),
    ]);
    const who = new Map((people || []).map((p) => [p.id, p]));
    for (const m of members || []) {
      const h = list.find((x) => x.id === m.house_id);
      if (h) h.members.push({ ...m, profile: who.get(m.user_id) || null });
    }
  }
  list.sort((a, b) => (a.owner_id === user.id ? -1 : 0) - (b.owner_id === user.id ? -1 : 0) || String(a.created_at).localeCompare(String(b.created_at)));
  houses = list;
  return houses;
}

async function houseRpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw houseError(error);
  feedCache = null;
  social = null;
  await loadHouses().catch(() => {});
  emit('houses');
  return data;
}
export const createHouse = (name) => houseRpc('create_house', { hname: name });
export const enterHouse = (code) => houseRpc('enter_house', { code: String(code || '').trim() });
export const leaveHouse = (id) => houseRpc('leave_house', { h: id });
export const renewInvite = (id) => houseRpc('renew_invite', { h: id });
export const renameHouse = (id, name) => houseRpc('rename_house', { h: id, hname: name });
export const removeMember = (id, member) => houseRpc('remove_member', { h: id, member });
export const deleteHouse = (id) => houseRpc('delete_house', { h: id });

/** An invite link opened before the account existed is kept until the reader's card is open. */
export function rememberInvite(code) { ls.set(PENDING_KEY, code); }
export const pendingInvite = () => ls.get(PENDING_KEY);
export async function joinPendingInvite() {
  const code = ls.get(PENDING_KEY);
  if (!code || !profile) return null;
  ls.set(PENDING_KEY, null);
  try {
    const h = await enterHouse(code);
    emit('joined', h);
    return h;
  } catch (e) {
    emit('join-failed', e);
    return null;
  }
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
    sb.from('shelves').select('user_id, updated_at, reviews:data->reviews, reading:data->reading, done:data->done, files:data->files, stats:data->summary->stats'),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const who = new Map((people || []).map((p) => [p.id, p]));
  const reviews = [];
  const reading = [];
  const done = new Map(); // book key -> readers who finished it
  const stats = [];
  const files = new Map(); // book key -> [{ who, drive, links, bookId }]
  for (const s of shelves || []) {
    const p = who.get(s.user_id);
    if (!p) continue;
    (s.files || []).forEach((f) => { if (!files.has(f.key)) files.set(f.key, []); files.get(f.key).push({ ...f, who: p }); });
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
  const data = { reviews, reading, done, files, stats, people: people || [] };
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
  const { data, error } = await sb.from('house_reads').select('id, house_id, book, note, ends_on, created_by, created_at, closed').eq('closed', false).order('created_at', { ascending: false });
  if (error) return null; // part 2 of the setup not applied yet
  return data || [];
}

export async function proposeHouseRead(book, { note, ends_on, house_id }) {
  const payload = { key: bookKey(book), title: book.title, authors: (book.authors || []).slice(0, 3), cover: plainCover(book.cover), color: book.color, ink: book.ink, year: book.year || '', pageCount: book.pageCount || (book.progress && book.progress.total) || 0, synopsis: (book.synopsis || '').slice(0, 600), isbn: book.isbn || '' };
  const { data, error } = await sb.from('house_reads').insert({ book: payload, note: note || null, ends_on: ends_on || null, created_by: user.id, house_id: house_id || (myHouses()[0] && myHouses()[0].id) || null }).select().single();
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
    houses = null;
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
  if (profile) await loadHouses().catch(() => {});
  emit('signed-in');
  if (profile) { await startSync(); await joinPendingInvite(); }
}
