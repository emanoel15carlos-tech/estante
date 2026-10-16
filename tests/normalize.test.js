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

test('cloud split keeps links, Drive file and status private', async () => {
  const { splitState, joinState } = await import('../src/lib/cloud.js');
  const state = { seedVersion: 3, removedSections: [], sections: [{ id: 'fi', name: 'Ficção' }], books: [
    { id: 'a', title: 'A', status: 'lido', links: [{ id: 'l', url: 'https://x.org' }], drive: { id: 'D' }, cover: 'https://c/a.jpg' },
    { id: 'b', title: 'B', links: [] },
  ] };
  const { pub, priv } = splitState(state);
  assert.equal(JSON.stringify(pub).includes('x.org'), false);
  assert.equal(JSON.stringify(pub).includes('lido'), false);
  assert.deepEqual(Object.keys(priv.books), ['a']);
  assert.equal(pub.summary.count, 2);
  const back = joinState(pub, priv);
  assert.equal(back.books[0].status, 'lido');
  assert.equal(back.books[0].drive.id, 'D');
  assert.equal(back.summary, undefined);
  assert.equal(joinState(pub, null).books[0].status, undefined);
});
