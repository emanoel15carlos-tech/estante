// The open book: pulled off the shelf (or the 3D bookcase), turned to its
// cover, opened on demand, and flown back to its slot when closed.
import { gsap } from 'gsap';
import * as store from '../lib/store.js';
import { SOURCE_LABEL, bookInsights, portugueseEditions, readerLists, similarBooks } from '../lib/apis.js';
import { esc, hostOf, normalizeUrl, parseDrive, uid } from '../lib/util.js';

const STATUS = [
  ['quero', 'Quero ler'],
  ['lendo', 'Lendo'],
  ['lido', 'Lido'],
];
const STAMP = { quero: 'Quero ler', lendo: 'Lendo', lido: 'Lido' };
const STATUS_TEXT = { quero: 'Na fila de leitura', lendo: 'Leitura em andamento', lido: 'Lido' };

const TABS = [
  ['sobre', 'Sobre'],
  ['ler', 'Ler e baixar'],
  ['leitores', 'Leitores'],
  ['temas', 'Temas'],
  ['parecidos', 'Parecidos'],
];
const nf = new Intl.NumberFormat('pt-BR');
const ICON_OUT = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2h7v7M12 2L5.5 8.5M10 9.5V12H2V4h2.5" stroke="currentColor" stroke-width="1.4"/></svg>';
const DRIVE_ICON = '<svg width="22" height="20" viewBox="0 0 22 20" fill="none" aria-hidden="true"><path d="M7.5 1h7l7 12-3.5 6h-14L.5 13l7-12z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 1l7 12M14.5 1l-7 12M.5 13h21" stroke="currentColor" stroke-width="1.4"/></svg>';
const ext = (url, label) => `<a class="ext" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}${ICON_OUT}</a>`;

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
    const reader = document.getElementById('reader');
    reader.querySelectorAll('[data-close-reader]').forEach((x) => x.addEventListener('click', () => this.closeReader()));
    this.info.addEventListener('click', (e) => this.onClick(e));
    this.info.addEventListener('change', (e) => this.onChange(e));
    this.info.addEventListener('submit', (e) => {
      const drive = e.target.closest('[data-drive-form]');
      if (drive) { e.preventDefault(); this.onDriveSubmit(drive); return; }
      const form = e.target.closest('[data-link-form]');
      if (!form) return;
      e.preventDefault();
      this.onLinkSubmit(form);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.closeReader()) { e.preventDefault(); return; }
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
    const tab = this.tab || 'sobre';
    const ro = store.isReadOnly();
    const cn = store.callNumber(b, section);
    this.info.classList.toggle('is-ro', ro);
    this.info.innerHTML = `
      <span class="stamp${b.status ? ' is-' + b.status : ''}" data-stamp aria-hidden="true">${b.status ? STAMP[b.status] : ''}</span>
      <div>
        <p class="card-callno"><span>${esc([cn.code, cn.cutter].filter(Boolean).join(' '))}</span><span>Ficha catalográfica</span></p>
        <h2 id="bv-title">${esc(b.title)}</h2>
        <p class="byline">${esc((b.authors || []).join(', '))} <span>${b.year ? '· ' + esc(b.year) + ' ' : ''}· ${esc(section ? section.name : 'Sem seção')}</span></p>
      </div>
      <div class="bv-tabs" role="tablist" aria-label="Sobre o livro">
        ${TABS.map(([id, label]) => `<button type="button" role="tab" id="bvt-${id}" aria-controls="bvp-${id}" aria-selected="${id === tab}" class="bv-tab${id === tab ? ' is-on' : ''}" data-tab="${id}">${label}</button>`).join('')}
      </div>
      <div class="bv-panel" role="tabpanel" id="bvp-sobre" aria-labelledby="bvt-sobre"${tab === 'sobre' ? '' : ' hidden'}>
        ${b.synopsis ? `<p class="synopsis">${esc(b.synopsis)}</p>` : '<p class="synopsis none">Sem sinopse cadastrada.</p>'}
        ${ro ? `<p class="bv-note">Estante de ${esc(store.visiting().display_name)}: você está só olhando.</p>` : ''}
        <div class="pills" role="group" aria-label="Status de leitura">
          ${STATUS.map(([id, label]) => `<button type="button" class="pill${b.status === id ? ' is-on' : ''}" data-status="${id}" aria-pressed="${b.status === id}">${label}</button>`).join('')}
        </div>
        <div class="meta-row">
          <label class="field"><span class="field-label">Seção</span>
            <select data-act="section">${sections.map((s) => `<option value="${esc(s.id)}"${s.id === b.sectionId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          </label>
          <button type="button" class="btn btn-danger" data-act="remove">${this.confirmRemove ? 'Confirmar remoção' : 'Remover'}</button>
        </div>
        ${prov ? `<p class="provenance">${prov}</p>` : ''}
      </div>
      ${TABS.slice(1).map(([id]) => `<div class="bv-panel" role="tabpanel" id="bvp-${id}" aria-labelledby="bvt-${id}"${tab === id ? '' : ' hidden'}>${id === 'ler' ? this.driveHtml(b) + this.myLinksHtml(b) + '<div class="ler-auto"><p class="bv-loading">Buscando informações na Open Library…</p></div>' : '<p class="bv-loading">Buscando informações na Open Library…</p>'}</div>`).join('')}
      <div class="row bv-actions">
        <button type="button" class="btn btn-solid" data-act="cover">${this.coverOpen ? 'Fechar livro' : 'Abrir livro'}</button>
        ${b.drive ? '<button type="button" class="btn btn-drive" data-act="read-file">' + DRIVE_ICON + 'Ler o arquivo</button>' : ''}
        <button type="button" class="btn" data-act="prev" aria-label="Livro anterior"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6"/></svg>Anterior</button>
        <button type="button" class="btn" data-act="next" aria-label="Próximo livro">Próximo<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6"/></svg></button>
      </div>`;
    this.loadInsights(b);
  }

  panel(id) { return this.info.querySelector('#bvp-' + id); }

  switchTab(id) {
    this.tab = id;
    this.info.querySelectorAll('[data-tab]').forEach((t) => {
      const on = t.dataset.tab === id;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
    });
    this.info.querySelectorAll('.bv-panel').forEach((p) => { p.hidden = p.id !== 'bvp-' + id; });
    const p = this.panel(id);
    if (p && !this.reduce) gsap.fromTo(p, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out' });
    if (id === 'parecidos') this.loadSimilar();
  }

  async loadInsights(b) {
    const id = b.id;
    this.insights = null;
    let ins = null, failed = false;
    try { ins = await bookInsights(b); } catch (e) { failed = true; }
    if (this.id !== id) return; // the reader moved on to another book
    this.insights = ins;
    const msg = failed
      ? '<p class="bv-loading">Não foi possível falar com a Open Library agora. Tente de novo daqui a pouco.</p>'
      : '<p class="bv-loading">A Open Library não tem esta obra cadastrada.</p>';
    if (!ins) {
      TABS.slice(1).forEach(([t]) => { const p = t === 'ler' ? this.info.querySelector('.ler-auto') : this.panel(t); if (p) p.innerHTML = msg; });
      return;
    }
    this.info.querySelector('.ler-auto').innerHTML = this.readHtml(ins);
    this.panel('leitores').innerHTML = this.readersHtml(ins);
    this.panel('temas').innerHTML = this.topicsHtml(ins);
    this.panel('parecidos').innerHTML = '<p class="bv-loading">Buscando livros com o mesmo tema…</p>';
    if (this.tab === 'parecidos') this.loadSimilar();
    this.loadLists(ins.key, id);
    this.loadPortuguese(b, ins, id);
  }

  driveHtml(b) {
    if (store.isReadOnly()) return '';
    const d = b.drive;
    if (d) {
      return `<section class="drive-box has-file" aria-labelledby="dr-h">
        <h3 class="bv-h" id="dr-h">Meu arquivo no Drive</h3>
        <div class="drive-card">
          <span class="drive-icon">${DRIVE_ICON}</span>
          <div class="drive-meta"><strong>${esc(d.name || d.label)}</strong><span>${esc(d.label)}${d.name ? '' : ' · anexado por você'}</span></div>
        </div>
        <div class="row">
          <button type="button" class="btn btn-solid" data-act="read-file">Ler aqui</button>
          <a class="btn" href="${esc(d.open)}" target="_blank" rel="noopener noreferrer">Abrir no Drive${ICON_OUT}</a>
          <button type="button" class="link-btn" data-act="drive-remove">Desanexar</button>
        </div>
        <p class="bv-note">Para abrir aqui no site, o arquivo precisa estar compartilhado no Drive como “Qualquer pessoa com o link”. Se for privado, use “Abrir no Drive”.</p>
      </section>`;
    }
    return `<section class="drive-box" aria-labelledby="dr-h">
      <h3 class="bv-h" id="dr-h">Meu arquivo no Drive</h3>
      <form class="link-form" data-drive-form novalidate>
        <label class="field"><span class="field-label">Link do Google Drive</span><input name="url" inputmode="url" placeholder="https://drive.google.com/file/d/…" autocomplete="off"></label>
        <label class="field"><span class="field-label">Nome do arquivo <span class="opt">(opcional)</span></span><input name="name" maxlength="80" placeholder="Ex.: Dom Casmurro, edição 1899 (PDF)" autocomplete="off"></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn">Anexar arquivo</button>
      </form>
    </section>`;
  }

  onDriveSubmit(form) {
    const err = form.querySelector('.form-error');
    const raw = form.elements.url.value.trim();
    const d = parseDrive(raw);
    if (!d) {
      err.textContent = raw ? 'Esse não parece um link do Google Drive. No Drive, clique em Compartilhar › Copiar link e cole aqui.' : 'Cole o link do arquivo no Drive.';
      form.elements.url.focus();
      return;
    }
    const name = form.elements.name.value.trim();
    store.updateBook(this.id, { drive: { ...d, name } }, { drive: true });
    this.refreshDrive();
  }

  refreshDrive() {
    const b = this.book;
    const box = this.info.querySelector('.drive-box');
    if (box) {
      const tmp = document.createElement('div');
      tmp.innerHTML = this.driveHtml(b);
      box.replaceWith(tmp.firstElementChild);
    }
    const actions = this.info.querySelector('.bv-actions');
    const btn = actions && actions.querySelector('[data-act="read-file"]');
    if (b.drive && !btn && actions) actions.querySelector('[data-act="cover"]').insertAdjacentHTML('afterend', '<button type="button" class="btn btn-drive" data-act="read-file">' + DRIVE_ICON + 'Ler o arquivo</button>');
    if (!b.drive && btn) btn.remove();
  }

  openReader() {
    const b = this.book;
    if (!b || !b.drive) return;
    const r = document.getElementById('reader');
    r.querySelector('.reader-title').textContent = b.drive.name || b.title;
    r.querySelector('.reader-open').href = b.drive.open;
    const frame = r.querySelector('iframe');
    frame.src = b.drive.preview;
    frame.title = `Arquivo de ${b.title}`;
    r.hidden = false;
    if (!this.reduce) gsap.fromTo(r.querySelector('.reader-sheet'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'expo.out' });
    r.querySelector('.reader-close').focus();
  }

  closeReader() {
    const r = document.getElementById('reader');
    if (r.hidden) return false;
    r.hidden = true;
    r.querySelector('iframe').src = 'about:blank';
    const btn = this.info.querySelector('[data-act="read-file"]');
    if (btn) btn.focus();
    return true;
  }

  myLinksHtml(b) {
    if (store.isReadOnly()) return '';
    const links = b.links || [];
    return `<section class="my-links" aria-labelledby="ml-h">
      <h3 class="bv-h" id="ml-h">Meus links</h3>
      ${links.length ? `<ul class="sources">${links.map((l) => `<li class="src src-mine">
          <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(l.label || hostOf(l.url))}</strong>${ICON_OUT}</a>
          <span class="src-row"><span>${esc(hostOf(l.url))}</span><button type="button" class="link-btn" data-remove-link="${esc(l.id)}" aria-label="Remover o link ${esc(l.label || hostOf(l.url))}">Remover</button></span>
        </li>`).join('')}</ul>` : '<p class="bv-text">Guarde aqui onde você encontra este livro: uma loja, um arquivo, uma biblioteca.</p>'}
      <form class="link-form" data-link-form novalidate>
        <div class="link-fields">
          <label class="field"><span class="field-label">Nome</span><input name="label" placeholder="Ex.: Minha cópia em PDF" maxlength="60" autocomplete="off"></label>
          <label class="field"><span class="field-label">Endereço</span><input name="url" inputmode="url" placeholder="https://…" autocomplete="off" required></label>
        </div>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn">Adicionar link</button>
      </form>
    </section>`;
  }

  renderMyLinks() {
    const b = this.book;
    const box = this.info.querySelector('.my-links');
    if (!b || !box) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.myLinksHtml(b);
    box.replaceWith(tmp.firstElementChild);
  }

  onLinkSubmit(form) {
    const err = form.querySelector('.form-error');
    const url = normalizeUrl(form.elements.url.value);
    if (!url) { err.textContent = 'Esse endereço não parece válido. Cole o link completo, como https://site.com/livro.'; form.elements.url.focus(); return; }
    const b = this.book;
    const asDrive = parseDrive(url);
    if (asDrive && !b.drive) {
      store.updateBook(b.id, { drive: { ...asDrive, name: form.elements.label.value.trim() } }, { drive: true });
      this.refreshDrive();
      form.reset();
      return;
    }
    if ((b.links || []).some((l) => l.url === url)) { err.textContent = 'Esse link já está salvo neste livro.'; return; }
    const label = form.elements.label.value.trim();
    store.updateBook(b.id, { links: [...(b.links || []), { id: uid(), label, url }] });
    this.renderMyLinks();
    const input = this.info.querySelector('[data-link-form] input[name="label"]');
    if (input) input.focus();
  }

  removeLink(linkId) {
    const b = this.book;
    store.updateBook(b.id, { links: (b.links || []).filter((l) => l.id !== linkId) });
    this.renderMyLinks();
  }

  readHtml(ins) {
    const item = (r) => `<li class="src src-${r.kind}">
        <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(r.label)}</strong>${ICON_OUT}</a>
        <span>${esc(r.note)}</span>
      </li>`;
    return `<h3 class="bv-h">Em português</h3>
      <div class="pt-slot"><p class="bv-loading">Procurando edições em português no Internet Archive…</p></div>
      ${ins.other.length ? `<details class="other-langs"><summary>Edições em outros idiomas</summary><ul class="sources">${ins.other.map(item).join('')}</ul></details>` : ''}
      <p class="bv-note">Só listamos fontes legais: obras em domínio público e empréstimo digital de bibliotecas.</p>`;
  }

  async loadPortuguese(b, ins, id) {
    let list = null;
    try { list = await portugueseEditions(b); } catch (e) { list = null; }
    if (this.id !== id) return;
    const slot = this.info.querySelector('.pt-slot');
    if (!slot) return;
    const old = /séc|a\.C/.test(String(b.year || '')) || (parseInt(b.year, 10) || ins.firstYear || 9999) < 1955;
    const wikisource = `https://pt.wikisource.org/w/index.php?search=${encodeURIComponent(b.title + ' ' + ((b.authors || [])[0] || ''))}`;
    const rows = (list || []).map((e) => `<li class="src src-download">
        <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer"><strong>Baixar no Internet Archive</strong>${ICON_OUT}</a>
        <span>${esc(e.title || b.title)}${e.year ? ' · ' + esc(e.year) : ''}${e.downloads ? ' · ' + nf.format(e.downloads) + ' downloads' : ''} · PDF, EPUB e leitura online</span>
      </li>`);
    if (old) rows.push(`<li class="src src-download">
        <a href="${esc(wikisource)}" target="_blank" rel="noopener noreferrer"><strong>Ler no Wikisource em português</strong>${ICON_OUT}</a>
        <span>Biblioteca livre de textos em domínio público, para ler online ou baixar.</span>
      </li>`);
    slot.innerHTML = rows.length
      ? `<ul class="sources">${rows.join('')}</ul>${list === null ? '<p class="bv-note">O Internet Archive não respondeu agora; tente abrir o livro de novo daqui a pouco.</p>' : ''}<p class="bv-note">As fontes nem sempre distinguem português do Brasil e de Portugal; o título e o ano ajudam a escolher.</p>`
      : `<p class="bv-text">${list === null ? 'O Internet Archive não respondeu agora. Tente abrir o livro de novo daqui a pouco.' : 'Não encontramos edição digital gratuita em português. Livros recentes costumam estar protegidos por direitos autorais.'}</p>`;
  }

  readersHtml(ins) {
    const stat = (label, value, extra = '') => `<div><dt>${label}</dt><dd>${value}${extra}</dd></div>`;
    const stats = [
      ins.rating ? stat('Nota média', ins.rating.toFixed(1).replace('.', ','), `<span>/5 · ${nf.format(ins.ratingCount)} ${ins.ratingCount === 1 ? 'avaliação' : 'avaliações'}</span>`) : '',
      stat('Querem ler', nf.format(ins.want)),
      stat('Lendo agora', nf.format(ins.reading)),
      stat('Já leram', nf.format(ins.readCount)),
      ins.editions ? stat('Edições', nf.format(ins.editions)) : '',
      ins.firstYear ? stat('1ª publicação', ins.firstYear) : '',
    ].join('');
    const recog = ins.recognitions.length
      ? `<h3 class="bv-h">Reconhecimento</h3><ul class="chips">${ins.recognitions.map((r) => `<li class="chip chip-gold">${esc(r)}</li>`).join('')}</ul>`
      : '';
    const lists = '<div class="lists-slot"><h3 class="bv-h">Quem recomenda</h3><p class="bv-loading">Buscando listas de leitores…</p></div>';
    return `<dl class="stats">${stats}</dl>
      ${recog}
      ${lists}
      <h3 class="bv-h">Resenhas e opiniões</h3>
      <div class="row ext-row">${ext(ins.goodreads, 'Resenhas no Goodreads')}${ext(ins.wikipedia, 'Artigo na Wikipédia')}</div>
      <p class="bv-note">Números da comunidade da Open Library, atualizados por ela.</p>`;
  }

  async loadLists(key, id) {
    let lists = null;
    try { lists = await readerLists(key); } catch (e) { lists = null; }
    if (this.id !== id) return;
    const slot = this.info.querySelector('.lists-slot');
    if (!slot) return;
    if (!lists || !lists.total) {
      slot.innerHTML = lists ? '' : '<h3 class="bv-h">Quem recomenda</h3><p class="bv-loading">As listas de leitores não responderam agora.</p>';
      return;
    }
    slot.innerHTML = `<h3 class="bv-h">Quem recomenda</h3>
      <p class="bv-text">Aparece em ${nf.format(lists.total)} ${lists.total === 1 ? 'lista' : 'listas'} de leitores da Open Library${lists.notable.length ? ', entre elas:' : '.'}</p>
      ${lists.notable.length ? `<ul class="lists">${lists.notable.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)}${ICON_OUT}</a><span>${nf.format(l.count)} livros na lista</span></li>`).join('')}</ul>` : ''}`;
    if (!this.reduce) gsap.from(slot, { opacity: 0, duration: 0.3 });
  }

  topicsHtml(ins) {
    const group = (title, list) => (list.length ? `<h3 class="bv-h">${title}</h3><ul class="chips">${list.map((s) => `<li class="chip">${esc(s)}</li>`).join('')}</ul>` : '');
    const html = group('Assuntos', ins.subjects) + group('Personagens e pessoas', ins.people) + group('Lugares', ins.places) + group('Época', ins.times);
    return html || '<p class="bv-loading">A Open Library não registra temas para esta obra.</p>';
  }

  async loadSimilar() {
    const ins = this.insights;
    const p = this.panel('parecidos');
    if (!ins || !p || p.dataset.loaded === ins.key) return;
    p.dataset.loaded = ins.key;
    const id = this.id;
    let list = [];
    for (const subject of ins.subjects.slice(0, 3)) {
      try { list = await similarBooks(subject, ins.key); } catch (e) { list = []; }
      if (list.length >= 4) break;
    }
    if (this.id !== id) return;
    if (!list.length) { p.innerHTML = '<p class="bv-loading">Não encontrei livros parecidos para esta obra.</p>'; return; }
    this.similar = list;
    const books = store.getState().books;
    const have = (w) => books.some((b) => b.title.toLowerCase() === w.title.toLowerCase());
    p.innerHTML = `<p class="bv-text">Outras obras com o tema <strong>${esc(ins.subjects[0] || '')}</strong>, segundo a Open Library.</p>
      <ul class="similar">${list.map((w, i) => `<li>
        <img src="${esc(w.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div><p class="sim-t">${esc(w.title)}</p><p class="sim-a">${esc(w.authors.join(', '))}${w.year ? ' · ' + esc(w.year) : ''}</p>
        ${have(w) ? '<span class="small">Já está na estante</span>' : `<button type="button" class="btn sim-add" data-add-similar="${i}">Colocar na estante</button>`}</div>
      </li>`).join('')}</ul>`;
    if (!this.reduce) gsap.from(p.querySelectorAll('.similar li'), { opacity: 0, y: 12, duration: 0.35, stagger: 0.04, ease: 'power3.out' });
  }

  addSimilar(btn) {
    const w = this.similar && this.similar[+btn.dataset.addSimilar];
    const b = this.book;
    if (!w || !b) return;
    store.addBook({
      title: w.title, authors: w.authors, year: w.year, sectionId: b.sectionId,
      cover: w.coverLarge, coverSource: 'openlibrary', source: 'openlibrary', link: w.link,
    });
    btn.outerHTML = `<span class="small">Adicionado a ${esc((store.getState().sections.find((s) => s.id === b.sectionId) || {}).name || 'sua estante')}</span>`;
  }

  /* ---------------- events ---------------- */

  onClick(e) {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { this.switchTab(tabBtn.dataset.tab); return; }
    const addBtn = e.target.closest('[data-add-similar]');
    if (addBtn) { this.addSimilar(addBtn); return; }
    const rm = e.target.closest('[data-remove-link]');
    if (rm) { this.removeLink(rm.dataset.removeLink); return; }
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
      const stamp = this.info.querySelector('[data-stamp]');
      if (stamp) {
        stamp.className = 'stamp' + (next ? ' is-' + next : '');
        stamp.textContent = next ? STAMP[next] : '';
        if (next && !this.reduce) gsap.fromTo(stamp, { scale: 1.6, opacity: 0, rotation: -18 }, { scale: 1, opacity: 1, rotation: -9, duration: 0.35, ease: 'back.out(2.2)' });
      }
      const st = this.book3d.querySelector('[data-status-text]');
      if (st) st.textContent = next ? STATUS_TEXT[next] : 'Na estante';
      return;
    }
    const act = el.dataset.act;
    if (act === 'close') this.close();
    else if (act === 'cover') this.toggleCover(el);
    else if (act === 'prev' || act === 'next') this.step(act === 'next' ? 1 : -1);
    else if (act === 'remove') this.remove(el);
    else if (act === 'read-file') this.openReader();
    else if (act === 'drive-remove') { store.updateBook(this.id, { drive: null }, { drive: true }); this.refreshDrive(); }
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
    if (!swapping) this.tab = 'sobre';
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
