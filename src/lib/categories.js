// API categories arrive in English and at very different levels of detail
// ("Fiction", "Juvenile Fiction / Animals", "Brazilian fiction", "Vampires").
// This maps them to the user's own sections, and translates them when the
// user wants to create a new section from a category.

import { norm } from './util.js';

const TRANSLATE = [
  ['juvenile fiction', 'Infantojuvenil'],
  ['juvenile nonfiction', 'Infantojuvenil'],
  ['young adult', 'Jovem adulto'],
  ['comics', 'Quadrinhos'],
  ['graphic novel', 'Quadrinhos'],
  ['biography', 'Biografias'],
  ['autobiography', 'Biografias'],
  ['history', 'História'],
  ['philosophy', 'Filosofia'],
  ['psychology', 'Psicologia'],
  ['self-help', 'Autoajuda'],
  ['business', 'Negócios'],
  ['economics', 'Economia'],
  ['political', 'Política'],
  ['social science', 'Ciências sociais'],
  ['science fiction', 'Ficção científica'],
  ['fantasy', 'Fantasia'],
  ['horror', 'Terror'],
  ['mystery', 'Mistério'],
  ['thriller', 'Suspense'],
  ['romance', 'Romance'],
  ['poetry', 'Poesia'],
  ['drama', 'Teatro'],
  ['religion', 'Religião'],
  ['cooking', 'Culinária'],
  ['art', 'Arte'],
  ['music', 'Música'],
  ['computers', 'Tecnologia'],
  ['technology', 'Tecnologia'],
  ['science', 'Ciência'],
  ['mathematics', 'Matemática'],
  ['education', 'Educação'],
  ['health', 'Saúde'],
  ['travel', 'Viagem'],
  ['literary criticism', 'Crítica literária'],
  ['language arts', 'Linguagem'],
  ['law', 'Direito'],
  ['medical', 'Medicina'],
  ['fiction', 'Ficção'],
];

/** Portuguese name for the first API category we recognize. */
export function translateCategory(cats) {
  for (const c of cats || []) {
    const n = norm(c);
    for (const [en, pt] of TRANSLATE) if (n.includes(en)) return pt;
  }
  const first = (cats || [])[0];
  return first ? String(first).split('/')[0].trim() : '';
}

// Keywords that point a book to one of the default sections.
const RULES = [
  { section: 'fa', words: ['fantasy', 'fantasia', 'horror', 'terror', 'science fiction', 'ficcao cientifica', 'gothic', 'vampire', 'ghost', 'supernatural', 'dystopia', 'magic'] },
  { section: 'fi', words: ['philosophy', 'filosofia', 'political', 'politica', 'science', 'ciencia', 'economics', 'history', 'historia', 'sociology', 'ethics', 'evolution', 'essays', 'ensaio', 'psychology', 'strategy'] },
  { section: 'br', words: ['brazil', 'brasil', 'literatura brasileira', 'brazilian'] },
  { section: 'cl', words: ['classic', 'classico', 'fiction', 'ficcao', 'literature', 'literatura', 'novel', 'romance', 'poetry', 'poesia', 'drama'] },
];

/**
 * Suggests a section id for a book.
 * sections: the user's sections [{id, name}]; book: normalized API result.
 */
export function suggestSection(book, sections) {
  const ids = new Set(sections.map((s) => s.id));
  const hay = norm([...(book.categories || []), book.title].join(' | '));

  // A section whose own name appears in the categories wins (user-created sections).
  for (const s of sections) {
    const n = norm(s.name);
    if (n.length > 3 && hay.includes(n)) return s.id;
  }
  // Fiction written in Portuguese or published in Brazil goes to Brazilian literature.
  const brazilianIsbn = /^97(8|9)(85|65)/.test(book.isbn || '');
  const isFiction = /fiction|ficcao|romance|novel|literatura/.test(hay);
  if (ids.has('br') && isFiction && (brazilianIsbn || book.language === 'pt') && !/translat|traduc/.test(hay)) {
    // Only when nothing points to a more specific shelf.
    const special = RULES.slice(0, 2).some((r) => r.words.some((w) => hay.includes(w)));
    if (!special) return 'br';
  }
  for (const r of RULES) {
    if (ids.has(r.section) && r.words.some((w) => hay.includes(w))) return r.section;
  }
  return sections[0] ? sections[0].id : '';
}
