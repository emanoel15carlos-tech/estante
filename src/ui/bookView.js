// The open book: pulled off the shelf (or the 3D bookcase), turned to its
// cover, opened on demand, and flown back to its slot when closed.
import { gsap } from 'gsap';
import * as store from '../lib/store.js';
import * as cloud from '../lib/cloud.js';
import * as social from './social.js';
import { SOURCE_LABEL, archiveTracks, bookInsights, librivoxRecordings, portugueseEditions, readerLists, similarBooks } from '../lib/apis.js';
import { parseTracks } from './player.js';
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
  ['resenhas', 'Resenhas'],
  ['ler', 'Ler e baixar'],
  ['ouvir', 'Ouvir'],
  ['leitores', 'Leitores'],
  ['temas', 'Temas'],
  ['parecidos', 'Parecidos'],
];
const nf = new Intl.NumberFormat('pt-BR');
const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/></svg>';
const stars = (n) => `<span class="stars" aria-label="${n} de 5 estrelas">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? 'on' : ''}">${STAR}</span>`).join('')}</span>`;
export const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days < 1) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
};
export { stars };
const ICON_OUT = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2h7v7M12 2L5.5 8.5M10 9.5V12H2V4h2.5" stroke="currentColor" stroke-width="1.4"/></svg>';
const DRIVE_ICON = '<svg width="22" height="20" viewBox="0 0 22 20" fill="none" aria-hidden="true"><path d="M7.5 1h7l7 12-3.5 6h-14L.5 13l7-12z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 1l7 12M14.5 1l-7 12M.5 13h21" stroke="currentColor" stroke-width="1.4"/></svg>';
// Data from friends' shelves is never trusted as-is: Drive items are rebuilt from their link,
// and other links must be plain http(s) addresses.
const safeDrive = (d) => (d ? parseDrive(d.url || d.open || '') : null);
const safeLinks = (links) => (Array.isArray(links) ? links : []).map((l) => ({ label: String((l && l.label) || '').slice(0, 80), url: normalizeUrl(l && l.url) })).filter((l) => l.url);
const safeTracks = (tracks) => (Array.isArray(tracks) ? tracks : []).map((t) => {
  const url = t && (parseDrive(t.url) ? parseDrive(t.url).url : normalizeUrl(t.url));
  return url ? { title: String((t && t.title) || 'Faixa').slice(0, 120), url } : null;
}).filter(Boolean).slice(0, 200);
const ext = (url, label) => `<a class="ext" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}${ICON_OUT}</a>`;

const EMBLEM = '<svg width="92" height="92" viewBox="0 0 92 92" fill="none" aria-hidden="true"><circle cx="46" cy="46" r="44" stroke="currentColor"/><circle cx="46" cy="46" r="30" stroke="currentColor"/><path d="M46 2v88M2 46h88" stroke="currentColor"/></svg>';

export class BookView {
  constructor({ reduce, getList, onOpenChange, player }) {
    this.player = player;
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
    social.bind(this.info, (t) => this.flash(t));
    this.info.addEventListener('change', (e) => this.onChange(e));
    this.info.addEventListener('input', (e) => {
      if (!e.target.matches('[data-range]')) return;
      const v = +e.target.value;
      const n = this.info.querySelector('[data-page]');
      if (n) n.value = v;
      const pct = this.info.querySelector('[data-pct]');
      if (pct) pct.textContent = Math.round((v / +e.target.max) * 100) + '%';
    });
    this.info.addEventListener('submit', (e) => {
      const af = e.target.closest('[data-audio-form]');
      if (af) { e.preventDefault(); this.onAudioSubmit(af); return; }
      const pp = e.target.closest('[data-propose-form]');
      if (pp) { e.preventDefault(); this.onPropose(pp); return; }
      const rv = e.target.closest('[data-review-form]');
      if (rv) { e.preventDefault(); this.onReviewSubmit(rv); return; }
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
      ${b.status === 'lendo' ? `<div class="b3-ribbon" aria-hidden="true" style="--len:${Math.round(14 + Math.min(100, ((b.progress || {}).page || 0) / Math.max(1, (b.progress || {}).total || b.pageCount || 1) * 100) * 0.5)}px"></div>` : ''}
      <div class="cover">
        <div class="cv-front">${this.coverHtml(b)}</div>
        <div class="cv-in"></div>
      </div>`;
    const img = this.book3d.querySelector('.cv-front img');
    if (img) img.addEventListener('error', () => { img.outerHTML = img.dataset.drawn; }, { once: true });
  }

  renderInfo(b) {
    if (this.pocketFor !== b.id) { this.pocketHouse = []; this.pocketFor = b.id; this.lvList = null; this.houseAudio = []; this.editingAudio = false; }
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
        <div class="bookmark-slot">${this.progressHtml(b)}</div>
        <div class="club-slot">${this.clubHtml(b)}</div>
        <div class="meta-row">
          <label class="field"><span class="field-label">Seção</span>
            <select data-act="section">${sections.map((s) => `<option value="${esc(s.id)}"${s.id === b.sectionId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          </label>
          <button type="button" class="btn btn-danger" data-act="remove">${this.confirmRemove ? 'Confirmar remoção' : 'Remover'}</button>
        </div>
        ${prov ? `<p class="provenance">${prov}</p>` : ''}
        ${this.pocketHtml(b, cn)}
      </div>
      ${TABS.slice(1).map(([id]) => `<div class="bv-panel" role="tabpanel" id="bvp-${id}" aria-labelledby="bvt-${id}"${tab === id ? '' : ' hidden'}>${id === 'ler' ? '<div class="house-files"></div>' + this.shareToggleHtml(b) + this.driveHtml(b) + this.myLinksHtml(b) + '<div class="ler-auto"><p class="bv-loading">Buscando informações na Open Library…</p></div>' : id === 'resenhas' ? this.reviewsHtml(b) : id === 'ouvir' ? this.listenHtml(b) : '<p class="bv-loading">Buscando informações na Open Library…</p>'}</div>`).join('')}
      <div class="row bv-actions">
        <button type="button" class="btn btn-solid" data-act="cover">${this.coverOpen ? 'Fechar livro' : 'Abrir livro'}</button>
        ${b.drive ? '<button type="button" class="btn btn-drive" data-act="read-file">' + DRIVE_ICON + 'Ler o arquivo</button>' : ''}
        <button type="button" class="btn" data-act="prev" aria-label="Livro anterior"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6"/></svg>Anterior</button>
        <button type="button" class="btn" data-act="next" aria-label="Próximo livro">Próximo<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6"/></svg></button>
      </div>`;
    this.loadInsights(b);
    this.loadHouseReviews(b);
  }

  /* ---------------- bookmark: the page you are on ---------------- */

  progressHtml(b) {
    const ro = store.isReadOnly();
    const pr = b.progress || {};
    const total = pr.total || b.pageCount || (this.insights && this.insights.pages) || 0;
    const page = Math.min(pr.page || 0, total || Infinity);
    const pct = total ? Math.round((page / total) * 100) : 0;
    if (ro) {
      if (b.status !== 'lendo' || !page) return '';
      return `<div class="bookmark is-ro"><p class="bm-line">Na página <strong>${nf.format(page)}</strong>${total ? ` de ${nf.format(total)} · ${pct}%` : ''}</p>
        ${total ? `<div class="bm-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>` : ''}</div>`;
    }
    if (b.status !== 'lendo') {
      return b.status === 'lido' ? '' : '<button type="button" class="link-btn bm-start" data-act="start-reading">Comecei a ler: marcar a página</button>';
    }
    return `<div class="bookmark" role="group" aria-labelledby="bm-h">
      <span class="bm-ribbon" aria-hidden="true"></span>
      <h3 class="bv-h" id="bm-h">Marcador</h3>
      <div class="bm-row">
        <label class="bm-field"><span>Estou na página</span>
          <span class="stepper">
            <button type="button" class="icon-btn sm" data-step="-1" aria-label="Voltar uma página">−</button>
            <input type="number" inputmode="numeric" min="0" ${total ? `max="${total}"` : ''} value="${page || ''}" placeholder="0" data-page aria-label="Página atual">
            <button type="button" class="icon-btn sm" data-step="1" aria-label="Avançar uma página">+</button>
          </span>
        </label>
        <label class="bm-field"><span>de</span><input type="number" inputmode="numeric" min="1" value="${total || ''}" placeholder="total" data-total aria-label="Total de páginas"></label>
      </div>
      ${total ? `<input type="range" class="bm-range" min="0" max="${total}" value="${page}" data-range aria-label="Arraste até a página em que você está">
      <p class="bm-line"><strong data-pct>${pct}%</strong> lido${pr.at ? ` · marcado ${when(pr.at)}` : ''}${total - page > 0 ? ` · faltam ${nf.format(total - page)} páginas` : ''}</p>` : '<p class="bm-line">Informe o total de páginas para ver quanto falta.</p>'}
    </div>`;
  }

  renderProgress() {
    const slot = this.info.querySelector('.bookmark-slot');
    if (slot && this.book) slot.innerHTML = this.progressHtml(this.book);
  }

  saveProgress({ page, total }) {
    const b = this.book;
    const pr = b.progress || {};
    const next = { page: pr.page || 0, total: pr.total || b.pageCount || (this.insights && this.insights.pages) || 0 };
    if (total !== undefined) next.total = Math.max(0, Math.round(total) || 0);
    if (page !== undefined) next.page = Math.max(0, Math.round(page) || 0);
    if (next.total && next.page > next.total) next.page = next.total;
    next.at = new Date().toISOString();
    const patch = { progress: next };
    const done = next.total && next.page >= next.total && b.status === 'lendo';
    if (done) patch.status = 'lido';
    store.updateBook(b.id, patch, { pages: Math.max(0, next.page - (pr.page || 0)) });
    if (done) {
      this.setStatusUi('lido');
      this.note('Fim do livro. Marcamos como lido.');
    } else {
      this.renderProgress();
    }
  }

  note(text) {
    const slot = this.info.querySelector('.bookmark-slot');
    if (!slot) return;
    slot.insertAdjacentHTML('beforeend', `<p class="bm-done" role="status">${esc(text)}</p>`);
  }

  /* ---------------- Ouvir: audiobooks ---------------- */

  listenItem(b, tracks, { who = null, key = null, own = false } = {}) {
    const item = {
      key: key || `${who ? who.id : 'eu'}:${b.id}`,
      title: b.title,
      author: (b.authors || [])[0] || '',
      cover: b.cover && !String(b.cover).startsWith('data:') ? b.cover : null,
      color: b.color,
      who: who ? who.display_name : null,
      tracks,
    };
    if (own && b.audiobook && b.audiobook.pos) item.startAt = b.audiobook.pos;
    if (own) item.onSave = (pos) => { const cur = store.getState().books.find((x) => x.id === b.id); if (cur && cur.audiobook) store.updateBook(b.id, { audiobook: { ...cur.audiobook, pos } }, { listen: true }); };
    return item;
  }

  audioCard(b, ab, { who = null, own = false, idx = '' } = {}) {
    const tracks = safeTracks(ab && ab.tracks);
    if (!tracks.length) return '';
    const pos = own ? ab.pos : null;
    const where = pos && (pos.i || pos.t) ? `Continuar ${tracks.length > 1 ? `em “${esc((tracks[pos.i] || tracks[0]).title)}”, ` : 'em '}${Math.floor((pos.t || 0) / 60)} min` : 'Começar do início';
    const label = ab.source === 'librivox' ? 'Gravação do LibriVox (domínio público)' : ab.source === 'fadebooks' ? 'Gerado com o FadeBooks' : 'Audiobook';
    return `<div class="audio-card${own ? ' is-own' : ''}">
      <span class="ac-disc" aria-hidden="true"></span>
      <div class="ac-main">
        <p class="ac-kicker">${who ? `De ${esc(who.display_name)}` : label}</p>
        <p class="ac-title serif">${tracks.length} ${tracks.length === 1 ? 'faixa' : 'capítulos'}</p>
        <div class="row">
          <button type="button" class="btn btn-solid btn-sm" data-listen="${own ? 'own' : 'house'}" data-idx="${idx}">${this.player && this.player.isCurrent(this.listenKey(b, who)) && this.player.playing ? 'Tocando agora' : `▶ ${where}`}</button>
          ${own ? '<button type="button" class="link-btn" data-act="audio-edit">Trocar</button><button type="button" class="link-btn danger" data-act="audio-remove">Remover</button>' : ''}
        </div>
      </div>
    </div>`;
  }

  listenKey(b, who) { return `${who ? who.id : 'eu'}:${b.id}`; }

  listenHtml(b) {
    const ro = store.isReadOnly();
    const owner = store.visiting();
    let html = '<div class="house-audio"></div>';
    if (ro) {
      html += b.audiobook ? `<h3 class="bv-h">Audiobook de ${esc(owner.display_name)}</h3>${this.audioCard(b, b.audiobook, { who: owner })}` : '';
    } else if (b.audiobook && !this.editingAudio) {
      html += `<h3 class="bv-h">Meu audiobook</h3>${this.audioCard(b, b.audiobook, { own: true })}`;
    } else {
      const cur = b.audiobook ? safeTracks(b.audiobook.tracks).map((t) => `${t.title} | ${t.url}`).join('\n') : '';
      html += `<form class="audio-form" data-audio-form novalidate>
        <h3 class="bv-h">Meu audiobook</h3>
        <label class="field"><span class="field-label">Links do áudio, um por linha</span>
          <textarea name="tracks" rows="4" placeholder="Capítulo 1 | https://drive.google.com/file/d/…&#10;Capítulo 2 | https://drive.google.com/file/d/…">${esc(cur)}</textarea>
          <span class="hint-line">Pode ser um arquivo só (o livro inteiro) ou um link por capítulo. O nome antes do “|” é opcional. Vale link do Google Drive ou de qualquer MP3 público.</span></label>
        <label class="check"><input type="checkbox" name="fadebooks" ${b.audiobook && b.audiobook.source === 'fadebooks' ? 'checked' : ''}><span>Gerado com o FadeBooks</span></label>
        <p class="form-error" role="alert"></p>
        <div class="row"><button type="submit" class="btn btn-solid">Guardar audiobook</button>${b.audiobook ? '<button type="button" class="link-btn" data-act="audio-cancel">Cancelar</button>' : ''}</div>
      </form>
      <details class="fadebooks-help">
        <summary>Como transformar o PDF em audiobook com o FadeBooks</summary>
        <ol>
          <li>Abra o FadeBooks no seu computador e arraste o PDF do livro. Ele narra e monta o áudio com os efeitos.</li>
          <li>Os arquivos ficam na pasta <code>FadeBooks</code> da sua pasta de usuário. Envie o livro completo (ou a pasta de capítulos) para o Google Drive.</li>
          <li>No Drive, compartilhe como “Qualquer pessoa com o link”, copie o link de cada arquivo e cole acima.</li>
        </ol>
        <a class="btn btn-sm" href="http://127.0.0.1:8765/" target="_blank" rel="noopener">Abrir o FadeBooks</a>
        <span class="hint-line">O botão só funciona com o FadeBooks aberto neste computador.</span>
      </details>`;
    }
    html += '<div class="librivox"><h3 class="bv-h">Gratuito, em domínio público</h3><p class="bv-loading">Procurando gravações no LibriVox…</p></div>';
    return html;
  }

  renderListen() {
    const p = this.panel('ouvir');
    if (!p || !this.book) return;
    p.innerHTML = this.listenHtml(this.book);
    this.renderHouseAudio();
    if (this.lvList) this.renderLibrivox(this.lvList); else this.loadLibrivox(true);
  }

  onAudioSubmit(form) {
    const err = form.querySelector('.form-error');
    const tracks = parseTracks(form.elements.tracks.value);
    if (!tracks.length) { err.textContent = 'Cole pelo menos um link de áudio (Google Drive ou MP3 público).'; form.elements.tracks.focus(); return; }
    const b = this.book;
    store.updateBook(b.id, { audiobook: { tracks, source: form.elements.fadebooks.checked ? 'fadebooks' : 'link', addedAt: new Date().toISOString(), pos: null } });
    this.editingAudio = false;
    this.renderListen();
    this.flash('Audiobook guardado. Quem mora com você também pode ouvir.');
  }

  playListen(btn) {
    const b = this.book;
    if (!this.player || !b) return;
    if (btn.dataset.listen === 'own' || (btn.dataset.listen === 'house' && store.isReadOnly() && btn.dataset.idx === '')) {
      const ro = store.isReadOnly();
      const who = ro ? store.visiting() : null;
      this.player.load(this.listenItem(b, safeTracks(b.audiobook.tracks), { who, own: !ro, key: this.listenKey(b, who) }));
    } else if (btn.dataset.listen === 'house') {
      const f = (this.houseAudio || [])[+btn.dataset.idx];
      if (f) this.player.load(this.listenItem(b, safeTracks(f.audiobook.tracks), { who: f.who, key: this.listenKey(b, f.who) }));
    }
    btn.textContent = 'Tocando agora';
  }

  renderHouseAudio() {
    const slot = this.info.querySelector('.house-audio');
    if (!slot || !this.book) return;
    const list = this.houseAudio || [];
    slot.innerHTML = list.length ? `<h3 class="bv-h">Da casa</h3>${list.map((f, i) => this.audioCard(this.book, f.audiobook, { who: f.who, idx: String(i) })).join('')}` : '';
  }

  async loadLibrivox(force = false) {
    const b = this.book;
    const id = this.id;
    const box = this.info.querySelector('.librivox');
    if (!b || !box || (!force && box.dataset.loaded === b.id)) return;
    box.dataset.loaded = b.id;
    let list = null;
    try { list = await librivoxRecordings(b); } catch (e) { list = null; }
    if (this.id !== id) return;
    this.lvList = list;
    this.renderLibrivox(list);
  }

  renderLibrivox(list) {
    const box = this.info.querySelector('.librivox');
    if (!box) return;
    const ro = store.isReadOnly();
    if (!list) { box.innerHTML = '<h3 class="bv-h">Gratuito, em domínio público</h3><p class="bv-text">O LibriVox não respondeu agora. Tente abrir o livro de novo daqui a pouco.</p>'; return; }
    if (!list.length) { box.innerHTML = '<h3 class="bv-h">Gratuito, em domínio público</h3><p class="bv-text">Não achamos gravação gratuita deste livro no LibriVox. Eles gravam obras em domínio público, em geral clássicos.</p>'; return; }
    box.innerHTML = `<h3 class="bv-h">Gratuito, em domínio público</h3>
      <ul class="sources lv-list">${list.map((r, i) => `<li class="src src-audio">
        <span class="lv-title"><strong>${esc(r.title)}</strong>${r.pt ? '<span class="lv-pt">em português</span>' : ''}</span>
        <span>${esc(r.language || 'idioma não informado')} · LibriVox, gravado por voluntários</span>
        <span class="row lv-actions"><button type="button" class="btn btn-sm" data-lv-play="${i}">▶ Ouvir</button>${ro ? '' : `<button type="button" class="link-btn" data-lv-keep="${i}">Guardar como meu audiobook</button>`}<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="link-btn">Ver no Archive${ICON_OUT}</a></span>
      </li>`).join('')}</ul>`;
  }

  async useLibrivox(i, keep, btn) {
    const r = (this.lvList || [])[i];
    const b = this.book;
    if (!r || !b) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Carregando…';
    let tracks = [];
    try { tracks = await archiveTracks(r.id); } catch (e) { tracks = []; }
    btn.disabled = false;
    btn.textContent = label;
    if (!tracks.length) { this.flash('Não achamos os arquivos de áudio dessa gravação.'); return; }
    const clean = tracks.map((t) => ({ title: t.title, url: t.url }));
    if (keep) {
      store.updateBook(b.id, { audiobook: { tracks: clean, source: 'librivox', id: r.id, addedAt: new Date().toISOString(), pos: null } });
      this.renderListen();
      this.flash('Gravação do LibriVox guardada neste livro.');
    } else if (this.player) {
      this.player.load(this.listenItem(b, clean, { key: `lv:${r.id}` }));
    }
  }

  /* ---------------- loan card in the book's pocket ---------------- */

  pocketRows(b) {
    const owner = store.visiting();
    const me = cloud.currentProfile();
    const who = owner ? owner.display_name : (me ? me.display_name : 'Você');
    const rows = [];
    if (b.addedAt) rows.push({ at: new Date(b.addedAt).toISOString(), who, what: 'catalogou' });
    let finishes = 0;
    const hist = (b.history && b.history.length) ? b.history : (b.finishedAt ? [{ t: 'finish', at: b.finishedAt }] : []);
    hist.forEach((h) => {
      if (h.t === 'finish') finishes++;
      rows.push({ at: h.at, who, what: h.t === 'start' ? (finishes ? 'começou a reler' : 'começou') : finishes > 1 ? 'releu' : 'terminou', done: h.t === 'finish' });
    });
    return rows.concat(this.pocketHouse || []).sort((x, y) => String(x.at || '9').localeCompare(String(y.at || '9')));
  }

  pocketBody(b) {
    const rows = this.pocketRows(b);
    if (!rows.length) return '<tr><td colspan="3" class="pc-empty">Nenhum carimbo ainda. Marque Lendo ou Lido e a ficha ganha a primeira data.</td></tr>';
    const stampDate = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '').replace(/ de /g, ' ').toUpperCase() : '—');
    return rows.map((r, i) => `<tr${r.house ? ' class="is-house"' : ''}>
      <td class="pc-date"><span style="--r:${((i * 47) % 7) - 3}deg">${esc(stampDate(r.at))}</span></td>
      <td class="pc-who">${esc(r.who)} <span>${esc(r.what)}</span></td>
      <td class="pc-mark"><span class="pc-ini${r.done ? ' is-done' : ''}" style="--r:${((i * 29) % 11) - 5}deg">${esc(String(r.who || '?').trim()[0] || '?').toUpperCase()}</span></td>
    </tr>`).join('');
  }

  pocketHtml(b, cn) {
    return `<div class="pocket${this.pocketOpen ? ' is-open' : ''}">
      <button type="button" class="pocket-pull" data-act="pocket" aria-expanded="${!!this.pocketOpen}">${this.pocketOpen ? 'Guardar a ficha' : 'Puxar a ficha de leitura'}</button>
      <div class="pocket-card" id="pocket-card">
        <p class="pc-head"><span>${esc([cn.code, cn.cutter].filter(Boolean).join(' '))}</span><span>Ficha de leitura</span></p>
        <p class="pc-title">${esc(b.title)}</p>
        <table class="pc-table"><thead><tr><th scope="col">Data</th><th scope="col">Leitor</th><th scope="col"><span class="sr">Carimbo</span></th></tr></thead>
        <tbody data-pocket-body>${this.pocketBody(b)}</tbody></table>
      </div>
      <div class="pocket-sleeve" aria-hidden="true"><span>Estante · biblioteca particular</span><span class="ps-rule"></span><span>Devolva o livro à sua prateleira</span></div>
    </div>`;
  }

  renderPocket() {
    const body = this.info.querySelector('[data-pocket-body]');
    if (body && this.book) body.innerHTML = this.pocketBody(this.book);
  }

  togglePocket(btn) {
    this.pocketOpen = !this.pocketOpen;
    const pocket = btn.closest('.pocket');
    pocket.classList.toggle('is-open', this.pocketOpen);
    btn.setAttribute('aria-expanded', String(this.pocketOpen));
    btn.textContent = this.pocketOpen ? 'Guardar a ficha' : 'Puxar a ficha de leitura';
    const card = pocket.querySelector('.pocket-card');
    if (!this.reduce) gsap.fromTo(card, { y: this.pocketOpen ? 30 : -10 }, { y: 0, duration: 0.55, ease: this.pocketOpen ? 'back.out(1.6)' : 'power3.out' });
  }

  /* ---------------- reviews ---------------- */

  reviewsHtml(b) {
    const ro = store.isReadOnly();
    const mine = b.reviews || [];
    const owner = store.visiting();
    const list = (rs, who) => rs.map((r) => this.reviewCard(r, who)).join('');
    let html = '';
    if (ro) {
      html += mine.length ? `<h3 class="bv-h">De ${esc(owner.display_name)}</h3><ul class="reviews">${list(mine, owner)}</ul>` : '';
    } else {
      html += this.reviewFormHtml();
      if (mine.length) html += `<h3 class="bv-h">Suas resenhas</h3><ul class="reviews">${list(mine, null)}</ul>`;
    }
    html += '<div class="house-reviews"></div>';
    return html;
  }

  reviewCard(r, who) {
    const own = !who && !store.isReadOnly();
    const by = who ? `<span class="rv-by">${esc(who.display_name)}</span>` : '';
    return `<li class="review${r.kind === 'link' ? ' is-link' : ''}">
      <div class="rv-head">
        ${by}
        ${r.kind === 'link' ? '<span class="rv-kind">Resenha indicada</span>' : r.rating ? stars(r.rating) : ''}
        <span class="rv-when">${esc(when(r.at))}</span>
        ${own ? `<span class="rv-vis ${r.public ? 'is-pub' : ''}">${r.public ? 'Publicada' : 'Só você'}</span>` : ''}
      </div>
      ${r.text ? `<p class="rv-text">${esc(r.text)}</p>` : ''}
      ${r.url ? `<a class="ext rv-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source || hostOf(r.url))}${ICON_OUT}</a>` : ''}
      ${r.public || who ? social.socialHtml(who ? who.id : (store.visiting() ? store.visiting().id : cloud.currentUser() && cloud.currentUser().id), r.id) : ''}
      ${own ? `<div class="rv-actions"><button type="button" class="link-btn" data-review-toggle="${esc(r.id)}">${r.public ? 'Deixar só para mim' : 'Publicar para os leitores'}</button><button type="button" class="link-btn" data-review-remove="${esc(r.id)}">Apagar</button></div>` : ''}
    </li>`;
  }

  reviewFormHtml() {
    const kind = this.reviewKind || 'own';
    const signedIn = !!cloud.currentProfile();
    return `<form class="review-form" data-review-form novalidate>
      <div class="seg seg-sm" role="tablist" aria-label="Tipo de resenha">
        <button type="button" role="tab" class="seg-btn${kind === 'own' ? ' is-on' : ''}" aria-selected="${kind === 'own'}" data-review-kind="own">Minha resenha</button>
        <button type="button" role="tab" class="seg-btn${kind === 'link' ? ' is-on' : ''}" aria-selected="${kind === 'link'}" data-review-kind="link">Indicar uma resenha</button>
      </div>
      ${kind === 'own' ? `<fieldset class="rate"><legend>Sua nota</legend>
          ${[1, 2, 3, 4, 5].map((i) => `<label><input type="radio" name="rating" value="${i}"><span class="sr">${i} ${i === 1 ? 'estrela' : 'estrelas'}</span>${STAR}</label>`).join('')}
        </fieldset>
        <label class="field"><span class="field-label">O que você achou</span><textarea name="text" rows="4" maxlength="2000" placeholder="O que ficou com você depois da leitura?"></textarea></label>`
      : `<label class="field"><span class="field-label">Link da resenha</span><input name="url" inputmode="url" placeholder="https://… (blog, jornal, vídeo, Goodreads)" autocomplete="off"></label>
        <label class="field"><span class="field-label">Por que vale ler <span class="opt">(opcional)</span></span><textarea name="text" rows="3" maxlength="1000"></textarea></label>`}
      <label class="check"><input type="checkbox" name="public" ${signedIn ? 'checked' : 'disabled'}><span>${signedIn ? 'Publicar para os leitores da casa' : 'Entre na sua conta (botão Leitores) para publicar'}</span></label>
      <p class="form-error" role="alert"></p>
      <button type="submit" class="btn btn-solid">${kind === 'own' ? 'Guardar resenha' : 'Guardar indicação'}</button>
    </form>`;
  }

  renderReviews() {
    const p = this.panel('resenhas');
    if (!p || !this.book) return;
    p.innerHTML = this.reviewsHtml(this.book);
    social.hydrate(p);
    this.loadHouseReviews(this.book, { cached: true });
  }

  /* ---------------- leitura da casa ---------------- */

  clubHtml(b) {
    if (store.isReadOnly() || !cloud.currentProfile()) return '';
    return '<button type="button" class="link-btn club-propose" data-act="propose">Propor como leitura da casa</button>';
  }

  renderClub() {
    const slot = this.info.querySelector('.club-slot');
    if (slot && this.book) slot.innerHTML = this.clubHtml(this.book);
  }

  showPropose() {
    const slot = this.info.querySelector('.club-slot');
    if (!slot) return;
    const d = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const hs = cloud.myHouses();
    if (!hs.length) {
      slot.innerHTML = '<p class="bm-done">Para ler junto, entre numa casa ou crie a sua em Leitores › Casas.</p>';
      return;
    }
    slot.innerHTML = `<form class="propose" data-propose-form novalidate>
      <h3 class="bv-h">Leitura da casa</h3>
      <p class="small">Os moradores veem a proposta no Mural e podem entrar na leitura.</p>
      ${hs.length > 1 ? `<label class="field"><span class="field-label">Para qual casa</span><select name="house">${hs.map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join('')}</select></label>` : `<input type="hidden" name="house" value="${esc(hs[0].id)}">`}
      <label class="field"><span class="field-label">Ler até</span><input type="date" name="ends_on" value="${d}" min="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="field"><span class="field-label">Recado para a casa <span class="opt">(opcional)</span></span><textarea name="note" rows="2" maxlength="500" placeholder="Por que vale ler juntos?"></textarea></label>
      <p class="form-error" role="alert"></p>
      <div class="row"><button type="submit" class="btn btn-solid">Propor leitura</button><button type="button" class="link-btn" data-act="propose-cancel">Cancelar</button></div>
    </form>`;
    slot.querySelector('input').focus();
  }

  async onPropose(form) {
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await cloud.proposeHouseRead(this.book, { note: form.elements.note.value.trim(), ends_on: form.elements.ends_on.value || null, house_id: form.elements.house.value });
      const b = this.book;
      if (b.status !== 'lendo' && b.status !== 'lido') { store.updateBook(b.id, { status: 'lendo' }); this.setStatusUi('lendo'); }
      this.renderClub();
      this.flash(`“${b.title}” agora é leitura da casa. Está no Mural.`);
    } catch (e) {
      btn.disabled = false;
      form.querySelector('.form-error').textContent = /house_reads/.test(e.message || '') ? 'O clube do livro precisa da parte 2 da configuração do Supabase.' : 'Não deu para propor agora. Tente de novo.';
    }
  }

  flash(text) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    gsap.killTweensOf(t);
    gsap.to(t, { yPercent: 0, opacity: 1, duration: this.reduce ? 0 : 0.45, ease: 'expo.out' });
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => gsap.to(t, { opacity: 0, yPercent: 160, duration: this.reduce ? 0 : 0.3 }), 3200);
  }

  onReviewSubmit(form) {
    const err = form.querySelector('.form-error');
    const kind = this.reviewKind || 'own';
    const text = form.elements.text.value.trim();
    const entry = { id: uid(), kind, text, public: !!(form.elements.public && form.elements.public.checked), at: new Date().toISOString() };
    if (kind === 'own') {
      const r = form.querySelector('input[name="rating"]:checked');
      entry.rating = r ? +r.value : 0;
      if (!entry.rating && !text) { err.textContent = 'Dê uma nota ou escreva o que achou.'; return; }
    } else {
      const url = normalizeUrl(form.elements.url.value);
      if (!url) { err.textContent = 'Cole o link completo da resenha.'; form.elements.url.focus(); return; }
      entry.url = url;
      entry.source = hostOf(url);
    }
    const b = this.book;
    store.updateBook(b.id, { reviews: [entry, ...(b.reviews || [])] });
    this.renderReviews();
    const first = this.panel('resenhas').querySelector('.reviews li');
    if (first && !this.reduce) gsap.from(first, { opacity: 0, y: -10, duration: 0.4, ease: 'power3.out' });
  }

  async loadHouseReviews(b, { cached = false } = {}) {
    const id = b.id;
    if (!cloud.currentProfile()) return;
    let feed = null;
    try { feed = await cloud.loadFeed(); } catch (e) { return; }
    if (this.id !== id) return;
    const slot = this.info.querySelector('.house-reviews');
    if (!slot) return;
    const key = cloud.bookKey(b);
    const me = cloud.currentProfile();
    const owner = store.visiting();
    const others = feed.reviews.filter((r) => r.key === key && r.who.id !== me.id && !(owner && r.who.id === owner.id));
    const readingNow = feed.reading.filter((r) => r.key === key && r.who.id !== me.id);
    const ownerId = owner ? owner.id : me.id;
    this.houseFiles = (feed.files.get(key) || []).filter((f) => f.who.id !== ownerId && f.who.id !== me.id);
    this.houseAudio = this.houseFiles.filter((f) => f.audiobook && safeTracks(f.audiobook.tracks).length);
    this.renderHouseAudio();
    const hf = this.info.querySelector('.house-files');
    if (hf) hf.innerHTML = this.houseFilesHtml(this.houseFiles);
    this.pocketHouse = [
      ...(feed.done.get(key) || []).filter((d) => d.who.id !== ownerId).map((d) => ({ at: d.at, who: d.who.display_name, what: 'leu', done: true, house: true })),
      ...feed.reading.filter((r) => r.key === key && r.who.id !== ownerId).map((r) => ({ at: r.at, who: r.who.display_name, what: r.page ? `está na pág. ${r.page}` : 'está lendo', house: true })),
    ];
    this.renderPocket();
    slot.innerHTML = (readingNow.length ? `<p class="bv-text house-reading">${readingNow.map((r) => `<strong>${esc(r.who.display_name)}</strong>${r.page ? ` está na página ${nf.format(r.page)}${r.total ? ` de ${nf.format(r.total)}` : ''}` : ' está lendo'}`).join(' · ')}.</p>` : '')
      + (others.length ? `<h3 class="bv-h">Dos leitores da casa</h3><ul class="reviews">${others.map((r) => this.reviewCard(r, r.who)).join('')}</ul>` : '');
    social.hydrate(this.panel('resenhas'));
  }

  setStatusUi(next) {
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
    this.renderProgress();
    this.renderPocket();
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
    if (id === 'ouvir') this.loadLibrivox();
  }

  async loadInsights(b) {
    const id = b.id;
    this.insights = null;
    let ins = null, failed = false;
    try { ins = await bookInsights(b); } catch (e) { failed = true; }
    if (this.id !== id) return; // the reader moved on to another book
    this.insights = ins;
    if (ins && ins.pages && this.book && !(this.book.progress || {}).total && !this.book.pageCount) this.renderProgress();
    const msg = failed
      ? '<p class="bv-loading">Não foi possível falar com a Open Library agora. Tente de novo daqui a pouco.</p>'
      : '<p class="bv-loading">A Open Library não tem esta obra cadastrada.</p>';
    if (!ins) {
      TABS.slice(1).filter(([t]) => t !== 'resenhas' && t !== 'ouvir').forEach(([t]) => { const p = t === 'ler' ? this.info.querySelector('.ler-auto') : this.panel(t); if (p) p.innerHTML = msg; });
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
    const d = b.drive;
    if (store.isReadOnly()) {
      // A friend's shelf: rebuild the Drive address from the link itself, never trust stored URLs.
      const safe = safeDrive(d);
      const links = safeLinks(b.links);
      if (!safe && !links.length) return '';
      const who = store.visiting().display_name;
      return `<section class="drive-box has-file shared-box" aria-labelledby="dr-h">
        <h3 class="bv-h" id="dr-h">Compartilhado por ${esc(who)}</h3>
        ${safe ? `<div class="drive-card"><span class="drive-icon">${DRIVE_ICON}</span><div class="drive-meta"><strong>${esc(d.name || safe.label)}</strong><span>${esc(safe.label)}</span></div></div>
        <div class="row">
          <button type="button" class="btn btn-solid" data-act="read-file">Ler aqui</button>
          <a class="btn" href="${esc(safe.open)}" target="_blank" rel="noopener noreferrer">Abrir no Drive${ICON_OUT}</a>
        </div>` : ''}
        ${links.length ? `<ul class="sources">${links.map((l) => `<li class="src src-mine"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(l.label || hostOf(l.url))}</strong>${ICON_OUT}</a><span>${esc(hostOf(l.url))}</span></li>`).join('')}</ul>` : ''}
      </section>`;
    }
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
        <p class="bv-note">Para abrir aqui no site (você e quem mora com você), o arquivo precisa estar compartilhado no Drive como “Qualquer pessoa com o link”.</p>
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

  shareToggleHtml(b) {
    if (store.isReadOnly() || !cloud.currentProfile()) return '';
    const global = store.settings().shareLinks !== false;
    if (!global) return '<p class="share-note">Seus links e arquivos estão só com você. Para mostrar às casas, ligue a opção em Leitores › Sua ficha.</p>';
    return `<label class="check share-note"><input type="checkbox" data-links-share ${b.linksPrivate ? '' : 'checked'}><span>Quem mora comigo vê os meus links, o arquivo e o audiobook deste livro</span></label>`;
  }

  houseFilesHtml(entries) {
    if (!entries.some((f) => safeDrive(f.drive) || safeLinks(f.links).length)) return '';
    return `<section class="house-files-box" aria-labelledby="hf-h">
      <h3 class="bv-h" id="hf-h">Da casa</h3>
      <ul class="hf-list">${entries.map((f, i) => {
        const d = safeDrive(f.drive);
        const links = safeLinks(f.links);
        if (!d && !links.length) return '';
        return `<li class="hf-item">
          <p class="hf-who"><span class="mono sm" aria-hidden="true">${esc((f.who.display_name.trim()[0] || '?').toUpperCase())}</span><strong>${esc(f.who.display_name)}</strong> guardou</p>
          ${d ? `<div class="row hf-row"><span class="drive-icon sm">${DRIVE_ICON}</span><span class="hf-name">${esc((f.drive && f.drive.name) || d.label)}</span>
            <button type="button" class="btn btn-sm" data-read-house="${i}">Ler aqui</button>
            <a class="btn btn-sm" href="${esc(d.open)}" target="_blank" rel="noopener noreferrer">Abrir no Drive${ICON_OUT}</a></div>` : ''}
          ${links.length ? `<ul class="sources">${links.map((l) => `<li class="src src-mine"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(l.label || hostOf(l.url))}</strong>${ICON_OUT}</a><span>${esc(hostOf(l.url))}</span></li>`).join('')}</ul>` : ''}
        </li>`;
      }).join('')}</ul>
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

  openReader(drive = null) {
    const b = this.book;
    const src = drive || (b && b.drive);
    const d = src && (store.isReadOnly() || drive ? safeDrive(src) : src);
    if (!b || !d) return;
    this.showReader(d, src.name || b.title);
  }

  /** Opens Drive's own viewer/player for a (trusted, rebuilt) Drive item. */
  showReader(d, title) {
    if (!d) return;
    const r = document.getElementById('reader');
    r.querySelector('.reader-title').textContent = title;
    r.querySelector('.reader-open').href = d.open;
    const frame = r.querySelector('iframe');
    frame.src = d.preview;
    frame.title = title;
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
    const kindBtn = e.target.closest('[data-review-kind]');
    if (kindBtn) { this.reviewKind = kindBtn.dataset.reviewKind; const f = this.info.querySelector('[data-review-form]'); if (f) { f.outerHTML = this.reviewFormHtml(); } return; }
    const tg = e.target.closest('[data-review-toggle]');
    if (tg) {
      const b = this.book;
      store.updateBook(b.id, { reviews: (b.reviews || []).map((r) => (r.id === tg.dataset.reviewToggle ? { ...r, public: !r.public } : r)) });
      this.renderReviews();
      return;
    }
    const rr = e.target.closest('[data-review-remove]');
    if (rr) {
      if (rr.dataset.armed !== '1') { rr.dataset.armed = '1'; rr.textContent = 'Confirmar'; setTimeout(() => { if (rr.isConnected) { rr.dataset.armed = ''; rr.textContent = 'Apagar'; } }, 3000); return; }
      const b = this.book;
      store.updateBook(b.id, { reviews: (b.reviews || []).filter((r) => r.id !== rr.dataset.reviewRemove) });
      this.renderReviews();
      return;
    }
    const lsn = e.target.closest('[data-listen]');
    if (lsn) { this.playListen(lsn); return; }
    const lvp = e.target.closest('[data-lv-play]');
    if (lvp) { this.useLibrivox(+lvp.dataset.lvPlay, false, lvp); return; }
    const lvk = e.target.closest('[data-lv-keep]');
    if (lvk) { this.useLibrivox(+lvk.dataset.lvKeep, true, lvk); return; }
    const rh = e.target.closest('[data-read-house]');
    if (rh) { const f = (this.houseFiles || [])[+rh.dataset.readHouse]; if (f) this.openReader(f.drive); return; }
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) {
      const b = this.book;
      this.saveProgress({ page: ((b.progress && b.progress.page) || 0) + +stepBtn.dataset.step });
      const again = this.info.querySelector(`[data-step="${stepBtn.dataset.step}"]`);
      if (again) again.focus();
      return;
    }
    const rm = e.target.closest('[data-remove-link]');
    if (rm) { this.removeLink(rm.dataset.removeLink); return; }
    const el = e.target.closest('[data-act],[data-status]');
    if (!el || !this.id) return;
    if (el.dataset.status) {
      const b = this.book;
      const next = b.status === el.dataset.status ? null : el.dataset.status;
      store.updateBook(this.id, { status: next });
      this.setStatusUi(next);
      if (next === 'lendo') { const i = this.info.querySelector('[data-page]'); if (i) i.focus(); }
      return;
    }
    const act = el.dataset.act;
    if (act === 'close') this.close();
    else if (act === 'cover') this.toggleCover(el);
    else if (act === 'prev' || act === 'next') this.step(act === 'next' ? 1 : -1);
    else if (act === 'remove') this.remove(el);
    else if (act === 'read-file') this.openReader();
    else if (act === 'start-reading') { store.updateBook(this.id, { status: 'lendo' }); this.setStatusUi('lendo'); const i = this.info.querySelector('[data-page]'); if (i) i.focus(); }
    else if (act === 'drive-remove') { store.updateBook(this.id, { drive: null, driveShared: false }, { drive: true }); this.refreshDrive(); }
    else if (act === 'propose') this.showPropose();
    else if (act === 'audio-edit') { this.editingAudio = true; this.renderListen(); }
    else if (act === 'audio-cancel') { this.editingAudio = false; this.renderListen(); }
    else if (act === 'audio-remove') {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'Confirmar remoção'; return; }
      store.updateBook(this.id, { audiobook: null });
      this.renderListen();
    }
    else if (act === 'pocket') this.togglePocket(el);
    else if (act === 'propose-cancel') this.renderClub();
  }

  onChange(e) {
    if (e.target.matches('[data-links-share]')) {
      store.updateBook(this.id, { linksPrivate: !e.target.checked });
      this.flash(e.target.checked ? 'Quem mora com você vê os links e o arquivo deste livro.' : 'Os links e o arquivo deste livro ficaram só com você.');
      return;
    }
    if (e.target.matches('[data-page], [data-range]')) { this.saveProgress({ page: +e.target.value }); return; }
    if (e.target.matches('[data-total]')) { this.saveProgress({ total: +e.target.value }); return; }
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
    const slot = document.querySelector(`#corner:not([hidden]) [data-desk="${CSS.escape(this.id)}"]`) || document.querySelector(`.slot[data-book="${CSS.escape(this.id)}"] .spine`);
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
