// The collection lives in the browser (localStorage) for now.
// Swapping this module for a database (Supabase, Firebase…) keeps the rest of
// the app unchanged: it only talks to load / save / subscribe.

import { hash, norm, uid, clamp } from './util.js';

const KEY = 'estante:v1';

export const PALETTE = [
  ['#8C2F2B', '#F1E4CC'], ['#2F4A3A', '#E9E2CC'], ['#C9A15B', '#2A2018'], ['#2B3A55', '#E8E0CF'],
  ['#6B4E71', '#F0E6DA'], ['#D9CCAE', '#2A2018'], ['#3E5C6B', '#EDE6D6'], ['#A4552F', '#F6EBDD'],
  ['#242120', '#E3D6BD'], ['#6E7647', '#F2EBD9'],
];

const DEFAULT_SECTIONS = [
  { id: 'br', name: 'Literatura brasileira' },
  { id: 'cl', name: 'Clássicos do mundo' },
  { id: 'fa', name: 'Fantástico & horror' },
  { id: 'fi', name: 'Filosofia & ideias' },
];

// Open Library cover ids for the starting collection, in the same order as SEED.
const SEED_COVERS = [647501, 123152, 10792439, 2664651, 12746439, 15203760, 14428305, 14348537, 10544254, 9411873, 10570452, 12356249, 12216503, 295773, 12820198, 10527843, 4849549, 15142439, 13264786, 7153600];
const seedCover = (i) => (SEED_COVERS[i] ? `https://covers.openlibrary.org/b/id/${SEED_COVERS[i]}-L.jpg` : null);

const SEED = [
  ['Dom Casmurro', 'Machado de Assis', '1899', 'br', 'Bentinho, já velho, revisita a própria vida e o ciúme que o fez duvidar de Capitu. O leitor nunca sabe ao certo em quem acreditar.'],
  ['Memórias Póstumas de Brás Cubas', 'Machado de Assis', '1881', 'br', 'Um defunto autor conta a própria vida com ironia e sem pressa, do berço ao túmulo, rindo de si e da sociedade do seu tempo.'],
  ['O Cortiço', 'Aluísio Azevedo', '1890', 'br', 'A vida coletiva de um cortiço no Rio de Janeiro, num retrato naturalista de ambição, trabalho e sobrevivência.'],
  ['Iracema', 'José de Alencar', '1865', 'br', 'Lenda romântica sobre a origem do Ceará, contada através do encontro entre a indígena Iracema e o português Martim.'],
  ['Os Sertões', 'Euclides da Cunha', '1902', 'br', 'O relato da Guerra de Canudos, misturando geografia, ciência e reportagem para entender o sertão e quem vivia nele.'],
  ['A Moreninha', 'Joaquim Manuel de Macedo', '1844', 'br', 'Uma aposta entre estudantes vira romance durante um fim de semana numa ilha do Rio de Janeiro.'],
  ['Dom Quixote', 'Miguel de Cervantes', '1605', 'cl', 'Um fidalgo que leu romances de cavalaria demais decide virar cavaleiro andante, ao lado do fiel Sancho Pança.'],
  ['Orgulho e Preconceito', 'Jane Austen', '1813', 'cl', 'Elizabeth Bennet e Mr. Darcy descobrem o quanto as primeiras impressões podem enganar.'],
  ['Moby Dick', 'Herman Melville', '1851', 'cl', 'A obsessão do capitão Ahab pela baleia branca que levou sua perna arrasta toda a tripulação do Pequod.'],
  ['Crime e Castigo', 'Fiódor Dostoiévski', '1866', 'cl', 'Raskólnikov comete um assassinato e passa o livro inteiro sendo consumido pela culpa e pelas próprias ideias.'],
  ['Odisseia', 'Homero', 'séc. VIII a.C.', 'cl', 'A longa volta de Ulisses para casa depois da Guerra de Troia, com monstros, deuses e dez anos de desvios.'],
  ['Frankenstein', 'Mary Shelley', '1818', 'fa', 'Victor Frankenstein dá vida a uma criatura e foge da responsabilidade por ela, com consequências terríveis.'],
  ['Drácula', 'Bram Stoker', '1897', 'fa', 'Cartas e diários acompanham a chegada do conde à Inglaterra e o grupo que decide enfrentá-lo.'],
  ['O Médico e o Monstro', 'R. L. Stevenson', '1886', 'fa', 'O respeitado Dr. Jekyll esconde uma outra metade, Mr. Hyde, cada vez mais difícil de controlar.'],
  ['A Metamorfose', 'Franz Kafka', '1915', 'fa', 'Gregor Samsa acorda transformado num inseto, e a família precisa decidir o que fazer com ele.'],
  ['Alice no País das Maravilhas', 'Lewis Carroll', '1865', 'fa', 'Alice segue um coelho apressado e cai num mundo onde a lógica funciona de um jeito muito particular.'],
  ['A Arte da Guerra', 'Sun Tzu', 'séc. V a.C.', 'fi', 'Tratado de estratégia militar que defende que a maior vitória é aquela conquistada sem lutar.'],
  ['O Príncipe', 'Nicolau Maquiavel', '1532', 'fi', 'Um manual direto sobre como conquistar, manter e perder o poder, escrito sem ilusões.'],
  ['Meditações', 'Marco Aurélio', 'séc. II', 'fi', 'Anotações pessoais de um imperador romano tentando viver de acordo com a filosofia estoica.'],
  ['A Origem das Espécies', 'Charles Darwin', '1859', 'fi', 'A apresentação da teoria da evolução por seleção natural, que mudou a forma de entender a vida.'],
];

/** Fills the visual fields every book needs (spine size and colors). */
export function dress(book) {
  const h = hash(book.id + book.title);
  const [col, ink] = PALETTE[h % PALETTE.length];
  const pages = book.pageCount || 0;
  return {
    color: col,
    ink,
    spineW: pages ? clamp(Math.round(28 + pages / 14), 30, 66) : 34 + (h % 26),
    spineH: 200 + ((h >> 5) % 52),
    ...book,
  };
}

function seed() {
  return {
    version: 1,
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
    books: SEED.map(([title, author, year, section, synopsis], i) =>
      dress({
        id: 'seed-' + i,
        title,
        authors: [author],
        year,
        sectionId: section,
        synopsis,
        isbn: '',
        cover: seedCover(i),
        coverSource: seedCover(i) ? 'openlibrary' : null,
        coverTried: true,
        source: 'seed',
        status: null,
        addedAt: 0,
      })
    ),
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.books) && Array.isArray(data.sections)) {
        // Collections saved before the covers were bundled: give the starting books their covers.
        data.books = data.books.map((b) => {
          const m = /^seed-(\d+)$/.exec(b.id);
          if (!m || b.cover) return b;
          const cover = seedCover(+m[1]);
          return cover ? { ...b, cover, coverSource: 'openlibrary', coverTried: true } : b;
        });
        return data;
      }
    }
  } catch (e) { /* corrupted or blocked storage: start fresh */ }
  return seed();
}

let saveError = null;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = null;
  } catch (e) {
    saveError = e;
  }
}

export const getState = () => state;
export const lastSaveError = () => saveError;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function commit(next, meta = {}) {
  state = next;
  persist();
  listeners.forEach((fn) => fn(state, meta));
}

export function findDuplicate(candidate) {
  const isbn = candidate.isbn;
  const t = norm(candidate.title);
  const a = norm((candidate.authors || [])[0] || '');
  return state.books.find((b) => (isbn && b.isbn === isbn) || (norm(b.title) === t && norm((b.authors || [])[0] || '') === a));
}

export function addBook(data) {
  const book = dress({
    id: uid(),
    title: data.title.trim(),
    subtitle: data.subtitle || '',
    authors: data.authors && data.authors.length ? data.authors : ['Autor desconhecido'],
    year: data.year || '',
    sectionId: data.sectionId,
    synopsis: data.synopsis || '',
    isbn: data.isbn || '',
    publisher: data.publisher || '',
    pageCount: data.pageCount || 0,
    categories: data.categories || [],
    cover: data.cover || null,
    coverSource: data.cover ? data.coverSource || data.source : null,
    coverTried: true,
    source: data.source || 'manual',
    link: data.link || '',
    status: data.status || null,
    addedAt: Date.now(),
  });
  commit({ ...state, books: [...state.books, book] }, { added: book.id });
  return book;
}

export function updateBook(id, patch, meta = {}) {
  commit({ ...state, books: state.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) }, { updated: id, ...meta });
}

export function removeBook(id) {
  commit({ ...state, books: state.books.filter((b) => b.id !== id) }, { removed: id });
}

export function addSection(name) {
  const clean = name.trim();
  const existing = state.sections.find((s) => norm(s.name) === norm(clean));
  if (existing) return existing;
  const section = { id: 's-' + uid(), name: clean };
  commit({ ...state, sections: [...state.sections, section] }, { section: section.id });
  return section;
}

export function resetCollection() {
  commit(seed(), { reset: true });
}
