import './styles.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';
import * as store from './lib/store.js';
import { findCover } from './lib/apis.js';
import { averageColor, loadCorsImage } from './lib/covers.js';
import { debounce, esc, norm, sleep } from './lib/util.js';
import { Bookcase } from './scene/bookcase.js';
import { BookView } from './ui/bookView.js';
import { AddBook } from './ui/addBook.js';

gsap.registerPlugin(ScrollTrigger, Flip);

// Preview build without internet access (e.g. inside Claude): API search and remote covers are off.
const NO_API = import.meta.env.VITE_NO_API === '1';
if (NO_API) {
  document.querySelector('.foot > span').textContent = 'Versão de prévia: livros novos entram pelo cadastro manual.';
  document.querySelector('.foot-links a').hidden = true;
}

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ui = { cat: 'todas', q: '', openId: null };

const $tabs = document.getElementById('tabs');
const $shelves = document.getElementById('shelves');
const $lede = document.getElementById('lede');
const $search = document.getElementById('busca');
const $toast = document.getElementById('toast');

/* ---------------- toast ---------------- */
let toastT;
gsap.set($toast, { y: 0, yPercent: 160 });
function toast(text) {
  $toast.textContent = text;
  gsap.killTweensOf($toast);
  gsap.to($toast, { yPercent: 0, opacity: 1, duration: reduce ? 0 : 0.45, ease: 'expo.out' });
  clearTimeout(toastT);
  toastT = setTimeout(() => gsap.to($toast, { opacity: 0, yPercent: 160, duration: reduce ? 0 : 0.3, ease: 'power2.in' }), 3200);
}

/* ---------------- rendering ---------------- */
function visibleBooks() {
  const { books } = store.getState();
  const q = norm(ui.q);
  return books.filter((b) => !q || norm(b.title + ' ' + (b.authors || []).join(' ') + ' ' + (b.isbn || '')).includes(q));
}

function renderLede() {
  const { books, sections } = store.getState();
  const read = books.filter((b) => b.status === 'lido').length;
  const n = books.length;
  $lede.textContent = n
    ? `Uma biblioteca para guardar, encontrar e lembrar o que você lê. Hoje são ${n} ${n === 1 ? 'livro' : 'livros'} em ${sections.length} ${sections.length === 1 ? 'seção' : 'seções'}, e ${read} ${read === 1 ? 'já foi lido' : 'já foram lidos'}.`
    : 'Sua estante está vazia. Adicione o primeiro livro pela busca ou à mão.';
}

function renderTabs() {
  const { sections, books } = store.getState();
  if (ui.cat !== 'todas' && !sections.some((s) => s.id === ui.cat)) ui.cat = 'todas';
  const count = (id) => books.filter((b) => b.sectionId === id).length;
  const tabs = [{ id: 'todas', name: 'Todas as seções', n: books.length }, ...sections.map((s) => ({ ...s, n: count(s.id) }))];
  $tabs.innerHTML = tabs
    .map((t) => `<button type="button" class="tab${t.id === ui.cat ? ' is-on' : ''}" data-cat="${esc(t.id)}" aria-pressed="${t.id === ui.cat}">${esc(t.name)}<span class="n">${t.n}</span></button>`)
    .join('');
}

function spineHtml(b) {
  return `<span class="slot${b.id === ui.openId ? ' is-out' : ''}" data-flip-id="${esc(b.id)}" data-book="${esc(b.id)}">
    <button type="button" class="spine${b.status === 'lido' ? ' is-read' : ''}" aria-label="${esc(b.title)}, de ${esc((b.authors || []).join(', '))}" style="width:${b.spineW}px;height:${b.spineH}px;background:${b.color};color:${b.ink}">
      <span class="vt">${esc(b.title)}</span><span class="read-dot"></span>
    </button>
  </span>`;
}

function shelfIds() {
  // Order the book view walks through with Anterior / Próximo.
  return [...$shelves.querySelectorAll('.slot')].map((s) => s.dataset.book);
}

function renderShelves({ flip = true } = {}) {
  const state = flip && !reduce && $shelves.children.length ? Flip.getState($shelves.querySelectorAll('.slot')) : null;
  const { sections } = store.getState();
  const books = visibleBooks();
  const shown = sections.filter((s) => ui.cat === 'todas' || s.id === ui.cat);
  const html = shown.map((s) => {
    const bs = books.filter((b) => b.sectionId === s.id);
    if (!bs.length && ui.q) return '';
    return `<section class="shelf" data-section="${esc(s.id)}">
      <div class="shelf-head"><h2>${esc(s.name)}</h2><span>${bs.length} ${bs.length === 1 ? 'livro' : 'livros'}</span></div>
      <div class="shelf-back"><div class="shelf-row">
        ${bs.length ? bs.map(spineHtml).join('') : '<p class="shelf-empty">Nenhum livro nesta seção ainda.</p>'}
      </div></div>
      <div class="plank"></div>
    </section>`;
  }).join('');
  $shelves.innerHTML = html || `<div class="empty">
      <p class="serif">Nenhum livro com esse nome por aqui.</p>
      <p class="small">Confira a grafia, ou adicione o livro pela busca nas APIs.</p>
      <button type="button" class="btn btn-solid" data-add-from-empty>Adicionar livro</button>
    </div>`;
  if (state) {
    Flip.from(state, {
      targets: $shelves.querySelectorAll('.slot'),
      duration: 0.6, ease: 'expo.out', stagger: 0.006,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: -60 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out', stagger: 0.02 }),
    });
  }
  clearTimeout(renderShelves.t);
  renderShelves.t = setTimeout(() => ScrollTrigger.refresh(), 700);
}

function patchSpine(id) {
  const b = store.getState().books.find((x) => x.id === id);
  const el = $shelves.querySelector(`.slot[data-book="${CSS.escape(id)}"] .spine`);
  if (!b || !el) return;
  el.style.background = b.color;
  el.style.color = b.ink;
  el.classList.toggle('is-read', b.status === 'lido');
}

function dropShelves() {
  if (reduce) return;
  $shelves.querySelectorAll('.shelf').forEach((sh) => {
    gsap.from(sh.querySelectorAll('.slot'), {
      y: -70, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.035,
      scrollTrigger: { trigger: sh, start: 'top 85%', once: true },
    });
  });
}

/* ---------------- the new book lands on its shelf ---------------- */
function landNewBook(id) {
  const b = store.getState().books.find((x) => x.id === id);
  if (!b) return;
  if (ui.cat !== 'todas' && ui.cat !== b.sectionId) { ui.cat = b.sectionId; renderTabs(); renderShelves({ flip: false }); }
  if (ui.q) { ui.q = ''; $search.value = ''; renderShelves({ flip: false }); }
  const section = store.getState().sections.find((s) => s.id === b.sectionId);
  const slot = $shelves.querySelector(`.slot[data-book="${CSS.escape(id)}"]`);
  toast(`“${b.title}” entrou em ${section ? section.name : 'sua estante'}.`);
  if (!slot) return;
  const y = slot.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.45;
  window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
  if (!reduce) {
    gsap.fromTo(slot, { y: -window.innerHeight * 0.5, rotation: -8, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 1.1, ease: 'bounce.out', delay: 0.5 });
  }
  setTimeout(() => slot.querySelector('.spine').focus({ preventScroll: true }), reduce ? 0 : 1300);
}

/* ---------------- wiring ---------------- */
renderLede();
renderTabs();
renderShelves({ flip: false });

let bookcase = null;
try {
  bookcase = new Bookcase(document.getElementById('bookcase'), {
    reduce,
    onOpen: (id, rect) => view.open(id, rect),
  });
  bookcase.setBooks(store.getState().books);
} catch (e) {
  // WebGL unavailable: the shelves below still hold every book.
  document.querySelector('.stage3d').hidden = true;
}

const view = new BookView({
  reduce,
  getList: shelfIds,
  onOpenChange: (id) => {
    const prev = ui.openId;
    ui.openId = id;
    if (prev) $shelves.querySelector(`.slot[data-book="${CSS.escape(prev)}"]`)?.classList.remove('is-out');
    if (id) $shelves.querySelector(`.slot[data-book="${CSS.escape(id)}"]`)?.classList.add('is-out');
  },
});

const add = new AddBook({
  reduce,
  onClose: () => {
    if (add.lastAdded) {
      const id = add.lastAdded;
      add.lastAdded = null;
      landNewBook(id);
    }
  },
});

store.subscribe((state, meta) => {
  renderLede();
  if (meta.updated && !meta.moved) {
    patchSpine(meta.updated);
    renderTabs();
  } else {
    renderTabs();
    renderShelves({ flip: !meta.added && !meta.reset });
  }
  if (bookcase) bookcase.setBooks(state.books);
});

$tabs.addEventListener('click', (e) => {
  const t = e.target.closest('[data-cat]');
  if (!t || t.dataset.cat === ui.cat) return;
  ui.cat = t.dataset.cat;
  renderTabs();
  renderShelves();
});

$shelves.addEventListener('click', (e) => {
  const spine = e.target.closest('.spine');
  if (spine) {
    const id = spine.closest('.slot').dataset.book;
    const r = spine.getBoundingClientRect();
    view.open(id, { left: r.left, top: r.top, width: r.width, height: r.height }, { returnFocus: spine });
    return;
  }
  if (e.target.closest('[data-add-from-empty]')) add.open();
});

$search.addEventListener('input', debounce(() => {
  ui.q = $search.value;
  renderShelves();
}, 140));

document.getElementById('open-add').addEventListener('click', () => add.open());

const resetBtn = document.getElementById('reset');
let resetArmed = false;
resetBtn.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    resetBtn.textContent = 'Clique de novo para apagar seus livros e restaurar';
    setTimeout(() => { resetArmed = false; resetBtn.textContent = 'Restaurar acervo inicial'; }, 4000);
    return;
  }
  resetArmed = false;
  resetBtn.textContent = 'Restaurar acervo inicial';
  store.resetCollection();
  toast('Acervo inicial restaurado.');
  if (!NO_API) enrichCovers();
});

if (!reduce) {
  gsap.from('.intro h1, .lede', { opacity: 0, y: 24, duration: 0.9, ease: 'expo.out', stagger: 0.12 });
}
dropShelves();
if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());

/* ---------------- real covers for the starting collection ---------------- */
async function enrichCovers() {
  const pending = store.getState().books.filter((b) => !b.cover && !b.coverTried);
  for (const b of pending) {
    if (!navigator.onLine) return;
    let found = null;
    try { found = await findCover(b.title, (b.authors || [])[0]); } catch (e) { /* keep going */ }
    const still = store.getState().books.find((x) => x.id === b.id);
    if (!still) continue;
    const patch = { coverTried: true };
    if (found) {
      patch.cover = found.cover;
      patch.coverSource = found.source;
      const img = await loadCorsImage(found.cover, 6000);
      const c = img && averageColor(img);
      if (c) { patch.color = c.color; patch.ink = c.ink; }
    }
    store.updateBook(b.id, patch);
    await sleep(250);
  }
}
if (!NO_API) enrichCovers();
