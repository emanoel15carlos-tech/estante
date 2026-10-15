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
