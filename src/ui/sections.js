// "Organizar seções": create, rename, code, reorder and remove sections.
import { gsap } from 'gsap';
import * as store from '../lib/store.js';
import { esc } from '../lib/util.js';

const UP = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 9l4-4 4 4" stroke="currentColor" stroke-width="1.6"/></svg>';
const DOWN = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.6"/></svg>';

export class SectionsPanel {
  constructor({ reduce, onChanged }) {
    this.reduce = reduce;
    this.onChanged = onChanged;
    this.root = document.getElementById('sections-panel');
    this.panel = this.root.querySelector('.drawer');
    this.scrim = this.root.querySelector('.scrim');
    this.list = document.getElementById('sec-list');
    this.form = document.getElementById('sec-new');
    this.removing = null; // section id waiting for a destination

    this.root.querySelectorAll('[data-close-sections]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.list.addEventListener('click', (e) => this.onClick(e));
    this.list.addEventListener('change', (e) => this.onEdit(e));
    this.list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); }
    });
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.create(); });
    document.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
  }

  open() {
    this.removing = null;
    this.render();
    this.root.hidden = false;
    document.body.classList.add('locked');
    if (!this.reduce) {
      gsap.fromTo(this.scrim, { opacity: 0 }, { opacity: 1, duration: 0.3 });
      gsap.fromTo(this.panel, { xPercent: 100 }, { xPercent: 0, duration: 0.55, ease: 'expo.out' });
    }
    setTimeout(() => this.form.elements.name.focus(), this.reduce ? 0 : 200);
  }

  close() {
    if (this.root.hidden) return;
    const done = () => { this.root.hidden = true; document.body.classList.remove('locked'); };
    if (this.reduce) return done();
    gsap.to(this.scrim, { opacity: 0, duration: 0.25 });
    gsap.to(this.panel, { xPercent: 100, duration: 0.35, ease: 'power3.in', onComplete: done });
  }

  render() {
    const { sections, books } = store.getState();
    const count = (id) => books.filter((b) => b.sectionId === id).length;
    this.list.innerHTML = sections.map((s, i) => {
      const n = count(s.id);
      const removing = this.removing === s.id;
      const others = sections.filter((x) => x.id !== s.id);
      return `<li class="sec-item${removing ? ' is-removing' : ''}" data-id="${esc(s.id)}">
        <div class="sec-order">
          <button type="button" class="icon-btn sm" data-move="-1" aria-label="Subir ${esc(s.name)}"${i === 0 ? ' disabled' : ''}>${UP}</button>
          <button type="button" class="icon-btn sm" data-move="1" aria-label="Descer ${esc(s.name)}"${i === sections.length - 1 ? ' disabled' : ''}>${DOWN}</button>
        </div>
        <div class="sec-fields">
          <label class="field"><span class="sr">Nome da seção</span><input data-field="name" value="${esc(s.name)}" maxlength="40" aria-label="Nome da seção"></label>
          <label class="field code"><span class="sr">Código</span><input data-field="code" value="${esc(s.code || '')}" maxlength="8" placeholder="Código" aria-label="Código de ${esc(s.name)}"></label>
        </div>
        <div class="sec-meta">
          <span class="sec-count">${n} ${n === 1 ? 'livro' : 'livros'}</span>
          ${removing ? '' : `<button type="button" class="link-btn sec-del" data-remove${sections.length === 1 ? ' disabled' : ''}>Excluir</button>`}
        </div>
        ${removing ? `<div class="sec-remove">
            ${n ? `<label class="field"><span class="field-label">Os ${n} ${n === 1 ? 'livro vai' : 'livros vão'} para</span>
              <select data-target>${others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '<p class="small">A seção está vazia.</p>'}
            <div class="row">
              <button type="button" class="btn btn-danger" data-confirm-remove>Excluir seção</button>
              <button type="button" class="btn" data-cancel-remove>Cancelar</button>
            </div>
          </div>` : ''}
      </li>`;
    }).join('');
  }

  onClick(e) {
    const li = e.target.closest('.sec-item');
    if (!li) return;
    const id = li.dataset.id;
    const move = e.target.closest('[data-move]');
    if (move) {
      store.moveSection(id, +move.dataset.move);
      this.render();
      const again = this.list.querySelector(`.sec-item[data-id="${CSS.escape(id)}"] [data-move="${move.dataset.move}"]`);
      (again && !again.disabled ? again : this.list.querySelector(`.sec-item[data-id="${CSS.escape(id)}"] input`)).focus();
      this.onChanged();
      return;
    }
    if (e.target.closest('[data-remove]')) { this.removing = id; this.render(); this.list.querySelector('[data-confirm-remove]').focus(); return; }
    if (e.target.closest('[data-cancel-remove]')) { this.removing = null; this.render(); return; }
    if (e.target.closest('[data-confirm-remove]')) {
      const target = li.querySelector('[data-target]');
      const name = (store.getState().sections.find((s) => s.id === id) || {}).name;
      if (store.removeSection(id, target ? target.value : null)) {
        this.removing = null;
        this.render();
        this.onChanged(`Seção “${name}” excluída.`);
      }
    }
  }

  onEdit(e) {
    const input = e.target.closest('[data-field]');
    if (!input) return;
    const li = input.closest('.sec-item');
    const field = input.dataset.field;
    const value = input.value.trim();
    if (field === 'name') {
      const clash = store.getState().sections.some((s) => s.id !== li.dataset.id && s.name.toLowerCase() === value.toLowerCase());
      if (!value || clash) {
        input.value = (store.getState().sections.find((s) => s.id === li.dataset.id) || {}).name || '';
        this.onChanged(!value ? 'A seção precisa de um nome.' : 'Já existe uma seção com esse nome.');
        return;
      }
    }
    store.updateSection(li.dataset.id, { [field]: value });
    if (field === 'code') input.value = value.toUpperCase().slice(0, 8);
    this.onChanged();
  }

  create() {
    const f = this.form;
    const err = f.querySelector('.form-error');
    const name = f.elements.name.value.trim();
    if (!name) { err.textContent = 'Dê um nome para a seção.'; f.elements.name.focus(); return; }
    if (store.getState().sections.some((s) => s.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'Já existe uma seção com esse nome.'; return; }
    err.textContent = '';
    store.addSection(name, f.elements.code.value);
    f.reset();
    this.render();
    const last = this.list.lastElementChild;
    if (last && !this.reduce) gsap.from(last, { opacity: 0, y: -8, duration: 0.35, ease: 'power3.out' });
    f.elements.name.focus();
    this.onChanged(`Seção “${name}” criada.`);
  }
}
