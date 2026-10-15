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
  { id: 'po', name: 'Poesia & teatro' },
  { id: 'av', name: 'Aventura & mistério' },
];

// Bump when the starting collection grows: older saved collections receive the new books.
const SEED_VERSION = 2;

// [title, author, year, section, synopsis, Open Library cover id]
// Order matters: a book's id is "seed-<index>", so new books are only ever appended.
const SEED = [
  ['Dom Casmurro', 'Machado de Assis', '1899', 'br', 'Bentinho, já velho, revisita a própria vida e o ciúme que o fez duvidar de Capitu. O leitor nunca sabe ao certo em quem acreditar.', 647501],
  ['Memórias Póstumas de Brás Cubas', 'Machado de Assis', '1881', 'br', 'Um defunto autor conta a própria vida com ironia e sem pressa, do berço ao túmulo, rindo de si e da sociedade do seu tempo.', 123152],
  ['O Cortiço', 'Aluísio Azevedo', '1890', 'br', 'A vida coletiva de um cortiço no Rio de Janeiro, num retrato naturalista de ambição, trabalho e sobrevivência.', 10792439],
  ['Iracema', 'José de Alencar', '1865', 'br', 'Lenda romântica sobre a origem do Ceará, contada através do encontro entre a indígena Iracema e o português Martim.', 2664651],
  ['Os Sertões', 'Euclides da Cunha', '1902', 'br', 'O relato da Guerra de Canudos, misturando geografia, ciência e reportagem para entender o sertão e quem vivia nele.', 12746439],
  ['A Moreninha', 'Joaquim Manuel de Macedo', '1844', 'br', 'Uma aposta entre estudantes vira romance durante um fim de semana numa ilha do Rio de Janeiro.', 15203760],
  ['Dom Quixote', 'Miguel de Cervantes', '1605', 'cl', 'Um fidalgo que leu romances de cavalaria demais decide virar cavaleiro andante, ao lado do fiel Sancho Pança.', 14428305],
  ['Orgulho e Preconceito', 'Jane Austen', '1813', 'cl', 'Elizabeth Bennet e Mr. Darcy descobrem o quanto as primeiras impressões podem enganar.', 14348537],
  ['Moby Dick', 'Herman Melville', '1851', 'cl', 'A obsessão do capitão Ahab pela baleia branca que levou sua perna arrasta toda a tripulação do Pequod.', 10544254],
  ['Crime e Castigo', 'Fiódor Dostoiévski', '1866', 'cl', 'Raskólnikov comete um assassinato e passa o livro inteiro sendo consumido pela culpa e pelas próprias ideias.', 9411873],
  ['Odisseia', 'Homero', 'séc. VIII a.C.', 'cl', 'A longa volta de Ulisses para casa depois da Guerra de Troia, com monstros, deuses e dez anos de desvios.', 10570452],
  ['Frankenstein', 'Mary Shelley', '1818', 'fa', 'Victor Frankenstein dá vida a uma criatura e foge da responsabilidade por ela, com consequências terríveis.', 12356249],
  ['Drácula', 'Bram Stoker', '1897', 'fa', 'Cartas e diários acompanham a chegada do conde à Inglaterra e o grupo que decide enfrentá-lo.', 12216503],
  ['O Médico e o Monstro', 'R. L. Stevenson', '1886', 'fa', 'O respeitado Dr. Jekyll esconde uma outra metade, Mr. Hyde, cada vez mais difícil de controlar.', 295773],
  ['A Metamorfose', 'Franz Kafka', '1915', 'fa', 'Gregor Samsa acorda transformado num inseto, e a família precisa decidir o que fazer com ele.', 12820198],
  ['Alice no País das Maravilhas', 'Lewis Carroll', '1865', 'fa', 'Alice segue um coelho apressado e cai num mundo onde a lógica funciona de um jeito muito particular.', 10527843],
  ['A Arte da Guerra', 'Sun Tzu', 'séc. V a.C.', 'fi', 'Tratado de estratégia militar que defende que a maior vitória é aquela conquistada sem lutar.', 4849549],
  ['O Príncipe', 'Nicolau Maquiavel', '1532', 'fi', 'Um manual direto sobre como conquistar, manter e perder o poder, escrito sem ilusões.', 15142439],
  ['Meditações', 'Marco Aurélio', 'séc. II', 'fi', 'Anotações pessoais de um imperador romano tentando viver de acordo com a filosofia estoica.', 13264786],
  ['A Origem das Espécies', 'Charles Darwin', '1859', 'fi', 'A apresentação da teoria da evolução por seleção natural, que mudou a forma de entender a vida.', 7153600],
  // Added in SEED_VERSION 2
  ['Quincas Borba', 'Machado de Assis', '1891', 'br', 'Rubião herda a fortuna e o cachorro do filósofo Quincas Borba, muda-se para o Rio e é explorado até perder tudo, inclusive a razão.', 123420],
  ['O Alienista', 'Machado de Assis', '1882', 'br', 'O médico Simão Bacamarte abre um hospício em Itaguaí e, em nome da ciência, passa a internar quase a cidade inteira.', 647504],
  ['O Guarani', 'José de Alencar', '1857', 'br', 'No Brasil colonial, o indígena Peri dedica a vida a proteger Cecília e sua família, isolada numa fazenda às margens do rio Paquequer.', 5271115],
  ['Senhora', 'José de Alencar', '1875', 'br', 'Rica de repente, Aurélia compra o casamento com o homem que a trocou por um dote maior, e o romance acompanha esse acerto de contas.', 5050225],
  ['Triste Fim de Policarpo Quaresma', 'Lima Barreto', '1915', 'br', 'Um patriota ingênuo tenta oficializar o tupi, reformar a agricultura e defender a República, e se decepciona a cada tentativa.', 5459319],
  ['O Ateneu', 'Raul Pompeia', '1888', 'br', 'Sérgio relembra os anos num internato de elite no Rio, retratado como um pequeno mundo de vaidade, poder e crueldade.', 12039898],
  ['Os Miseráveis', 'Victor Hugo', '1862', 'cl', 'Jean Valjean, ex-condenado, tenta recomeçar a vida perseguido pelo inspetor Javert, num grande painel da França do século XIX.', 12721865],
  ['Madame Bovary', 'Gustave Flaubert', '1857', 'cl', 'Emma, casada com um médico de província, busca nos romances e nos amantes a vida intensa que imaginou, e acaba arruinada por dívidas.', 12993424],
  ['Anna Kariênina', 'Liev Tolstói', '1878', 'cl', 'O caso de Anna com o conde Vronski desafia a alta sociedade russa, em paralelo à busca de Liévin por sentido na vida no campo.', 2560652],
  ['Grandes Esperanças', 'Charles Dickens', '1861', 'cl', 'O órfão Pip recebe a fortuna de um benfeitor misterioso e descobre o preço de tentar virar um cavalheiro.', 13322313],
  ['O Morro dos Ventos Uivantes', 'Emily Brontë', '1847', 'cl', 'A paixão destrutiva entre Heathcliff e Catherine atravessa duas gerações nas charnecas de Yorkshire.', 12818862],
  ['Jane Eyre', 'Charlotte Brontë', '1847', 'cl', 'Uma órfã vira preceptora em Thornfield, se apaixona pelo patrão, o sr. Rochester, e descobre o segredo que ele esconde.', 8235363],
  ['Os Irmãos Karamázov', 'Fiódor Dostoiévski', '1880', 'cl', 'O assassinato do velho Karamázov põe à prova os três irmãos e suas ideias sobre fé, liberdade e culpa.', 8272336],
  ['O Retrato de Dorian Gray', 'Oscar Wilde', '1890', 'fa', 'Dorian continua jovem e belo enquanto o seu retrato envelhece e registra cada crime que ele comete.', 14314858],
  ['A Máquina do Tempo', 'H. G. Wells', '1895', 'fa', 'Um inventor viaja até o ano 802.701 e encontra a humanidade dividida entre os delicados Elóis e os subterrâneos Morlocks.', 9009316],
  ['Vinte Mil Léguas Submarinas', 'Júlio Verne', '1870', 'fa', 'Um professor é capturado pelo capitão Nemo e percorre os oceanos a bordo do submarino Náutilus.', 12372749],
  ['O Fantasma da Ópera', 'Gaston Leroux', '1910', 'fa', 'Um gênio desfigurado que vive sob a Ópera de Paris fica obcecado pela jovem cantora Christine.', 8245407],
  ['A Guerra dos Mundos', 'H. G. Wells', '1898', 'fa', 'Marcianos invadem a Inglaterra com máquinas de guerra, e um narrador tenta sobreviver ao colapso da civilização.', 36314],
  ['A República', 'Platão', 'séc. IV a.C.', 'fi', 'Sócrates discute o que é a justiça e imagina uma cidade ideal governada por filósofos.', 13269480],
  ['Assim Falou Zaratustra', 'Friedrich Nietzsche', '1883', 'fi', 'Em forma de poema e parábola, o profeta Zaratustra anuncia a morte de Deus e a ideia do além-do-homem.', 1017466],
  ['O Contrato Social', 'Jean-Jacques Rousseau', '1762', 'fi', 'Rousseau defende que o poder legítimo nasce de um acordo entre cidadãos livres e iguais, guiado pela vontade geral.', 5280201],
  ['Utopia', 'Thomas More', '1516', 'fi', 'Um viajante descreve a ilha de Utopia, uma sociedade sem propriedade privada que serve de crítica à Inglaterra da época.', 7222976],
  ['Ética a Nicômaco', 'Aristóteles', 'séc. IV a.C.', 'fi', 'Aristóteles investiga o que é uma vida boa e defende a virtude como hábito e como justo meio entre dois extremos.', 10540191],
  ['Discurso do Método', 'René Descartes', '1637', 'fi', 'Descartes propõe duvidar de tudo até chegar a uma certeza, resumida em “penso, logo existo”.', 8236442],
  ['Hamlet', 'William Shakespeare', '1603', 'po', 'O príncipe da Dinamarca descobre que o tio matou seu pai e oscila entre a vingança e a dúvida.', 8281954],
  ['Romeu e Julieta', 'William Shakespeare', '1597', 'po', 'Dois jovens de famílias inimigas em Verona se apaixonam, e a rivalidade entre as casas termina em tragédia.', 12370915],
  ['Os Lusíadas', 'Luís de Camões', '1572', 'po', 'Poema épico que narra a viagem de Vasco da Gama às Índias e celebra a história de Portugal.', 5943496],
  ['A Divina Comédia', 'Dante Alighieri', 'séc. XIV', 'po', 'Guiado por Virgílio e depois por Beatriz, Dante atravessa o Inferno, o Purgatório e o Paraíso.', 11621024],
  ['Fausto', 'Johann Wolfgang von Goethe', '1808', 'po', 'Um estudioso insatisfeito faz um pacto com Mefistófeles em troca de conhecimento e prazer.', 6499459],
  ['Folhas de Relva', 'Walt Whitman', '1855', 'po', 'Poemas em verso livre que celebram o corpo, a democracia e a vida comum nos Estados Unidos.', 9000447],
  ['A Volta ao Mundo em 80 Dias', 'Júlio Verne', '1872', 'av', 'Phileas Fogg aposta que dá a volta ao mundo em oitenta dias e parte com o criado Passepartout.', 6976035],
  ['A Ilha do Tesouro', 'Robert Louis Stevenson', '1883', 'av', 'O jovem Jim Hawkins encontra um mapa do tesouro e embarca num navio cheio de piratas, liderados por Long John Silver.', 9221290],
  ['Os Três Mosqueteiros', 'Alexandre Dumas', '1844', 'av', 'D’Artagnan chega a Paris e se junta a Athos, Porthos e Aramis contra as intrigas do cardeal Richelieu.', 11929973],
  ['O Conde de Monte Cristo', 'Alexandre Dumas', '1844', 'av', 'Preso injustamente, Edmond Dantès foge, encontra uma fortuna escondida e volta para se vingar de quem o traiu.', 14566393],
  ['O Cão dos Baskervilles', 'Arthur Conan Doyle', '1902', 'av', 'Sherlock Holmes investiga a lenda de um cão sobrenatural que assombra a família Baskerville.', 8063264],
  ['Um Estudo em Vermelho', 'Arthur Conan Doyle', '1887', 'av', 'A primeira aventura de Sherlock Holmes e do dr. Watson, que se conhecem e investigam um assassinato em Londres.', 13405534],
];
const SEED_V1_COUNT = 20;

const coverUrl = (id) => (id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : null);
const seedCover = (i) => coverUrl(SEED[i] && SEED[i][5]);

function seedBook(i) {
  const [title, author, year, section, synopsis] = SEED[i];
  return dress({
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
  });
}

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
    seedVersion: SEED_VERSION,
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
    books: SEED.map((_, i) => seedBook(i)),
  };
}

/** Brings a collection saved by an older version up to date. */
function migrate(data) {
  // Starting books saved before the covers were bundled get their covers.
  data.books = data.books.map((b) => {
    const m = /^seed-(\d+)$/.exec(b.id);
    if (!m || b.cover) return b;
    const cover = seedCover(+m[1]);
    return cover ? { ...b, cover, coverSource: 'openlibrary', coverTried: true } : b;
  });
  // Collections from before the larger starting collection receive the new books and sections.
  if ((data.seedVersion || 1) < SEED_VERSION) {
    const ids = new Set(data.books.map((b) => b.id));
    for (const s of DEFAULT_SECTIONS) {
      if (!data.sections.some((x) => x.id === s.id)) data.sections.push({ ...s });
    }
    for (let i = SEED_V1_COUNT; i < SEED.length; i++) {
      if (!ids.has('seed-' + i)) data.books.push(seedBook(i));
    }
    data.seedVersion = SEED_VERSION;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota or blocked */ }
  }
  return data;
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.books) && Array.isArray(data.sections)) return migrate(data);
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
