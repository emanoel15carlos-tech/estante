// The open book: pulled off the shelf (or the 3D bookcase), turned to its
// cover, opened on demand, and flown back to its slot when closed.
import { gsap } from 'gsap';
import * as store from '../lib/store.js';
import { SOURCE_LABEL } from '../lib/apis.js';
import { esc } from '../lib/util.js';

const STATUS = [
  ['quero', 'Quero ler'],
  ['lendo', 'Lendo'],
  ['lido', 'Lido'],
];
const STATUS_TEXT = { quero: 'Na fila de leitura', lendo: 'Leitura em andamento', lido: 'Lido' };

const EMBLEM = '<svg width="92" height="92" viewBox="0 0 92 92" fill="none" aria-hidden="true"><circle cx="46" cy="46" r="44" stroke="currentColor"/><circle cx="46" cy="46" r="30" stroke="currentColor"/><path d="M46 2v88M2 46h88" stroke="currentColor"/></svg>';

export class BookView {
  constructor({ reduce, getList, onOpenChange }) {
    this.reduce = reduce;
    this.getList = getList; // ids in the order the shelves show them
    this.onOpenChange = onOpenChange;
    this.root = document.getElementById('book-view');
    this.book3d = document.getElementById('book3d');
    this.anchor = this.root.querySelector('.anchor');
    this.info = document.getElementById('bv-info');
    this.scrim = this.root.querySelector('.scrim');
    this.cardBg = this.root.querySelector('.card-bg');
    this.id = null;
    this.coverOpen = false;
    this.busy = false;
    this.confirmRemove = false;

    this.scrim.addEventListener('click', () => this.close());
    this.closeBtn = this.root.querySelector('.card-close');
    this.closeBtn.addEventListener('click', () => this.close());
    this.info.addEventListener('click', (e) => this.onClick(e));
    this.info.addEventListener('change', (e) => this.onChange(e));
    document.addEventListener('keydown', (e) => {
      if (this.id && e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
  }

  get book() { return store.getState().books.find((b) => b.id === this.id); }
  q(sel) { return this.root.querySelector(sel); }

  /* ---------------- rendering ---------------- */

  coverHtml(b) {
    const drawn = `<div class="cv-drawn" style="background:${b.color};color:${b.ink}">
        <div class="ca">${esc((b.authors || [])[0] || '')}</div>${EMBLEM}
        <div><div class="ct">${esc(b.title)}</div><div class="cy">${esc(b.year || '')}</div></div>
      </div>`;
    if (!b.cover) return drawn;
    return `<img src="${esc(b.cover)}" alt="" referrerpolicy="no-referrer" data-drawn="${esc(drawn)}">`;
  }

  renderBook(b) {
    this.book3d.innerHTML = `
      <div class="face f-back" style="background:${b.color}"></div>
      <div class="face f-pages"></div>
      <div class="face f-top"></div>
      <div class="face f-spine" style="background:${b.color};color:${b.ink}"><span class="vt">${esc(b.title)}</span></div>
      <div class="face f-page1">
        <div class="exl">Ex libris</div>
        <div><div class="t">${esc(b.title)}</div><div class="a">${esc((b.authors || []).join(', '))}${b.year ? ', ' + esc(b.year) : ''}</div></div>
        <div class="s" data-status-text>${esc(b.status ? STATUS_TEXT[b.status] : 'Na estante')}</div>
      </div>
      <div class="cover">
        <div class="cv-front">${this.coverHtml(b)}</div>
        <div class="cv-in"></div>
      </div>`;
    const img = this.book3d.querySelector('.cv-front img');
    if (img) img.addEventListener('error', () => { img.outerHTML = img.dataset.drawn; }, { once: true });
  }

  renderInfo(b) {
    const sections = store.getState().sections;
    const section = sections.find((s) => s.id === b.sectionId);
    const src = b.source && SOURCE_LABEL[b.source];
    const coverSrc = b.coverSource && b.coverSource !== b.source ? SOURCE_LABEL[b.coverSource] : '';
    let prov = '';
    if (b.source && b.source !== 'seed' && b.source !== 'manual') {
      prov = `Dados: ${esc(src)}${coverSrc ? ` · capa: ${esc(coverSrc)}` : ''}${b.link ? ` · <a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">ver na fonte</a>` : ''}`;
    } else if (b.coverSource && SOURCE_LABEL[b.coverSource] && b.coverSource !== 'manual') {
      prov = `Capa: ${esc(SOURCE_LABEL[b.coverSource])}`;
    }
    this.info.innerHTML = `
      <div>
        <h2 id="bv-title">${esc(b.title)}</h2>
        <p class="byline">${esc((b.authors || []).join(', '))} <span>${b.year ? '· ' + esc(b.year) + ' ' : ''}· ${esc(section ? section.name : 'Sem seção')}</span></p>
      </div>
      ${b.synopsis ? `<p class="synopsis">${esc(b.synopsis)}</p>` : '<p class="synopsis none">Sem sinopse cadastrada.</p>'}
      <div class="pills" role="group" aria-label="Status de leitura">
        ${STATUS.map(([id, label]) => `<button type="button" class="pill${b.status === id ? ' is-on' : ''}" data-status="${id}" aria-pressed="${b.status === id}">${label}</button>`).join('')}
      </div>
      <div class="meta-row">
        <label class="field"><span class="field-label">Seção</span>
          <select data-act="section">${sections.map((s) => `<option value="${esc(s.id)}"${s.id === b.sectionId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </label>
        <button type="button" class="btn btn-danger" data-act="remove">${this.confirmRemove ? 'Confirmar remoção' : 'Remover'}</button>
      </div>
      <div class="row">
        <button type="button" class="btn btn-solid" data-act="cover">${this.coverOpen ? 'Fechar livro' : 'Abrir livro'}</button>
        <button type="button" class="btn" data-act="prev" aria-label="Livro anterior"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6"/></svg>Anterior</button>
        <button type="button" class="btn" data-act="next" aria-label="Próximo livro">Próximo<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6"/></svg></button>
      </div>
      ${prov ? `<p class="provenance">${prov}</p>` : ''}`;
  }

  /* ---------------- events ---------------- */

  onClick(e) {
    const el = e.target.closest('[data-act],[data-status]');
    if (!el || !this.id) return;
    if (el.dataset.status) {
      const b = this.book;
      const next = b.status === el.dataset.status ? null : el.dataset.status;
      store.updateBook(this.id, { status: next });
      this.info.querySelectorAll('[data-status]').forEach((p) => {
        const on = p.dataset.status === next;
        p.classList.toggle('is-on', on);
        p.setAttribute('aria-pressed', String(on));
      });
      const st = this.book3d.querySelector('[data-status-text]');
      if (st) st.textContent = next ? STATUS_TEXT[next] : 'Na estante';
      return;
    }
    const act = el.dataset.act;
    if (act === 'close') this.close();
    else if (act === 'cover') this.toggleCover(el);
    else if (act === 'prev' || act === 'next') this.step(act === 'next' ? 1 : -1);
    else if (act === 'remove') this.remove(el);
  }

  onChange(e) {
    if (e.target.dataset.act === 'section' && this.id) {
      store.updateBook(this.id, { sectionId: e.target.value }, { moved: true });
      const b = this.book;
      const s = store.getState().sections.find((x) => x.id === b.sectionId);
      const span = this.info.querySelector('.byline span');
      if (span) span.textContent = `${b.year ? '· ' + b.year + ' ' : ''}· ${s ? s.name : ''}`;
    }
  }

  /* ---------------- motion ---------------- */

  open(id, origin, { returnFocus } = {}) {
    const b = store.getState().books.find((x) => x.id === id);
    if (!b || this.busy) return;
    const swapping = !!this.id;
    this.id = id;
    this.coverOpen = false;
    this.confirmRemove = false;
    this.returnFocus = returnFocus || this.returnFocus || null;
    this.renderBook(b);
    this.renderInfo(b);
    if (!swapping) {
      this.root.hidden = false;
      document.body.classList.add('locked');
    }
    this.onOpenChange(id);
    this.animateIn(origin, swapping);
  }

  animateIn(origin, swapping) {
    const book = this.book3d, cover = this.q('.cover');
    const info = this.info.children;
    const r = this.reduce;
    if (this.floatT) this.floatT.kill();
    gsap.killTweensOf(book);
    gsap.set(cover, { rotationY: 0, z: 20, transformOrigin: '0% 50%' });
    const tl = gsap.timeline();
    if (!swapping) {
      tl.fromTo(this.scrim, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0)
        .fromTo(this.cardBg, { opacity: 0, scale: r ? 1 : 0.97 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' }, 0.08)
        .fromTo(this.closeBtn, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.3);
    }
    let from = { x: 0, y: 0, scale: 0.9, rotationY: 90, rotationX: 0, opacity: 0 };
    if (origin && !r) {
      gsap.set(book, { clearProps: 'transform' });
      const a = this.anchor.getBoundingClientRect();
      from = {
        x: origin.left + origin.width / 2 - (a.left + a.width / 2),
        y: origin.top + origin.height / 2 - (a.top + a.height / 2),
        scale: Math.max(0.15, origin.height / 350), rotationY: 90, rotationX: 0, opacity: 1,
      };
    }
    if (r) from = { x: 0, y: 0, scale: 1, rotationY: -24, rotationX: 5, opacity: 0 };
    tl.fromTo(book, from, { x: 0, y: 0, scale: 1, opacity: 1, rotationY: -28, rotationX: 6, duration: r ? 0.3 : 1.15, ease: 'expo.out' }, 0);
    tl.fromTo(info, { opacity: 0, y: r ? 0 : 14 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.05 }, r ? 0 : 0.35);
    if (!r) this.startFloat(1.2);
    const btn = this.info.querySelector('[data-act="cover"]');
    if (btn) btn.focus({ preventScroll: true });
  }

  startFloat(delay = 0) {
    if (this.reduce) return;
    this.floatT = gsap.to(this.book3d, { y: -10, rotationY: -18, rotationX: 3, duration: 3.2, ease: 'sine.inOut', yoyo: true, repeat: -1, delay });
  }

  toggleCover(btn) {
    const book = this.book3d, cover = this.q('.cover');
    const d = this.reduce ? 0.01 : 1;
    this.coverOpen = !this.coverOpen;
    btn.textContent = this.coverOpen ? 'Fechar livro' : 'Abrir livro';
    if (this.floatT) this.floatT.kill();
    gsap.killTweensOf([book, cover]);
    const shift = window.innerWidth < 860 ? 60 : 110;
    const tl = gsap.timeline();
    if (this.coverOpen) {
      tl.to(book, { x: shift, y: 0, rotationY: -6, rotationX: 3, duration: 0.9 * d, ease: 'power3.inOut' }, 0)
        .to(cover, { rotationY: -162, duration: 1.1 * d, ease: 'power3.inOut' }, 0.1 * d);
    } else {
      tl.to(cover, { rotationY: 0, duration: 0.8 * d, ease: 'power3.inOut' }, 0)
        .to(book, { x: 0, rotationY: -28, rotationX: 6, duration: 0.8 * d, ease: 'power3.inOut' }, 0.15 * d)
        .add(() => this.startFloat());
    }
  }

  step(dir) {
    const ids = this.getList();
    if (!ids.length) return;
    let i = ids.indexOf(this.id);
    if (i === -1) i = 0;
    const next = ids[(i + dir + ids.length) % ids.length];
    if (next === this.id) return;
    if (this.reduce) return this.open(next, null);
    if (this.floatT) this.floatT.kill();
    this.busy = true;
    gsap.to(this.info.children, { opacity: 0, duration: 0.18 });
    gsap.to(this.book3d, {
      rotationY: 90, opacity: 0, scale: 0.92, duration: 0.3, ease: 'power2.in',
      onComplete: () => { this.busy = false; this.open(next, null); },
    });
  }

  remove(btn) {
    if (!this.confirmRemove) {
      this.confirmRemove = true;
      btn.textContent = 'Confirmar remoção';
      clearTimeout(this.rmT);
      this.rmT = setTimeout(() => { this.confirmRemove = false; if (btn.isConnected) btn.textContent = 'Remover'; }, 4000);
      return;
    }
    const id = this.id;
    const done = () => { this.hide(); store.removeBook(id); };
    if (this.reduce) return done();
    if (this.floatT) this.floatT.kill();
    gsap.timeline({ onComplete: done })
      .to(this.info.children, { opacity: 0, duration: 0.2 }, 0)
      .to(this.book3d, { y: 160, rotationZ: 18, rotationX: 40, opacity: 0, duration: 0.6, ease: 'power3.in' }, 0)
      .to([this.cardBg, this.scrim, this.closeBtn], { opacity: 0, duration: 0.35 }, 0.3);
  }

  close() {
    if (!this.id || this.busy) return;
    this.busy = true;
    const r = this.reduce;
    if (this.floatT) this.floatT.kill();
    const slot = document.querySelector(`.slot[data-book="${CSS.escape(this.id)}"] .spine`);
    const rect = slot ? slot.getBoundingClientRect() : null;
    const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    const tl = gsap.timeline({ onComplete: () => this.hide() });
    tl.to(this.info.children, { opacity: 0, duration: 0.18 }, 0);
    let t0 = 0;
    if (this.coverOpen) { tl.to(this.q('.cover'), { rotationY: 0, duration: r ? 0.01 : 0.45, ease: 'power3.in' }, 0); t0 = 0.3; }
    if (visible && !r) {
      const a = this.anchor.getBoundingClientRect();
      tl.to(this.book3d, {
        x: rect.left + rect.width / 2 - (a.left + a.width / 2),
        y: rect.top + rect.height / 2 - (a.top + a.height / 2),
        scale: rect.height / 350, rotationY: 90, rotationX: 0, duration: 0.75, ease: 'power3.inOut',
      }, t0);
      tl.to([this.cardBg, this.closeBtn], { opacity: 0, duration: 0.3 }, t0 + 0.1).to(this.scrim, { opacity: 0, duration: 0.35 }, t0 + 0.4);
    } else {
      tl.to(this.book3d, { opacity: 0, scale: 0.94, duration: 0.25, ease: 'power2.in' }, t0)
        .to([this.cardBg, this.scrim, this.closeBtn], { opacity: 0, duration: 0.25 }, t0);
    }
  }

  hide() {
    const id = this.id;
    this.busy = false;
    this.id = null;
    this.root.hidden = true;
    document.body.classList.remove('locked');
    this.book3d.innerHTML = '';
    this.onOpenChange(null);
    const back = this.returnFocus || document.querySelector(`.slot[data-book="${CSS.escape(id || '')}"] .spine`);
    this.returnFocus = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }
}
