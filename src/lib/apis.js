// Book data sources.
// Google Books is the primary source (best coverage of Brazilian editions),
// Open Library is the fallback (open data, covers by ISBN, rich subjects),
// BrasilAPI reinforces ISBN lookups for Brazilian books.
//
// Every source is normalized to the same shape:
// { source, sourceId, title, subtitle, authors[], year, isbn, publisher,
//   synopsis, categories[], language, pageCount, cover, coverFallback, link }

import { cleanIsbn, isIsbn, sleep, stripHtml, yearOf } from './util.js';

const GOOGLE = 'https://www.googleapis.com/books/v1/volumes';
const OL = 'https://openlibrary.org';
const OL_COVERS = 'https://covers.openlibrary.org';
const BRASILAPI = 'https://brasilapi.com.br/api/isbn/v1';

const GOOGLE_KEY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_BOOKS_KEY) || '';

export const SOURCE_LABEL = {
  google: 'Google Books',
  openlibrary: 'Open Library',
  brasilapi: 'BrasilAPI',
  manual: 'Cadastro manual',
  seed: 'Acervo inicial',
};

/* ------------------------------------------------------------------ */
/* Caching: same query twice in a session never hits the network again */

const memo = new Map();
function cached(key, fn) {
  if (memo.has(key)) return memo.get(key);
  let stored = null;
  try { stored = sessionStorage.getItem('api:' + key); } catch (e) { /* storage off */ }
  if (stored) {
    const p = Promise.resolve(JSON.parse(stored));
    memo.set(key, p);
    return p;
  }
  const p = fn().then((val) => {
    try { sessionStorage.setItem('api:' + key, JSON.stringify(val)); } catch (e) { /* quota */ }
    return val;
  });
  p.catch(() => memo.delete(key));
  memo.set(key, p);
  return p;
}

async function getJson(url, { signal, timeout = 9000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/* Open Library asks for at most ~1 request per second from anonymous clients. */
let olNext = 0;
async function olThrottle() {
  const now = Date.now();
  const wait = Math.max(0, olNext - now);
  olNext = Math.max(now, olNext) + 1100;
  if (wait) await sleep(wait);
}

/* ------------------------------------------------------------------ */
/* Google Books */

function googleCover(imageLinks) {
  if (!imageLinks) return { cover: null, coverFallback: null };
  const best = imageLinks.extraLarge || imageLinks.large || imageLinks.medium || imageLinks.small || imageLinks.thumbnail || imageLinks.smallThumbnail;
  if (!best) return { cover: null, coverFallback: null };
  const https = best.replace(/^http:/, 'https:').replace('&edge=curl', '');
  // Thumbnails are small (~128px). Ask for a larger rendition and keep the
  // original as a fallback in case the larger one is not available.
  const larger = /zoom=1/.test(https) && !imageLinks.large && !imageLinks.extraLarge ? https.replace('zoom=1', 'zoom=2') : https;
  return { cover: larger, coverFallback: https };
}

export function normalizeGoogle(item) {
  const v = item.volumeInfo || {};
  const ids = v.industryIdentifiers || [];
  const isbn13 = ids.find((i) => i.type === 'ISBN_13');
  const isbn10 = ids.find((i) => i.type === 'ISBN_10');
  const { cover, coverFallback } = googleCover(v.imageLinks);
  return {
    source: 'google',
    sourceId: item.id,
    title: (v.title || '').trim(),
    subtitle: v.subtitle || '',
    authors: v.authors || [],
    year: yearOf(v.publishedDate),
    isbn: cleanIsbn((isbn13 || isbn10 || {}).identifier || ''),
    publisher: v.publisher || '',
    synopsis: stripHtml(v.description || ''),
    categories: v.categories || [],
    language: v.language || '',
    pageCount: v.pageCount || 0,
    cover,
    coverFallback,
    link: v.infoLink || v.canonicalVolumeLink || '',
  };
}

export async function searchGoogle(query, { signal, limit = 12 } = {}) {
  const q = isIsbn(query) ? 'isbn:' + cleanIsbn(query) : query.trim();
  const params = new URLSearchParams({ q, maxResults: String(limit), printType: 'books', country: 'BR' });
  if (GOOGLE_KEY) params.set('key', GOOGLE_KEY);
  return cached('g:' + params.toString(), async () => {
    const data = await getJson(GOOGLE + '?' + params, { signal });
    return ((data && data.items) || []).map(normalizeGoogle).filter((b) => b.title);
  });
}

/* ------------------------------------------------------------------ */
/* Open Library */

export const olCoverById = (id, size = 'L') => `${OL_COVERS}/b/id/${id}-${size}.jpg`;
// default=false makes the covers service answer 404 instead of a blank image.
export const olCoverByIsbn = (isbn, size = 'L') => `${OL_COVERS}/b/isbn/${cleanIsbn(isbn)}-${size}.jpg?default=false`;

export function normalizeOpenLibrary(doc) {
  const isbns = (doc.isbn || []).map(cleanIsbn);
  const isbn = isbns.find((i) => i.length === 13 && i.startsWith('97865')) || // Brazilian prefix first
    isbns.find((i) => i.length === 13 && i.startsWith('97885')) ||
    isbns.find((i) => i.length === 13) || isbns[0] || '';
  const langs = doc.language || [];
  const lang = langs.includes('por') ? 'por' : langs[0] || '';
  return {
    source: 'openlibrary',
    sourceId: doc.key || '',
    title: (doc.title || '').trim(),
    subtitle: doc.subtitle || '',
    authors: doc.author_name || [],
    year: doc.first_publish_year ? String(doc.first_publish_year) : '',
    isbn,
    publisher: (doc.publisher || [])[0] || '',
    synopsis: '', // not part of search results: fetched from the work on demand
    categories: (doc.subject || []).slice(0, 12),
    language: lang === 'por' ? 'pt' : lang === 'eng' ? 'en' : lang === 'spa' ? 'es' : lang,
    pageCount: doc.number_of_pages_median || 0,
    cover: doc.cover_i ? olCoverById(doc.cover_i, 'L') : null,
    coverFallback: doc.cover_i ? olCoverById(doc.cover_i, 'M') : null,
    link: doc.key ? OL + doc.key : '',
  };
}

const OL_FIELDS = 'key,title,subtitle,author_name,first_publish_year,cover_i,isbn,subject,language,number_of_pages_median,publisher';

export async function searchOpenLibrary(query, { signal, limit = 12 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), fields: OL_FIELDS, lang: 'pt' });
  params.set('q', isIsbn(query) ? 'isbn:' + cleanIsbn(query) : query.trim());
  return cached('o:' + params.toString(), async () => {
    await olThrottle();
    const data = await getJson(OL + '/search.json?' + params, { signal, timeout: 12000 });
    return ((data && data.docs) || []).map(normalizeOpenLibrary).filter((b) => b.title);
  });
}

/** Description of an Open Library work (search results do not include it). */
export async function openLibraryDescription(workKey, { signal } = {}) {
  if (!workKey || !workKey.startsWith('/works/')) return '';
  return cached('od:' + workKey, async () => {
    await olThrottle();
    const data = await getJson(OL + workKey + '.json', { signal });
    if (!data || !data.description) return '';
    return stripHtml(typeof data.description === 'string' ? data.description : data.description.value || '');
  });
}

/* ------------------------------------------------------------------ */
/* BrasilAPI (ISBN only) */

export function normalizeBrasilApi(d) {
  return {
    source: 'brasilapi',
    sourceId: d.isbn || '',
    title: (d.title || '').trim(),
    subtitle: d.subtitle || '',
    authors: d.authors || [],
    year: d.year ? String(d.year) : '',
    isbn: cleanIsbn(d.isbn || ''),
    publisher: d.publisher || '',
    synopsis: stripHtml(d.synopsis || ''),
    categories: d.subjects || [],
    language: '',
    pageCount: d.page_count || 0,
    cover: d.cover_url ? d.cover_url.replace(/^http:/, 'https:') : null,
    coverFallback: null,
    link: '',
  };
}

export async function lookupBrasilApi(isbn, { signal } = {}) {
  const clean = cleanIsbn(isbn);
  if (!clean) return null;
  return cached('b:' + clean, async () => {
    const data = await getJson(`${BRASILAPI}/${clean}`, { signal, timeout: 12000 });
    return data && data.title ? normalizeBrasilApi(data) : null;
  });
}

/* ------------------------------------------------------------------ */
/* Combined search used by "Adicionar livro" */

const key = (b) => (b.isbn ? 'i' + b.isbn : 't' + (b.title + '|' + (b.authors[0] || '')).toLowerCase());

/**
 * Google Books first. Open Library joins when Google fails or finds little.
 * For an ISBN, BrasilAPI is queried alongside Google.
 * onStatus(text) reports progress for the UI.
 */
export async function searchBooks(query, { signal, onStatus = () => {} } = {}) {
  const errors = [];
  const results = [];
  const seen = new Set();
  const push = (list) => list.forEach((b) => { const k = key(b); if (!seen.has(k)) { seen.add(k); results.push(b); } });

  const isbnQuery = isIsbn(query);
  onStatus('Buscando no Google Books…');
  const tasks = [searchGoogle(query, { signal }).catch((e) => { errors.push(['google', e]); return []; })];
  if (isbnQuery) tasks.push(lookupBrasilApi(query, { signal }).catch((e) => { errors.push(['brasilapi', e]); return null; }));
  const [google, brasil] = await Promise.all(tasks);
  push(google);
  if (brasil) push([brasil]);

  if (results.length < 3) {
    onStatus(results.length ? 'Completando com a Open Library…' : 'Nada no Google Books. Tentando a Open Library…');
    const ol = await searchOpenLibrary(query, { signal }).catch((e) => { errors.push(['openlibrary', e]); return []; });
    push(ol);
  }
  if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
  return { results, errors };
}

/** Checks that an image URL actually loads (Open Library answers 404 when there is no cover). */
export function probeImage(url, timeout = 8000) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const img = new Image();
    const t = setTimeout(() => { img.src = ''; resolve(false); }, timeout);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 8 ? true : false); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}

/**
 * Fills what a chosen result is missing: cover (Open Library by ISBN, then
 * BrasilAPI) and synopsis (BrasilAPI, then the Open Library work).
 */
export async function completeBook(b, { signal } = {}) {
  const out = { ...b };
  if (out.cover && !(await probeImage(out.cover))) {
    out.cover = (await probeImage(out.coverFallback)) ? out.coverFallback : null;
  }
  let brasil = null;
  if ((!out.cover || !out.synopsis) && out.isbn) {
    brasil = await lookupBrasilApi(out.isbn, { signal }).catch(() => null);
  }
  if (!out.cover && out.isbn) {
    const url = olCoverByIsbn(out.isbn);
    if (await probeImage(url)) out.cover = url;
  }
  if (!out.cover && brasil && brasil.cover && (await probeImage(brasil.cover))) out.cover = brasil.cover;
  if (!out.synopsis && brasil && brasil.synopsis) out.synopsis = brasil.synopsis;
  if (!out.synopsis && out.source === 'openlibrary') {
    out.synopsis = await openLibraryDescription(out.sourceId, { signal }).catch(() => '');
  }
  if (!out.categories.length && brasil) out.categories = brasil.categories;
  return out;
}

/** Best cover for a title/author pair (used to dress the initial collection). */
export async function findCover(title, author, { signal } = {}) {
  const q = `intitle:${title}` + (author ? ` inauthor:${author}` : '');
  const list = await searchGoogle(q, { signal, limit: 5 }).catch(() => []);
  for (const b of list) {
    if (b.cover && (await probeImage(b.cover))) return { cover: b.cover, source: 'google' };
    if (b.coverFallback && (await probeImage(b.coverFallback))) return { cover: b.coverFallback, source: 'google' };
  }
  const ol = await searchOpenLibrary(`${title} ${author || ''}`, { signal, limit: 3 }).catch(() => []);
  for (const b of ol) {
    if (b.cover && (await probeImage(b.cover))) return { cover: b.cover, source: 'openlibrary' };
  }
  return null;
}
