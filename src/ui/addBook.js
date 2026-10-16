// "Adicionar livro": search the APIs or fill the form by hand.
import { gsap } from 'gsap';
import * as store from '../lib/store.js';
import { completeBook, searchBooks, SOURCE_LABEL } from '../lib/apis.js';
import { suggestSection, translateCategory } from '../lib/categories.js';
import { averageColor, fileToCover, loadCorsImage } from '../lib/covers.js';
import { cleanIsbn, esc, normalizeUrl, parseDrive, uid } from '../lib/util.js';

function sectionOptions(selected) {
  return store.getState().sections
    .map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('') + '<option value="__new">Nova seção…</option>';
}

/** Resolves the section the user picked, creating a new one when asked. */
function resolveSection(selectValue, newName) {
  if (selectValue !== '__new') return selectValue;
  const name = (newName || '').trim();
  if (!name) return null;
  return store.addSection(name).id;
}

async function spineColors(cover) {
  if (!cover) return {};
  const img = await loadCorsImage(cover, 6000);
  const c = img && averageColor(img);
  return c ? { color: c.color, ink: c.ink } : {};
}

export class AddBook {
  constructor({ reduce, onClose }) {
    this.reduce = reduce;
    this.onClose = onClose;
    this.root = document.getElementById('drawer');
    this.panel = this.root.querySelector('.drawer');
    this.scrim = this.root.querySelector('.scrim');
    this.form = document.getElementById('api-form');
    this.input = document.getElementById('api-q');
    this.status = document.getElementById('api-status');
    this.list = document.getElementById('api-results');
    this.manual = document.getElementById('manual-form');
    this.results = [];
    this.manualCover = null;

    this.root.querySelectorAll('[data-close-drawer]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.search(); });
    this.list.addEventListener('click', (e) => this.onResultClick(e));
    this.list.addEventListener('change', (e) => this.onSectionChange(e));
    this.manual.addEventListener('submit', (e) => { e.preventDefault(); this.submitManual(); });
    this.manual.addEventListener('change', (e) => this.onSectionChange(e));
    document.getElementById('m-cover').addEventListener('change', (e) => this.pickCover(e.target.files[0]));
    document.getElementById('m-cover-clear').addEventListener('click', () => this.setManualCover(null));
    document.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    if (import.meta.env.VITE_NO_API === '1') {
      this.root.querySelector('.seg').hidden = true;
      this.root.querySelector('[data-panel="search"]').hidden = true;
      this.root.querySelector('[data-panel="manual"]').hidden = false;
      this.mode = 'manual';
      this.manual.insertAdjacentHTML('afterbegin', '<p class="small">Nesta prévia a busca no Google Books e na Open Library fica desligada, porque a página não pode acessar outros sites. No app rodando no seu computador ou publicado, a busca funciona.</p>');
    }
  }

  open() {
    this.root.hidden = false;
    document.body.classList.add('locked');
    this.manual.querySelector('.section-select').innerHTML = sectionOptions(store.getState().sections[0]?.id);
    if (!this.reduce) {
      gsap.fromTo(this.scrim, { opacity: 0 }, { opacity: 1, duration: 0.3 });
      gsap.fromTo(this.panel, { xPercent: 100 }, { xPercent: 0, duration: 0.55, ease: 'expo.out' });
    }
    setTimeout(() => (this.mode === 'manual' ? this.manual.elements.title : this.input).focus(), this.reduce ? 0 : 200);
  }

  close() {
    if (this.root.hidden) return;
    if (this.ctrl) this.ctrl.abort();
    const done = () => {
      this.root.hidden = true;
      document.body.classList.remove('locked');
      this.onClose && this.onClose();
    };
    if (this.reduce) return done();
    gsap.to(this.scrim, { opacity: 0, duration: 0.25 });
    gsap.to(this.panel, { xPercent: 100, duration: 0.35, ease: 'power3.in', onComplete: done });
  }

  setMode(mode) {
    this.mode = mode;
    this.root.querySelectorAll('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    this.root.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== mode; });
    if (mode === 'manual') {
      this.manual.querySelector('.section-select').innerHTML = sectionOptions(store.getState().sections[0]?.id);
      this.manual.elements.title.focus();
    } else this.input.focus();
  }

  setStatus(text, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle('err', error);
  }

  /* ---------------- API search ---------------- */

  async search() {
    const q = this.input.value.trim();
    if (q.length < 2) return this.setStatus('Digite pelo menos duas letras.', true);
    if (this.ctrl) this.ctrl.abort();
    const ctrl = (this.ctrl = new AbortController());
    this.list.innerHTML = '';
    const btn = this.form.querySelector('button');
    btn.disabled = true;
    try {
      const { results, errors } = await searchBooks(q, { signal: ctrl.signal, onStatus: (t) => this.setStatus(t) });
      if (ctrl.signal.aborted) return;
      this.results = results;
      if (!results.length) {
        const offline = errors.length && errors.length >= 2;
        this.setStatus(offline
          ? 'Não foi possível consultar as APIs agora. Verifique a conexão ou cadastre o livro à mão.'
          : 'Nenhum livro encontrado. Confira a grafia, tente só o título ou cadastre à mão.', !!offline);
        return;
      }
      const bySource = results.reduce((acc, r) => { acc[r.source] = (acc[r.source] || 0) + 1; return acc; }, {});
      const parts = Object.entries(bySource).map(([s, n]) => `${n} da ${SOURCE_LABEL[s]}`);
      this.setStatus(`${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}: ${parts.join(', ')}.`);
      this.renderResults();
    } catch (e) {
      if (e.name !== 'AbortError') this.setStatus('A busca falhou. Tente de novo em instantes.', true);
    } finally {
      btn.disabled = false;
    }
  }

  renderResults() {
    this.list.innerHTML = this.results.map((r, i) => {
      const dup = store.findDuplicate(r);
      const meta = [r.authors.join(', '), r.year, r.publisher].filter(Boolean).map(esc).join(' · ');
      return `<li class="result" data-i="${i}">
        <div class="result-cover">${r.cover || r.coverFallback ? `<img src="${esc(r.coverFallback || r.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'Sem capa'}))">` : '<span>Sem capa</span>'}</div>
        <div class="result-body">
          <p class="result-title">${esc(r.title)}${r.subtitle ? `<span style="font-weight:400"> — ${esc(r.subtitle)}</span>` : ''}</p>
          <p class="result-meta">${meta || 'Autor não informado'}</p>
          <span class="result-src">${esc(SOURCE_LABEL[r.source])}${r.isbn ? ' · ISBN ' + esc(r.isbn) : ''}${r.categories.length ? ' · ' + esc(translateCategory(r.categories)) : ''}</span>
          <div class="result-actions">
            ${dup ? '<span class="small">Já está na sua estante</span>' : '<button type="button" class="btn btn-solid" data-pick>Adicionar</button>'}
            ${r.link ? `<a class="link-btn" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">Ver na fonte</a>` : ''}
          </div>
        </div>
      </li>`;
    }).join('');
    if (!this.reduce) gsap.from(this.list.children, { opacity: 0, y: 12, duration: 0.35, stagger: 0.03, ease: 'power3.out' });
  }

  onResultClick(e) {
    const li = e.target.closest('.result');
    if (!li) return;
    const r = this.results[+li.dataset.i];
    if (e.target.closest('[data-pick]')) {
      this.list.querySelectorAll('.pick').forEach((p) => { p.closest('.result').classList.remove('is-picking'); p.remove(); });
      this.list.querySelectorAll('[data-pick]').forEach((b) => { b.hidden = false; });
      e.target.closest('[data-pick]').hidden = true;
      li.classList.add('is-picking');
      const sections = store.getState().sections;
      const suggested = suggestSection(r, sections);
      const fromApi = translateCategory(r.categories);
      li.insertAdjacentHTML('beforeend', `<div class="pick">
        <div class="field-row">
          <label class="field"><span class="field-label">Seção</span><select class="section-select" data-section>${sectionOptions(suggested)}</select></label>
          <label class="field"><span class="field-label">Status</span>
            <select data-status><option value="">Na estante</option><option value="quero">Quero ler</option><option value="lendo">Lendo</option><option value="lido">Lido</option></select>
          </label>
        </div>
        <label class="field new-section" hidden><span class="field-label">Nome da nova seção</span><input data-newsection value="${esc(fromApi)}"></label>
        <label class="field"><span class="field-label">Onde encontrar <span class="opt">(opcional)</span></span><input data-link inputmode="url" placeholder="Cole um link: Google Drive, loja, biblioteca…" autocomplete="off"></label>
        <p class="form-error" role="alert"></p>
        <button type="button" class="btn btn-solid btn-wide" data-confirm>Colocar na estante</button>
      </div>`);
      li.querySelector('[data-section]').focus();
      return;
    }
    if (e.target.closest('[data-confirm]')) this.confirm(li, r, e.target.closest('[data-confirm]'));
  }

  onSectionChange(e) {
    if (!e.target.classList.contains('section-select')) return;
    const box = e.target.closest('.pick, .manual');
    const ns = box.querySelector('.new-section');
    ns.hidden = e.target.value !== '__new';
    if (!ns.hidden) ns.querySelector('input').focus();
  }

  async confirm(li, r, btn) {
    const err = li.querySelector('.form-error');
    const sectionId = resolveSection(li.querySelector('[data-section]').value, li.querySelector('[data-newsection]').value);
    if (!sectionId) { err.textContent = 'Dê um nome para a nova seção.'; return; }
    const rawLink = li.querySelector('[data-link]').value.trim();
    const link = rawLink ? normalizeUrl(rawLink) : null;
    if (rawLink && !link) { err.textContent = 'O link não parece válido. Cole o endereço completo, como https://site.com/livro.'; return; }
    btn.disabled = true;
    btn.textContent = 'Buscando capa e sinopse…';
    let full = r;
    try { full = await completeBook(r); } catch (e) { /* keep what we have */ }
    const colors = await spineColors(full.cover);
    const book = store.addBook({
      ...full,
      ...colors,
      sectionId,
      status: li.querySelector('[data-status]').value || null,
      links: link && !parseDrive(link) ? [{ id: uid(), label: '', url: link }] : [],
      drive: link && parseDrive(link) ? { ...parseDrive(link), name: '' } : null,
      coverSource: full.cover ? (full.cover.includes('openlibrary') ? 'openlibrary' : full.cover.includes('google') ? 'google' : full.source) : null,
    });
    this.lastAdded = book.id;
    this.close();
  }

  /* ---------------- manual form ---------------- */

  async pickCover(file) {
    const err = document.getElementById('m-error');
    err.textContent = '';
    if (!file) return;
    try { this.setManualCover(await fileToCover(file)); } catch (e) { err.textContent = e.message; }
  }

  setManualCover(dataUrl) {
    this.manualCover = dataUrl;
    const pv = document.getElementById('m-preview');
    pv.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="">` : '<span>Sem capa</span>';
    document.getElementById('m-cover-clear').hidden = !dataUrl;
    if (!dataUrl) document.getElementById('m-cover').value = '';
  }

  async submitManual() {
    const f = this.manual;
    const el = f.elements;
    const err = document.getElementById('m-error');
    const title = el.title.value.trim();
    const authors = el.author.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!title) { err.textContent = 'Informe o título do livro.'; el.title.focus(); return; }
    if (!authors.length) { err.textContent = 'Informe pelo menos um autor.'; el.author.focus(); return; }
    const isbn = cleanIsbn(el.isbn.value);
    if (isbn && isbn.length !== 10 && isbn.length !== 13) { err.textContent = 'O ISBN deve ter 10 ou 13 dígitos.'; el.isbn.focus(); return; }
    const sectionId = resolveSection(el.section.value, el.newSection.value);
    if (!sectionId) { err.textContent = 'Dê um nome para a nova seção.'; el.newSection.focus(); return; }
    if (store.findDuplicate({ title, authors, isbn })) { err.textContent = 'Esse livro já está na sua estante.'; return; }
    const rawLink = el.link.value.trim();
    const link = rawLink ? normalizeUrl(rawLink) : null;
    if (rawLink && !link) { err.textContent = 'O link não parece válido. Cole o endereço completo, como https://site.com/livro.'; el.link.focus(); return; }
    err.textContent = '';
    const colors = await spineColors(this.manualCover);
    const book = store.addBook({
      title, authors, isbn,
      year: el.year.value.trim(),
      synopsis: el.synopsis.value.trim(),
      sectionId,
      status: el.status.value || null,
      cover: this.manualCover,
      coverSource: this.manualCover ? 'manual' : null,
      source: 'manual',
      links: link && !parseDrive(link) ? [{ id: uid(), label: '', url: link }] : [],
      drive: link && parseDrive(link) ? { ...parseDrive(link), name: '' } : null,
      ...colors,
    });
    this.lastAdded = book.id;
    f.reset();
    this.setManualCover(null);
    f.querySelector('.new-section').hidden = true;
    this.close();
  }
}
