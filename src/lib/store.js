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

// `code` is the shelf mark printed on the brass plate and on each spine label:
// a Dewey class for subjects, a genre letter code for fiction, as public libraries do.
const DEFAULT_SECTIONS = [
  { id: 'br', name: 'Literatura brasileira', code: 'B869' },
  { id: 'cl', name: 'Clássicos do mundo', code: '800' },
  { id: 'fa', name: 'Fantástico & horror', code: 'TER' },
  { id: 'fi', name: 'Filosofia & ideias', code: '100' },
  { id: 'po', name: 'Poesia & teatro', code: '808.1' },
  { id: 'av', name: 'Aventura & mistério', code: 'MIS' },
  { id: 'fn', name: 'Fantasia', code: 'FAN' },
  { id: 'in', name: 'Infantil & juvenil', code: 'INF' },
  { id: 'sf', name: 'Ficção científica', code: 'FC' },
];
const DEFAULT_CODE = Object.fromEntries(DEFAULT_SECTIONS.map((s) => [s.id, s.code]));

// Bump when the starting collection grows: older saved collections receive the new books.
const SEED_VERSION = 3;

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
  // Added in SEED_VERSION 3
  ["O Hobbit", "J. R. R. Tolkien", "1937", "fn", "Bilbo Bolseiro é arrastado por um mago e treze anões numa jornada para recuperar o tesouro guardado pelo dragão Smaug.", 14627509],
  ["A Sociedade do Anel", "J. R. R. Tolkien", "1954", "fn", "Frodo herda um anel de poder e parte com oito companheiros para destruí-lo antes que o Senhor do Escuro o recupere.", 14627060],
  ["O Leão, a Feiticeira e o Guarda-Roupa", "C. S. Lewis", "1950", "fn", "Quatro irmãos atravessam um guarda-roupa e chegam a Nárnia, presa num inverno eterno pela Feiticeira Branca.", 8441376],
  ["Harry Potter e a Pedra Filosofal", "J. K. Rowling", "1997", "fn", "No aniversário de onze anos, Harry descobre que é bruxo e vai estudar em Hogwarts, onde o passado dos pais começa a se revelar.", 15155833],
  ["O Feiticeiro de Terramar", "Ursula K. Le Guin", "1968", "fn", "O jovem Ged, aprendiz de mago, liberta por orgulho uma sombra que passa a persegui-lo pelas ilhas de Terramar.", 13617691],
  ["O Nome do Vento", "Patrick Rothfuss", "2007", "fn", "Kvothe, hoje um discreto estalajadeiro, conta como passou de órfão de rua a lenda da Universidade de magia.", 11480483],
  ["A Guerra dos Tronos", "George R. R. Martin", "1996", "fn", "Famílias nobres disputam o Trono de Ferro dos Sete Reinos enquanto uma ameaça antiga desperta além da Muralha.", 9269962],
  ["O Último Desejo", "Andrzej Sapkowski", "1993", "fn", "Contos que apresentam Geralt de Rívia, caçador de monstros que vive entre pessoas que o temem e precisam dele.", 7360819],
  ["Deuses Americanos", "Neil Gaiman", "2001", "fn", "Ao sair da prisão, Shadow é contratado por um homem misterioso envolvido numa guerra entre deuses antigos e novos.", 8494659],
  ["As Brumas de Avalon", "Marion Zimmer Bradley", "1983", "fn", "A lenda do rei Artur contada pelas mulheres que viveram nela, sobretudo a sacerdotisa Morgana.", 96817],
  ["O Pequeno Príncipe", "Antoine de Saint-Exupéry", "1943", "in", "Um piloto perdido no deserto conhece um pequeno príncipe vindo de outro planeta, que fala de amizade e do que é essencial.", 10708272],
  ["Reinações de Narizinho", "Monteiro Lobato", "1931", "in", "As primeiras aventuras de Narizinho, Pedrinho e da boneca Emília no Sítio do Picapau Amarelo.", 8198773],
  ["Peter Pan", "J. M. Barrie", "1911", "in", "Wendy e os irmãos voam com Peter Pan para a Terra do Nunca, onde ninguém cresce e o capitão Gancho os espera.", 8237052],
  ["As Aventuras de Pinóquio", "Carlo Collodi", "1883", "in", "Um boneco de madeira ganha vida e aprende, entre mentiras e trapalhadas, o que é ser um menino de verdade.", 8597022],
  ["O Mágico de Oz", "L. Frank Baum", "1900", "in", "Um ciclone leva Dorothy até a terra de Oz, onde ela segue a estrada de tijolos amarelos para voltar para casa.", 552443],
  ["A Bolsa Amarela", "Lygia Bojunga", "1976", "in", "Raquel esconde numa bolsa amarela três grandes vontades: crescer logo, ser menino e virar escritora.", 13470796],
  ["Contos de Grimm", "Jacob e Wilhelm Grimm", "1812", "in", "Histórias populares alemãs reunidas pelos irmãos Grimm, como Branca de Neve, Rapunzel e João e Maria.", 8236293],
  ["Contos de Andersen", "Hans Christian Andersen", "1835", "in", "Contos como A Pequena Sereia, O Patinho Feio e A Roupa Nova do Imperador.", 320591],
  ["Matilda", "Roald Dahl", "1988", "in", "Uma menina genial, ignorada pelos pais, enfrenta a terrível diretora da escola com a ajuda de poderes inesperados.", 12889769],
  ["Coraline", "Neil Gaiman", "2002", "in", "Coraline encontra uma porta para uma versão perfeita da própria casa, onde uma Outra Mãe quer que ela fique para sempre.", 14171421],
  ["O Menino Maluquinho", "Ziraldo", "1980", "in", "O dia a dia de um menino alegre e cheio de ideias, que anda com uma panela na cabeça.", 15182462],
  ["1984", "George Orwell", "1949", "sf", "Winston Smith reescreve a história para um regime que vigia tudo, até se apaixonar e decidir resistir.", 9267242],
  ["Admirável Mundo Novo", "Aldous Huxley", "1932", "sf", "Numa sociedade que fabrica pessoas em laboratório e as mantém felizes com uma droga, um homem criado fora dela chega para desafiá-la.", 8231823],
  ["Fahrenheit 451", "Ray Bradbury", "1953", "sf", "Guy Montag é um bombeiro cujo trabalho é queimar livros, até o dia em que começa a ler um deles.", 12993656],
  ["Duna", "Frank Herbert", "1965", "sf", "Paul Atreides chega ao planeta desértico Arrakis, única fonte da substância mais valiosa do universo, e vira peça central de uma guerra.", 11481354],
  ["Fundação", "Isaac Asimov", "1951", "sf", "Um matemático prevê a queda do Império Galáctico e cria uma fundação para encurtar a idade das trevas que virá.", 14612610],
  ["Eu, Robô", "Isaac Asimov", "1950", "sf", "Contos sobre robôs regidos pelas Três Leis da Robótica e os dilemas inesperados que essas leis criam.", 12385229],
  ["O Guia do Mochileiro das Galáxias", "Douglas Adams", "1979", "sf", "Minutos antes de a Terra ser demolida, Arthur Dent é salvo por um amigo que, ele descobre, é alienígena.", 12986869],
  ["Neuromancer", "William Gibson", "1984", "sf", "Um hacker decadente é contratado para um último trabalho no ciberespaço, num futuro dominado por corporações.", 283860],
  ["A Mão Esquerda da Escuridão", "Ursula K. Le Guin", "1969", "sf", "Um enviado humano tenta convencer o planeta gelado de Gethen, cujos habitantes não têm sexo fixo, a se unir a uma aliança de mundos.", 10618463],
  ["Solaris", "Stanisław Lem", "1961", "sf", "Cientistas que estudam um oceano vivo num planeta distante começam a receber visitas de pessoas do próprio passado.", 12313764],
];
// How many starting books each version had, so older collections only receive what is new.
const SEED_COUNTS = { 1: 20, 2: 56 };

// Original titles of translated works, used to find them in the catalogues.
const ORIGINAL = {
  6: ["Don Quixote", "Cervantes"],
  7: ["Pride and Prejudice", "Jane Austen"],
  9: ["Crime and Punishment", "Dostoyevsky"],
  10: ["Odyssey", "Homer"],
  12: ["Dracula", "Bram Stoker"],
  13: ["Strange Case of Dr Jekyll and Mr Hyde", "Robert Louis Stevenson"],
  14: ["The Metamorphosis", "Franz Kafka"],
  15: ["Alice's Adventures in Wonderland", "Lewis Carroll"],
  16: ["The Art of War", "Sun Tzu"],
  17: ["The Prince", "Machiavelli"],
  18: ["Meditations", "Marcus Aurelius"],
  19: ["On the Origin of Species", "Charles Darwin"],
  26: ["Les Misérables", "Victor Hugo"],
  28: ["Anna Karenina", "Tolstoy"],
  29: ["Great Expectations", "Charles Dickens"],
  30: ["Wuthering Heights", "Emily Brontë"],
  32: ["The Brothers Karamazov", "Dostoyevsky"],
  33: ["The Picture of Dorian Gray", "Oscar Wilde"],
  34: ["The Time Machine", "H. G. Wells"],
  35: ["Twenty Thousand Leagues Under the Sea", "Jules Verne"],
  36: ["The Phantom of the Opera", "Gaston Leroux"],
  37: ["The War of the Worlds", "H. G. Wells"],
  38: ["The Republic", "Plato"],
  39: ["Thus Spoke Zarathustra", "Nietzsche"],
  40: ["The Social Contract", "Rousseau"],
  42: ["Nicomachean Ethics", "Aristotle"],
  43: ["Discourse on Method", "Descartes"],
  44: ["Hamlet", "Shakespeare"],
  45: ["Romeo and Juliet", "Shakespeare"],
  47: ["Divine Comedy", "Dante Alighieri"],
  48: ["Faust", "Goethe"],
  49: ["Leaves of Grass", "Walt Whitman"],
  50: ["Around the World in Eighty Days", "Jules Verne"],
  51: ["Treasure Island", "Robert Louis Stevenson"],
  52: ["The Three Musketeers", "Alexandre Dumas"],
  53: ["The Count of Monte Cristo", "Alexandre Dumas"],
  54: ["The Hound of the Baskervilles", "Arthur Conan Doyle"],
  55: ["A Study in Scarlet", "Arthur Conan Doyle"],
  56: ["The Hobbit", "Tolkien"],
  57: ["The Fellowship of the Ring", "Tolkien"],
  58: ["The Lion, the Witch and the Wardrobe", "C. S. Lewis"],
  59: ["Harry Potter and the Philosopher's Stone", "Rowling"],
  60: ["A Wizard of Earthsea", "Le Guin"],
  61: ["The Name of the Wind", "Rothfuss"],
  62: ["A Game of Thrones", "George R. R. Martin"],
  63: ["The Last Wish", "Sapkowski"],
  64: ["American Gods", "Neil Gaiman"],
  65: ["The Mists of Avalon", "Marion Zimmer Bradley"],
  66: ["Le Petit Prince", "Saint-Exupéry"],
  68: ["Peter Pan", "Barrie"],
  69: ["Le avventure di Pinocchio", "Collodi"],
  70: ["The Wonderful Wizard of Oz", "Baum"],
  72: ["Grimm's Fairy Tales", "Grimm"],
  73: ["Andersen's Fairy Tales", "Andersen"],
  74: ["Matilda", "Roald Dahl"],
  75: ["Coraline", "Neil Gaiman"],
  77: ["Nineteen Eighty-Four", "George Orwell"],
  78: ["Brave New World", "Aldous Huxley"],
  79: ["Fahrenheit 451", "Ray Bradbury"],
  80: ["Dune", "Frank Herbert"],
  81: ["Foundation", "Isaac Asimov"],
  82: ["I, Robot", "Isaac Asimov"],
  83: ["The Hitchhiker's Guide to the Galaxy", "Douglas Adams"],
  84: ["Neuromancer", "William Gibson"],
  85: ["The Left Hand of Darkness", "Le Guin"],
  86: ["Solaris", "Stanisław Lem"],
};



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
    ...(ORIGINAL[i] ? { searchTitle: ORIGINAL[i][0], searchAuthor: ORIGINAL[i][1] } : {}),
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
    removedSections: [],
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
    books: SEED.map((_, i) => seedBook(i)),
  };
}

/** Brings a collection saved by an older version up to date. */
function migrate(data) {
  data.removedSections = data.removedSections || [];
  data.sections = data.sections.map((s) => (s.code === undefined ? { ...s, code: DEFAULT_CODE[s.id] || '' } : s));
  // Starting books saved before the covers were bundled get their covers.
  data.books = data.books.map((b) => {
    const m = /^seed-(\d+)$/.exec(b.id);
    if (!m) return b;
    const i = +m[1];
    let out = b;
    if (!out.cover && seedCover(i)) out = { ...out, cover: seedCover(i), coverSource: 'openlibrary', coverTried: true };
    if (!out.searchTitle && ORIGINAL[i]) out = { ...out, searchTitle: ORIGINAL[i][0], searchAuthor: ORIGINAL[i][1] };
    return out;
  });
  // Collections from before the larger starting collection receive the new books and sections.
  if ((data.seedVersion || 1) < SEED_VERSION) {
    const ids = new Set(data.books.map((b) => b.id));
    for (const s of DEFAULT_SECTIONS) {
      if (!data.sections.some((x) => x.id === s.id) && !data.removedSections.includes(s.id)) data.sections.push({ ...s });
    }
    for (let i = SEED_COUNTS[data.seedVersion || 1] || 20; i < SEED.length; i++) {
      if (!ids.has('seed-' + i) && data.sections.some((x) => x.id === SEED[i][3])) data.books.push(seedBook(i));
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

// While visiting a friend's shelf the state is theirs, read-only and never saved.
let visit = null; // { owner, own }

export const isReadOnly = () => !!visit;
export const visiting = () => (visit ? visit.owner : null);

function commit(next, meta = {}) {
  if (visit) return; // nothing changes a borrowed shelf
  state = next;
  persist();
  listeners.forEach((fn) => fn(state, meta));
}

/** Replaces the whole collection (account data from the cloud, or a fresh start). */
export function replaceAll(data, meta = {}) {
  const ok = data && Array.isArray(data.books) && Array.isArray(data.sections);
  commit(ok ? migrate({ removedSections: [], ...data }) : seed(), { reset: true, ...meta });
}

export function startVisit(owner, data) {
  const own = visit ? visit.own : state;
  visit = { owner, own };
  state = { removedSections: [], ...data, books: data.books || [], sections: data.sections || [] };
  listeners.forEach((fn) => fn(state, { reset: true, visit: true }));
}

export function endVisit() {
  if (!visit) return;
  state = visit.own;
  visit = null;
  listeners.forEach((fn) => fn(state, { reset: true, visit: true }));
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
    links: data.links || [],
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

export function addSection(name, code = '') {
  const clean = name.trim();
  const existing = state.sections.find((s) => norm(s.name) === norm(clean));
  if (existing) return existing;
  const section = { id: 's-' + uid(), name: clean, code: code.trim().toUpperCase().slice(0, 8) };
  commit({ ...state, sections: [...state.sections, section] }, { section: section.id });
  return section;
}

export function updateSection(id, patch) {
  const clean = { ...patch };
  if (clean.name !== undefined) clean.name = clean.name.trim();
  if (clean.code !== undefined) clean.code = clean.code.trim().toUpperCase().slice(0, 8);
  commit({ ...state, sections: state.sections.map((s) => (s.id === id ? { ...s, ...clean } : s)) }, { section: id });
}

export function moveSection(id, dir) {
  const list = [...state.sections];
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  commit({ ...state, sections: list }, { section: id, reordered: true });
}

/** Removes a section; its books move to `targetId` (required when it has books). */
export function removeSection(id, targetId) {
  const hasBooks = state.books.some((b) => b.sectionId === id);
  if (hasBooks && !state.sections.some((s) => s.id === targetId && s.id !== id)) return false;
  commit({
    ...state,
    removedSections: [...new Set([...(state.removedSections || []), id])],
    sections: state.sections.filter((s) => s.id !== id),
    books: state.books.map((b) => (b.sectionId === id ? { ...b, sectionId: targetId } : b)),
  }, { section: id, removedSection: true });
  return true;
}

/** Shelf mark for a book: the section code plus the first letters of the author's surname. */
export function callNumber(book, section) {
  const surname = String((book.authors || [])[0] || '').split(' ').filter(Boolean).pop() || book.title || '';
  const cutter = surname.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return { code: (section && section.code) || '', cutter };
}

export function resetCollection() {
  commit(seed(), { reset: true });
}
