// PDF → chapters of paragraphs, ready to be read aloud.
// The layout work (headers, footers, page numbers, hyphenation, chapters) is plain JS so it
// can be tested without a browser; pdf.js is only loaded when someone actually opens a PDF.

const HEADING = /^(cap[ií]tulo|parte|livro|pr[oó]logo|ep[ií]logo|introdu[cç][aã]o|pref[aá]cio|apresenta[cç][aã]o|nota\b|chapter|part|book)\b/i;
const ROMAN = /^[IVXLCDM]{1,7}\.?$/;
const ENDS_SENTENCE = /[.!?…:;»"”)\]]$/;
const median = (xs) => { const s = xs.filter((x) => isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const shape = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/** Groups pdf.js text items into lines (top to bottom). */
export function itemsToLines(items) {
  const rows = [];
  for (const it of items) {
    const str = it.str;
    if (!str || !str.trim()) { if (rows.length && str === ' ') rows[rows.length - 1].parts.push(' '); continue; }
    const [a, , , d, x, y] = it.transform;
    const size = Math.abs(d) || Math.abs(a) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < size * 0.45);
    if (!row) { row = { y, x, size, parts: [], right: x }; rows.push(row); }
    row.parts.push(str);
    row.x = Math.min(row.x, x);
    row.right = Math.max(row.right, x + (it.width || 0));
    row.size = Math.max(row.size, size);
  }
  return rows
    .sort((p, q) => q.y - p.y)
    .map((r) => ({ text: r.parts.join('').replace(/\s+/g, ' ').trim(), y: r.y, x: r.x, size: r.size, width: r.right - r.x }))
    .filter((l) => l.text);
}

/**
 * pages: [{ lines: [{ text, y, x, size, width }] }]  (lines top to bottom)
 * outline: [{ title, page }]  (0-based page of each top-level bookmark), optional
 */
export function buildChapters(pages, outline = []) {
  // 1. Running headers/footers repeat on many pages (often with the page number): drop them.
  const edgeCount = new Map();
  pages.forEach((p) => {
    const edge = [...p.lines.slice(0, 2), ...p.lines.slice(-2)];
    new Set(edge.map((l) => shape(l.text))).forEach((k) => edgeCount.set(k, (edgeCount.get(k) || 0) + 1));
  });
  const minRepeat = Math.max(3, Math.ceil(pages.length * 0.25));
  const bodySizeGuess = median(pages.flatMap((p) => p.lines.map((l) => l.size))) || 10;
  const isNoise = (l, i, n) => {
    const t = l.text.trim();
    if (/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(t)) return true; // page numbers
    if (HEADING.test(t) || l.size >= bodySizeGuess * 1.25) return false; // "Capítulo 3" repeats in shape but is a title
    const atEdge = i < 2 || i >= n - 2;
    return atEdge && pages.length >= 4 && (edgeCount.get(shape(t)) || 0) >= minRepeat;
  };

  const sizes = [];
  pages.forEach((p) => p.lines.forEach((l) => sizes.push(l.size)));
  const bodySize = median(sizes) || 10;

  // 2. Lines → paragraphs (they may continue across pages).
  const paras = []; // { text, page, size, heading }
  let cur = null;
  const flush = () => { if (cur && cur.text.trim()) paras.push(cur); cur = null; };
  pages.forEach((p, pi) => {
    const lines = p.lines.filter((l, i) => !isNoise(l, i, p.lines.length));
    if (!lines.length) return;
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
    const gap = median(gaps) || bodySize * 1.4;
    const left = median(lines.map((l) => l.x));
    const full = Math.max(...lines.map((l) => l.width));
    lines.forEach((l, i) => {
      const big = l.size >= bodySize * 1.25;
      const headingLike = (big || HEADING.test(l.text) || ROMAN.test(l.text)) && l.text.length <= 80;
      const prev = i > 0 ? lines[i - 1] : null;
      const bigGap = prev && prev.y - l.y > gap * 1.6;
      const indented = l.x > left + bodySize * 0.8;
      const dialogue = /^[—–-]\s?\S/.test(l.text);
      const prevShort = prev && ENDS_SENTENCE.test(prev.text) && prev.width < full * 0.8;
      if (headingLike) {
        flush();
        if (paras.length && paras[paras.length - 1].heading && paras[paras.length - 1].page === pi) {
          paras[paras.length - 1].text += ' ' + l.text; // "Capítulo I" + "O trem da Central"
        } else {
          paras.push({ text: l.text, page: pi, heading: true });
        }
        return;
      }
      if (!cur || bigGap || indented || dialogue || prevShort || (i === 0 && cur && ENDS_SENTENCE.test(cur.text))) {
        flush();
        cur = { text: l.text, page: pi };
        return;
      }
      if (/[A-Za-zÀ-ÿ]-$/.test(cur.text) && /^[a-zà-ÿ]/.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text;
      else cur.text += ' ' + l.text;
    });
  });
  flush();

  // 3. Paragraphs → chapters: bookmarks first, then headings, then fixed-size parts.
  const chapters = [];
  const push = (title) => { chapters.push({ title: title.slice(0, 90), paragraphs: [] }); };
  const marks = (outline || []).filter((o) => o && o.title && o.page >= 0).sort((a, b) => a.page - b.page);
  if (marks.length >= 2) {
    let m = -1;
    for (const p of paras) {
      while (m + 1 < marks.length && p.page >= marks[m + 1].page) { m++; push(marks[m].title); }
      if (m < 0) { if (!chapters.length) push('Início'); }
      if (p.heading && chapters[chapters.length - 1].paragraphs.length === 0) continue; // title already said
      chapters[chapters.length - 1].paragraphs.push(p.text);
    }
  } else if (paras.filter((p) => p.heading).length >= 2) {
    for (const p of paras) {
      if (p.heading) { push(p.text); continue; }
      if (!chapters.length) push('Início');
      chapters[chapters.length - 1].paragraphs.push(p.text);
    }
  } else {
    let words = 0;
    for (const p of paras) {
      if (!chapters.length || words > 4000) { push(`Parte ${chapters.length + 1}`); words = 0; }
      chapters[chapters.length - 1].paragraphs.push(p.text);
      words += p.text.split(/\s+/).length;
    }
  }
  // Very short chapters are usually front matter or stray titles: merge them forward.
  const out = [];
  chapters.forEach((c) => {
    const prev = out[out.length - 1];
    if (prev && prev.paragraphs.join(' ').length < 120) { prev.paragraphs.push(...c.paragraphs); prev.title = prev.paragraphs.length ? prev.title : c.title; }
    else out.push(c);
  });
  return out.filter((c) => c.paragraphs.length);
}

/** Splits a paragraph into chunks a speech engine reads reliably (Chrome stops on very long ones). */
export function sentences(paragraph, max = 220) {
  const parts = String(paragraph).match(/[^.!?…]+[.!?…]+["”»)]*\s*|[^.!?…]+$/g) || [paragraph];
  const out = [];
  for (let s of parts.map((x) => x.trim()).filter(Boolean)) {
    while (s.length > max) {
      let cut = s.lastIndexOf(', ', max);
      if (cut < max * 0.4) cut = s.lastIndexOf(' ', max);
      if (cut < 1) cut = max;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

/** Reads a PDF file in the browser. Scanned (image-only) PDFs come back with no text. */
export async function readPdf(file, onProgress = () => {}) {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ lines: itemsToLines(content.items) });
    if (i % 5 === 0 || i === doc.numPages) onProgress(i / doc.numPages);
  }
  let outline = [];
  try {
    const items = (await doc.getOutline()) || [];
    for (const it of items.slice(0, 300)) {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (Array.isArray(dest) && dest[0]) outline.push({ title: it.title, page: await doc.getPageIndex(dest[0]) });
    }
  } catch (e) { outline = []; }
  const meta = await doc.getMetadata().catch(() => null);
  const chapters = buildChapters(pages, outline);
  const chars = chapters.reduce((a, c) => a + c.paragraphs.reduce((x, p) => x + p.length, 0), 0);
  return { title: (meta && meta.info && meta.info.Title) || file.name.replace(/\.pdf$/i, ''), pages: doc.numPages, chapters, chars };
}
