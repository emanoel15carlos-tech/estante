// Small helpers shared by the app and the comparison page.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const norm = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deterministic 32-bit hash, used to vary spine sizes and colors per book. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const cleanIsbn = (s) => String(s ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

/** True when the text looks like an ISBN-10 or ISBN-13 (hyphens and spaces allowed). */
export function isIsbn(s) {
  const raw = String(s ?? '').trim();
  if (!/^[0-9Xx\-\s]+$/.test(raw)) return false;
  const c = cleanIsbn(raw);
  return c.length === 10 || c.length === 13;
}

export function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Year as text: keeps "séc. V a.C." style values, extracts 4 digits from dates. */
export function yearOf(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  const m = s.match(/\d{4}/);
  return m && s.length <= 10 ? m[0] : s;
}

/** Accepts "site.com/x" or a full address; returns a clean http(s) URL or null. */
export function normalizeUrl(input) {
  let v = String(input || '').trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } };

/**
 * Recognises Google Drive / Docs links. Returns { kind, id, url, preview, open, label }
 * or null when the address is not a Drive item.
 */
export function parseDrive(input) {
  const url = normalizeUrl(input);
  if (!url) return null;
  let m;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'drive.google.com') {
    if ((m = u.pathname.match(/\/file\/d\/([\w-]{10,})/))) return driveItem('file', m[1]);
    if ((m = u.pathname.match(/\/folders\/([\w-]{10,})/))) return driveItem('folder', m[1]);
    const id = u.searchParams.get('id');
    if (id && /^[\w-]{10,}$/.test(id)) return driveItem('file', id);
  }
  if (host === 'docs.google.com' && (m = u.pathname.match(/\/(document|spreadsheets|presentation)\/d\/([\w-]{10,})/))) {
    return driveItem(m[1], m[2]);
  }
  return null;
}

function driveItem(kind, id) {
  const docs = { document: 'document', spreadsheets: 'spreadsheets', presentation: 'presentation' };
  if (docs[kind]) {
    const base = `https://docs.google.com/${kind}/d/${id}`;
    return { kind, id, url: `${base}/edit`, open: `${base}/edit`, preview: `${base}/preview`, label: { document: 'Documento Google', spreadsheets: 'Planilha Google', presentation: 'Apresentação Google' }[kind] };
  }
  if (kind === 'folder') {
    return { kind, id, url: `https://drive.google.com/drive/folders/${id}`, open: `https://drive.google.com/drive/folders/${id}`, preview: `https://drive.google.com/embeddedfolderview?id=${id}#grid`, label: 'Pasta no Drive' };
  }
  return { kind: 'file', id, url: `https://drive.google.com/file/d/${id}/view`, open: `https://drive.google.com/file/d/${id}/view`, preview: `https://drive.google.com/file/d/${id}/preview`, label: 'Arquivo no Drive' };
}
