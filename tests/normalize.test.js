import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGoogle, normalizeOpenLibrary, normalizeBrasilApi } from '../src/lib/apis.js';
import { suggestSection, translateCategory } from '../src/lib/categories.js';
import { isIsbn, cleanIsbn, stripHtml, yearOf } from '../src/lib/util.js';

const sections = [
  { id: 'in', name: 'Infantil & juvenil' },
  { id: 'sf', name: 'Ficção científica' },
  { id: 'fn', name: 'Fantasia' },
  { id: 'br', name: 'Literatura brasileira' },
  { id: 'cl', name: 'Clássicos do mundo' },
  { id: 'fa', name: 'Fantástico & horror' },
  { id: 'fi', name: 'Filosofia & ideias' },
];

test('Google Books volume is normalized', () => {
  const b = normalizeGoogle({
    id: 'abc',
    volumeInfo: {
      title: ' Torto Arado ', authors: ['Itamar Vieira Junior'], publishedDate: '2019-08-01',
      industryIdentifiers: [{ type: 'ISBN_10', identifier: '8554510026' }, { type: 'ISBN_13', identifier: '9788554510026' }],
      description: '<p>Nas profundezas do sertão…</p>', categories: ['Fiction'], language: 'pt', pageCount: 264,
      imageLinks: { smallThumbnail: 'http://books.google.com/x?zoom=5', thumbnail: 'http://books.google.com/x?id=1&zoom=1&edge=curl' },
      infoLink: 'https://books.google.com/books?id=abc',
    },
  });
  assert.equal(b.title, 'Torto Arado');
  assert.equal(b.isbn, '9788554510026');
  assert.equal(b.year, '2019');
  assert.equal(b.synopsis, 'Nas profundezas do sertão…');
  assert.ok(b.cover.startsWith('https://'));
  assert.ok(!b.cover.includes('edge=curl'));
  assert.equal(b.coverFallback, 'https://books.google.com/x?id=1&zoom=1');
  assert.equal(suggestSection(b, sections), 'br');
});

test('Open Library doc is normalized and prefers Brazilian ISBN', () => {
  const b = normalizeOpenLibrary({
    key: '/works/OL1W', title: 'Frankenstein', author_name: ['Mary Shelley'], first_publish_year: 1818,
    cover_i: 123, isbn: ['0141439475', '9780141439471', '9788525432186'], subject: ['Horror tales', 'Monsters'],
    language: ['eng', 'por'],
  });
  assert.equal(b.isbn, '9788525432186');
  assert.equal(b.language, 'pt');
  assert.equal(b.cover, 'https://covers.openlibrary.org/b/id/123-L.jpg');
  assert.equal(suggestSection(b, sections), 'fa');
});

test('BrasilAPI response is normalized', () => {
  const b = normalizeBrasilApi({ isbn: '9788535910663', title: 'O Alienista', authors: ['Machado de Assis'], year: 2007, synopsis: 'x', subjects: ['Ficção brasileira'], cover_url: 'http://img/x.jpg', page_count: 96 });
  assert.equal(b.cover, 'https://img/x.jpg');
  assert.equal(b.year, '2007');
  assert.equal(b.pageCount, 96);
});

test('categories map to sections and translate', () => {
  assert.equal(suggestSection({ categories: ['Philosophy'], title: 'Ética' }, sections), 'fi');
  assert.equal(suggestSection({ categories: ['Fiction'], language: 'en', isbn: '9780141439471', title: 'Emma' }, sections), 'cl');
  assert.equal(translateCategory(['Juvenile Fiction / Animals']), 'Infantojuvenil');
  assert.equal(translateCategory(['Biography & Autobiography']), 'Biografias');
  assert.equal(suggestSection({ categories: ['Poesia'], title: 'x' }, [...sections, { id: 's1', name: 'Poesia' }]), 's1');
});

test('util helpers', () => {
  assert.ok(isIsbn('978-85-359-1066-3'));
  assert.ok(isIsbn('853591066X'));
  assert.ok(!isIsbn('Dom Casmurro'));
  assert.equal(cleanIsbn('978-85 359'), '97885359');
  assert.equal(stripHtml('a<br>b &amp; c'), 'a\nb & c');
  assert.equal(yearOf('2019-08-01'), '2019');
  assert.equal(yearOf('séc. II'), 'séc. II');
});

import { normalizeUrl } from '../src/lib/util.js';
test('personal links are validated', () => {
  assert.equal(normalizeUrl('site.com/livro'), 'https://site.com/livro');
  assert.equal(normalizeUrl('http://exemplo.org'), 'http://exemplo.org/');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('nada'), null);
  assert.equal(normalizeUrl(''), null);
});

test('new sections are suggested from API categories', () => {
  assert.equal(suggestSection({ categories: ['Juvenile Fiction / Animals'], title: 'x' }, sections), 'in');
  assert.equal(suggestSection({ categories: ['Fiction / Science Fiction / Space Opera'], title: 'x' }, sections), 'sf');
  assert.equal(suggestSection({ categories: ['Fiction / Fantasy / Epic'], title: 'x' }, sections), 'fn');
});

import { parseDrive } from '../src/lib/util.js';
test('parseDrive recognises Drive and Docs links', () => {
  const f = parseDrive('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing');
  assert.equal(f.kind, 'file');
  assert.equal(f.preview, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview');
  assert.equal(parseDrive('drive.google.com/open?id=1AbCdEfGhIjKlMnOp').id, '1AbCdEfGhIjKlMnOp');
  assert.equal(parseDrive('https://drive.google.com/drive/u/0/folders/1FolderIdXyz123').kind, 'folder');
  assert.equal(parseDrive('https://docs.google.com/document/d/1DocIdXyz12345/edit').preview, 'https://docs.google.com/document/d/1DocIdXyz12345/preview');
  assert.equal(parseDrive('https://example.com/file/d/1AbCdEfGhIjKlMnOp'), null);
  assert.equal(parseDrive('javascript:alert(1)'), null);
});

test('cloud split: reading shared unless turned off, private reviews stay private', async () => {
  const { splitState, joinState, bookKey } = await import('../src/lib/cloud.js');
  const state = { seedVersion: 3, removedSections: [], sections: [{ id: 'fi', name: 'Ficção' }], books: [
    { id: 'a', title: 'Dom Casmurro', authors: ['Machado de Assis'], status: 'lendo', progress: { page: 50, total: 200 },
      links: [{ id: 'l', url: 'https://x.org' }], drive: { id: 'D' }, cover: 'https://c/a.jpg',
      reviews: [{ id: 'r1', text: 'público', public: true, at: '2026-10-02' }, { id: 'r2', text: 'segredo', public: false, at: '2026-10-01' }] },
    { id: 'b', title: 'B', links: [] },
  ] };
  const { pub, priv } = splitState(state);
  const p = JSON.stringify(pub);
  assert.equal(p.includes('x.org'), true); // shared with house mates by default
  assert.equal(p.includes('segredo'), false);
  assert.equal(p.includes('público'), true);
  assert.equal(pub.books[0].status, 'lendo');
  assert.equal(pub.reading[0].page, 50);
  assert.equal(pub.reviews[0].key, bookKey(state.books[0]));
  assert.equal(pub.summary.count, 2);
  const back = joinState(pub, priv);
  assert.equal(back.books[0].drive.id, 'D');
  assert.deepEqual(back.books[0].reviews.map((r) => r.id), ['r1', 'r2']);
  assert.equal(back.summary, undefined);

  const hidden = splitState({ ...state, settings: { shareReading: false } });
  assert.equal(hidden.pub.books[0].status, undefined);
  assert.equal(hidden.pub.reading.length, 0);
  assert.equal(joinState(hidden.pub, hidden.priv).books[0].progress.page, 50);
  assert.equal(joinState(hidden.pub, hidden.priv).settings.shareReading, false);
  assert.equal(bookKey({ title: 'Dom  Casmurro!', authors: ['Machado de ASSIS'] }), bookKey(state.books[0]));
});

test('links and Drive are shared with house mates unless turned off', async () => {
  const { splitState, joinState } = await import('../src/lib/cloud.js');
  const book = { id: 'a', title: 'A', drive: { id: 'D', url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view' }, links: [{ id: 'l', url: 'https://x.org' }] };
  const base = { seedVersion: 3, removedSections: [], sections: [], books: [book] };
  const open = splitState(base);
  assert.equal(open.pub.books[0].drive.id, 'D');
  assert.equal(open.pub.files.length, 1);
  assert.equal(open.pub.files[0].links[0].url, 'https://x.org');
  const onePrivate = splitState({ ...base, books: [{ ...book, linksPrivate: true }] });
  assert.equal(onePrivate.pub.books[0].drive, undefined);
  assert.equal(onePrivate.pub.files.length, 0);
  assert.equal(joinState(onePrivate.pub, onePrivate.priv).books[0].links[0].url, 'https://x.org');
  const allPrivate = splitState({ ...base, settings: { shareLinks: false } });
  assert.equal(JSON.stringify(allPrivate.pub).includes('x.org'), false);
  assert.equal(joinState(allPrivate.pub, allPrivate.priv).books[0].drive.id, 'D');
});

test('reading stats count books finished this year, the goal and pages this month', async () => {
  const store = await import('../src/lib/store.js');
  const now = new Date('2026-10-16T12:00:00Z');
  const s = {
    books: [
      { id: '1', status: 'lido', finishedAt: '2026-03-01T00:00:00Z' },
      { id: '2', status: 'lido', finishedAt: '2025-12-01T00:00:00Z' },
      { id: '3', status: 'lendo' },
    ],
    settings: { goal: { year: 2026, books: 12 } },
    pageLog: { '2026-10': 120, '2026-09': 80, '2025-10': 999 },
  };
  assert.deepEqual(store.readingStats(s, now), { year: 2026, read: 1, goal: 12, pagesMonth: 120, pagesYear: 200 });
  assert.equal(store.emptyCollection().books.length, 0);
  assert.ok(store.emptyCollection().sections.length >= 9);
  assert.equal(store.isPristine({ books: [{ id: 'seed-1' }] }), true);
  assert.equal(store.isPristine({ books: [{ id: 'seed-1', status: 'lido' }] }), false);
  assert.equal(store.isPristine({ books: [{ id: 'x9' }] }), false);
});

test('audiobook links: Drive files stream, folders open in Drive, names are optional', async () => {
  const { parseTracks, playable } = await import('../src/ui/player.js');
  const t = parseTracks('Capítulo 1 | https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing\nhttps://archive.org/download/x/cap2_64kb.mp3\njavascript:alert(1)\n');
  assert.equal(t.length, 2);
  assert.equal(t[0].title, 'Capítulo 1');
  assert.equal(t[1].title, 'Parte 2');
  assert.equal(playable(t[0].url).src, 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp');
  assert.equal(playable('https://drive.google.com/drive/folders/1FolderIdXyz123').src, null);
  assert.equal(playable('https://archive.org/download/x/cap2_64kb.mp3').src, 'https://archive.org/download/x/cap2_64kb.mp3');
  assert.equal(playable('javascript:alert(1)'), null);
});

test('PDF reading: chapters, no running headers or page numbers, hyphenation undone', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { itemsToLines, buildChapters, sentences } = await import('../src/lib/pdftext.js');
  const { readFileSync } = await import('node:fs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(new URL('./fixtures/livro-teste.pdf', import.meta.url))), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push({ lines: itemsToLines((await (await doc.getPage(i)).getTextContent()).items) });
  const ch = buildChapters(pages, []);
  assert.deepEqual(ch.map((c) => c.title), ['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  const all = JSON.stringify(ch);
  assert.equal(all.includes('Autora Exemplo'), false);
  assert.ok(ch[0].paragraphs[0].includes('O vento batia nas janelas'));
  assert.ok(ch[0].paragraphs.includes('— Quem está aí? — perguntou ela, com a voz baixa.'));
  assert.ok(sentences('a'.repeat(500)).every((s) => s.length <= 221));
});
