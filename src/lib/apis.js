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

// Without an API key, Google Books shares one daily quota among every site that
// calls it keyless. Once it answers 429, skip it for the rest of the session.
let googleDown = false;
export const googleUnavailable = () => googleDown;

export async function searchGoogle(query, { signal, limit = 12 } = {}) {
  if (googleDown) {
    const err = new Error('Google Books indisponível');
    err.status = 429;
    throw err;
  }
  const q = isIsbn(query) ? 'isbn:' + cleanIsbn(query) : query.trim();
  const params = new URLSearchParams({ q, maxResults: String(limit), printType: 'books', country: 'BR' });
  if (GOOGLE_KEY) params.set('key', GOOGLE_KEY);
  return cached('g:' + params.toString(), async () => {
    let data;
    try {
      data = await getJson(GOOGLE + '?' + params, { signal });
    } catch (e) {
      if (e.status === 429 || e.status === 403) googleDown = true;
      throw e;
    }
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
  onStatus(googleDown ? 'Buscando na Open Library…' : 'Buscando no Google Books…');
  const tasks = [searchGoogle(query, { signal }).catch((e) => { errors.push(['google', e]); return []; })];
  if (isbnQuery) tasks.push(lookupBrasilApi(query, { signal }).catch((e) => { errors.push(['brasilapi', e]); return null; }));
  const [google, brasil] = await Promise.all(tasks);
  push(google);
  if (brasil) push([brasil]);

  if (results.length < 3) {
    onStatus(googleDown
      ? 'O Google Books atingiu o limite de consultas de hoje. Buscando na Open Library…'
      : results.length ? 'Completando com a Open Library…' : 'Nada no Google Books. Tentando a Open Library…');
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
  const list = googleDown ? [] : await searchGoogle(q, { signal, limit: 5 }).catch(() => []);
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

/* ------------------------------------------------------------------ */
/* Book insights (Open Library): reading stats, legal ways to read,     */
/* reader lists, subjects and similar books.                            */

const INSIGHT_FIELDS = [
  'key', 'title', 'author_name', 'cover_i', 'first_publish_year', 'edition_count', 'number_of_pages_median',
  'ratings_average', 'ratings_count', 'want_to_read_count', 'currently_reading_count', 'already_read_count',
  'ebook_access', 'ia', 'lending_edition_s', 'id_project_gutenberg', 'subject', 'person', 'place', 'time',
].join(',');

// Subjects that are catalogue housekeeping rather than what the book is about.
const NOISE_SUBJECT = /^(open library staff picks|accessible book|protected daisy|in library|lending library|large type books|open_syllabus_project|internet archive wishlist|overdrive|nyt:|award:|great_books_of_the_western_world|fiction$|literature$|general$|translations into|reading level|textbooks|ficção$|romance$|english language)/i;

// Subjects that record a recommendation or distinction.
function recognitionsFrom(subjects) {
  const out = [];
  for (const s of subjects || []) {
    if (s === 'great_books_of_the_western_world') out.push('Coleção Great Books of the Western World, da Encyclopaedia Britannica');
    else if (/^nyt:/i.test(s) || /new york times best/i.test(s)) out.push('Lista de mais vendidos do New York Times');
    else if (/^open_syllabus_project$/i.test(s)) out.push('Indicado em programas de cursos universitários (Open Syllabus)');
    else if (/^open library staff picks$/i.test(s)) out.push('Escolha da equipe da Open Library');
    else {
      const m = /^award:([^=]+)(?:=(.+))?$/i.exec(s);
      if (m) out.push('Prêmio ' + m[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + (m[2] ? ` (${m[2]})` : ''));
    }
  }
  return [...new Set(out)];
}

// Reader lists whose names suggest a recommendation, not a private shelf.
const NOTABLE_LIST = /(1001|must.?read|best|great|classic|cl[aá]ssic|essential|essenc|melhores|canon|c[aâ]non|top\s?\d|prize|award|pr[eê]mio|recomend|recommend|vestibular|fuvest|enem|leitura obrigat)/i;

const titleKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim();

export async function bookInsights(book, { signal } = {}) {
  const author = book.searchAuthor || (book.authors || [])[0] || '';
  const searchTitle = book.searchTitle || book.title;
  const q = book.isbn ? 'isbn:' + cleanIsbn(book.isbn) : `${searchTitle} ${author}`.trim();
  return cached('ins:' + q, async () => {
    await olThrottle();
    const params = new URLSearchParams({ q, limit: '8', fields: INSIGHT_FIELDS });
    const data = await getJson(OL + '/search.json?' + params, { signal, timeout: 15000 });
    const docs = (data && data.docs) || [];
    const want = titleKey(searchTitle);
    // Among the works whose title matches, take the one with the most editions (the canonical work).
    const matches = docs.filter((d) => { const t = titleKey(d.title); return t && (t.includes(want) || want.includes(t)); });
    const doc = (matches.length ? matches : docs).slice().sort((a, b) => (b.edition_count || 0) - (a.edition_count || 0))[0];
    if (!doc) return null;

    const subjects = doc.subject || [];
    const ia = (doc.ia || []).find((id) => !/^lp_/.test(id)) || (doc.ia || [])[0] || '';
    // Links in other languages (the Portuguese ones come from portugueseEditions).
    const other = [];
    if (doc.ebook_access === 'public' && ia) other.push({ kind: 'download', label: 'Internet Archive', note: 'Edição em domínio público, idioma conforme a edição.', url: `https://archive.org/details/${ia}` });
    (doc.id_project_gutenberg || []).slice(0, 1).forEach((id) => other.push({ kind: 'download', label: 'Projeto Gutenberg', note: 'EPUB, Kindle e texto. Geralmente no idioma original.', url: `https://www.gutenberg.org/ebooks/${id}` }));
    if (doc.ebook_access === 'borrowable' && doc.lending_edition_s) other.push({ kind: 'borrow', label: 'Empréstimo na Open Library', note: 'Empréstimo digital gratuito por tempo limitado, com conta na Open Library.', url: `${OL}/books/${doc.lending_edition_s}` });
    if (doc.key) other.push({ kind: 'info', label: 'Todas as edições na Open Library', note: `${doc.edition_count || 'Várias'} edições cadastradas, em vários idiomas.`, url: OL + doc.key });

    const authorName = (doc.author_name || [])[0] || author;
    return {
      key: doc.key || '',
      title: doc.title,
      firstYear: doc.first_publish_year || null,
      editions: doc.edition_count || 0,
      pages: doc.number_of_pages_median || 0,
      rating: doc.ratings_average ? Math.round(doc.ratings_average * 10) / 10 : null,
      ratingCount: doc.ratings_count || 0,
      want: doc.want_to_read_count || 0,
      reading: doc.currently_reading_count || 0,
      readCount: doc.already_read_count || 0,
      other,
      recognitions: recognitionsFrom(subjects),
      subjects: subjects.filter((s) => !NOISE_SUBJECT.test(s) && s.length < 60).slice(0, 14),
      people: (doc.person || []).filter((p) => !p.includes(authorName.split(' ').pop() || '§')).slice(0, 10),
      places: (doc.place || []).slice(0, 8),
      times: (doc.time || []).slice(0, 4),
      goodreads: `https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${author}`)}`,
      wikipedia: `https://pt.wikipedia.org/w/index.php?search=${encodeURIComponent(book.title + ' ' + author)}`,
    };
  });
}

/** Reader lists that include the work. This endpoint is slow, so it loads after the rest. */
export async function readerLists(workKey, { signal } = {}) {
  if (!workKey) return { total: 0, notable: [] };
  return cached('lists:' + workKey, async () => {
    const l = await getJson(`${OL}${workKey}/lists.json?limit=50`, { signal, timeout: 40000 });
    const entries = (l && l.entries) || [];
    return {
      total: (l && l.size) || entries.length,
      notable: entries.filter((e) => e.name && NOTABLE_LIST.test(e.name)).slice(0, 6).map((e) => ({ name: e.name.trim(), url: OL + e.url, count: e.seed_count || 0 })),
    };
  });
}

/** Books that share the main subject (Open Library subjects API). */
export async function similarBooks(subject, excludeKey, { signal } = {}) {
  if (!subject) return [];
  const slug = subject.toLowerCase().replace(/[^a-z0-9À-ɏ]+/gi, '_').replace(/^_|_$/g, '');
  return cached('sim:' + slug, async () => {
    await olThrottle();
    const data = await getJson(`${OL}/subjects/${encodeURIComponent(slug)}.json?limit=18`, { signal, timeout: 15000 });
    return ((data && data.works) || [])
      .filter((w) => w.key !== excludeKey && w.cover_id)
      .slice(0, 8)
      .map((w) => ({
        key: w.key,
        title: w.title,
        authors: (w.authors || []).map((a) => a.name),
        year: w.first_publish_year ? String(w.first_publish_year) : '',
        cover: olCoverById(w.cover_id, 'M'),
        coverLarge: olCoverById(w.cover_id, 'L'),
        link: OL + w.key,
      }));
  });
}

/* ------------------------------------------------------------------ */
/* Free Portuguese editions on the Internet Archive                      */

const IA_SEARCH = 'https://archive.org/advancedsearch.php';
const iaTerm = (s) => String(s || '').replace(/[()"':\\[\]{}^~*?!+&|/-]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Downloadable Portuguese editions (public domain items only: lending-library
 * collections are left out). Sorted by number of downloads.
 */
export async function portugueseEditions(book, { signal } = {}) {
  const title = iaTerm(book.title);
  if (!title) return [];
  const surnames = [...new Set([(book.authors || [])[0], book.searchAuthor]
    .filter(Boolean).map((a) => iaTerm(String(a).split(' ').pop())).filter((x) => x.length > 2))];
  // Only items that are out of copyright: old printings, Project Gutenberg mirrors,
  // or items the Archive marks as not in copyright. User uploads of modern editions are left out.
  const base = [`title:(${title})`, 'language:(por OR portuguese OR pt OR "Português")', 'mediatype:texts',
    'NOT collection:(inlibrary OR printdisabled OR lendinglibrary OR internetarchivebooks)',
    '(year:[0 TO 1929] OR collection:(gutenberg) OR possible-copyright-status:("NOT_IN_COPYRIGHT"))'];
  const withAuthor = surnames.length ? [...base, `creator:(${surnames.join(' OR ')})`] : base;
  const run = (parts) => {
    const q = parts.join(' AND ');
    const url = `${IA_SEARCH}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=date&fl[]=creator&fl[]=downloads&sort[]=downloads+desc&rows=6&output=json`;
    return cached('iapt:' + q, async () => {
      const data = await getJson(url, { signal, timeout: 20000 });
      return mapIa((data && data.response && data.response.docs) || []);
    });
  };
  // Author names are spelled many ways (Dostoiévski, Dostoyevsky…): fall back to the title alone.
  const first = await run(withAuthor);
  return first.length || withAuthor === base ? first : run(base);
}

const PIRATE = /z.?lib|libgen|library genesis|anna.?s archive|pirat/i;

function mapIa(docs) {
  return docs.filter((d) => !PIRATE.test(`${d.identifier} ${d.title}`)).slice(0, 4).map((d) => ({
    id: d.identifier,
    title: Array.isArray(d.title) ? d.title[0] : d.title,
    year: d.year || (d.date ? String(d.date).slice(0, 4) : ''),
    downloads: d.downloads || 0,
    url: `https://archive.org/details/${d.identifier}`,
  }));
}
