// "Registro de leitores": sign in, your reader's card, and everyone else's shelves.
import { gsap } from 'gsap';
import * as cloud from '../lib/cloud.js';
import * as store from '../lib/store.js';
import { esc } from '../lib/util.js';
import { stars, when } from './bookView.js';

const nf = new Intl.NumberFormat('pt-BR');

const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days < 1) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
};

const ERR = {
  'Invalid login credentials': 'E-mail ou senha não conferem.',
  'Email not confirmed': 'Falta confirmar o e-mail. Abra o link que enviamos para a sua caixa de entrada.',
  'User already registered': 'Já existe uma conta com esse e-mail. Use “Entrar”.',
  'Password should be at least 6 characters.': 'A senha precisa ter pelo menos 6 caracteres.',
};
function message(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (ERR[m]) return ERR[m];
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  if (/password/i.test(m) && /weak|short|least/i.test(m)) return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.';
  return m;
}

export class Readers {
  constructor({ reduce, toast, onVisit, onLeave, openBook }) {
    this.openBook = openBook;
    this.homeTab = 'mural';
    this.reduce = reduce;
    this.toast = toast;
    this.onVisit = onVisit;
    this.onLeave = onLeave;
    this.root = document.getElementById('readers');
    this.sheet = this.root.querySelector('.readers-sheet');
    this.body = document.getElementById('readers-body');
    this.chip = document.getElementById('open-readers');
    this.mode = 'signin'; // signin | signup | reset | sent
    this.sentTo = '';
    this.people = null;
    this.peopleError = null;
    this.pendingVisit = null;

    this.chip.addEventListener('click', () => this.open());
    this.root.querySelectorAll('[data-close-readers]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.body.addEventListener('submit', (e) => { e.preventDefault(); this.onSubmit(e.target); });
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('change', (e) => {
      if (!e.target.matches('[data-share]')) return;
      store.setSettings({ shareReading: e.target.checked });
      this.toast(e.target.checked ? 'Os leitores da casa veem o que você está lendo.' : 'Seu status e página agora ficam só com você.');
    });
    document.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    document.getElementById('visit-leave').addEventListener('click', () => this.leave());

    cloud.onChange(({ event }) => {
      this.renderChip();
      if (event === 'signed-in' || event === 'signed-out' || event === 'profile') {
        this.people = null;
        if (!this.root.hidden) this.render();
        if (event === 'signed-in' && cloud.isRecovering()) this.open();
        if (event === 'signed-out' && store.isReadOnly()) this.leave();
      }
      if (event === 'sync' && !this.root.hidden) this.renderSync();
      if ((event === 'sync' && cloud.syncStatus().state === 'saved') || event === 'profile') this.tryPendingVisit();
    });
    window.addEventListener('hashchange', () => this.fromHash());
    this.renderChip();
    this.fromHash();
  }

  /* ---------------- header chip ---------------- */
  renderChip() {
    const p = cloud.currentProfile();
    const u = cloud.currentUser();
    if (p) {
      this.chip.innerHTML = `<span class="mono" aria-hidden="true">${esc(initial(p.display_name))}</span><span class="chip-name">${esc(p.display_name.split(' ')[0])}</span>`;
      this.chip.setAttribute('aria-label', `Leitores. Você entrou como ${p.display_name}`);
    } else {
      this.chip.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="5.5" r="2.8" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 14c.8-2.8 3-4.2 5.5-4.2s4.7 1.4 5.5 4.2" stroke="currentColor" stroke-width="1.5"/></svg><span class="chip-name">${u ? 'Completar ficha' : 'Leitores'}</span>`;
      this.chip.setAttribute('aria-label', u ? 'Leitores: complete sua ficha' : 'Leitores: entrar ou criar conta');
    }
  }

  /* ---------------- open / close ---------------- */
  open() {
    this.render();
    this.root.hidden = false;
    document.body.classList.add('locked');
    if (!this.reduce) {
      gsap.fromTo(this.root.querySelector('.scrim'), { opacity: 0 }, { opacity: 1, duration: 0.3 });
      gsap.fromTo(this.sheet, { yPercent: -6, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.55, ease: 'expo.out' });
    }
    setTimeout(() => (this.body.querySelector('input') || this.root.querySelector('.readers-close')).focus(), this.reduce ? 0 : 150);
  }

  close() {
    if (this.root.hidden) return;
    const done = () => { this.root.hidden = true; document.body.classList.remove('locked'); this.chip.focus(); };
    if (this.reduce) return done();
    gsap.to(this.sheet, { yPercent: -4, opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: done });
    gsap.to(this.root.querySelector('.scrim'), { opacity: 0, duration: 0.25 });
  }

  /* ---------------- views ---------------- */
  render() {
    const u = cloud.currentUser();
    const p = cloud.currentProfile();
    if (u && cloud.isRecovering()) this.body.innerHTML = this.recoverHtml();
    else if (!u) this.body.innerHTML = this.authHtml();
    else if (!p) this.body.innerHTML = this.setupHtml(u);
    else {
      this.body.innerHTML = this.homeHtml(p);
      this.loadPeople();
      this.loadMural();
    }
  }

  authHtml() {
    if (this.mode === 'sent') {
      return `<div class="rd-col rd-note-card">
        <h3 class="serif">Confira seu e-mail</h3>
        <p>Enviamos um link para <strong>${esc(this.sentTo)}</strong>. Abra o link neste aparelho para entrar. Se não chegar em alguns minutos, olhe a caixa de spam.</p>
        <button type="button" class="btn" data-mode="signin">Voltar para entrar</button>
      </div>`;
    }
    const tabs = `<div class="seg" role="tablist" aria-label="Conta">
        <button type="button" role="tab" class="seg-btn${this.mode === 'signin' ? ' is-on' : ''}" aria-selected="${this.mode === 'signin'}" data-mode="signin">Entrar</button>
        <button type="button" role="tab" class="seg-btn${this.mode === 'signup' ? ' is-on' : ''}" aria-selected="${this.mode === 'signup'}" data-mode="signup">Criar conta</button>
      </div>`;
    const pending = this.pendingVisit ? `<p class="rd-callout">Entre para ver a estante de <strong>@${esc(this.pendingVisit)}</strong>.</p>` : '';
    let form;
    if (this.mode === 'reset') {
      form = `<form class="rd-form" data-form="reset" novalidate>
        <p class="small">Mandamos um link para você criar uma senha nova.</p>
        <label class="field"><span class="field-label">E-mail</span><input name="email" type="email" autocomplete="email" required></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-solid btn-wide">Enviar link</button>
        <button type="button" class="link-btn" data-mode="signin">Voltar</button>
      </form>`;
    } else if (this.mode === 'signup') {
      form = `<form class="rd-form" data-form="signup" novalidate>
        <label class="field"><span class="field-label">Seu nome</span><input name="display_name" maxlength="40" autocomplete="name" required></label>
        <label class="field"><span class="field-label">@usuário</span><span class="at-input"><span aria-hidden="true">@</span><input name="username" maxlength="20" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="ana_lima" required></span><span class="hint-line">Letras minúsculas, números e _. É o endereço da sua estante.</span></label>
        <label class="field"><span class="field-label">E-mail</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span class="field-label">Senha</span><input name="password" type="password" autocomplete="new-password" minlength="8" required><span class="hint-line">Pelo menos 8 caracteres.</span></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-solid btn-wide">Criar minha conta</button>
        <p class="small">Os livros que já estão neste navegador vão para a sua conta.</p>
      </form>`;
    } else {
      form = `<form class="rd-form" data-form="signin" novalidate>
        <label class="field"><span class="field-label">E-mail</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span class="field-label">Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-solid btn-wide">Entrar</button>
        <button type="button" class="link-btn" data-mode="reset">Esqueci a senha</button>
      </form>`;
    }
    return `<div class="rd-split">
      <div class="rd-col rd-intro">
        <p class="rd-kicker">Biblioteca circulante</p>
        <h3 class="serif">Cada leitor com a sua estante, e todas abertas para visita.</h3>
        <ul class="rd-points">
          <li>Sua estante fica salva na conta e aparece em qualquer aparelho.</li>
          <li>Amigos com conta podem visitar o seu acervo, só para ver.</li>
          <li>Seus links, o arquivo do Drive e o status de leitura ficam só com você.</li>
        </ul>
      </div>
      <div class="rd-col">${pending}${this.mode === 'reset' ? '' : tabs}${form}</div>
    </div>`;
  }

  recoverHtml() {
    return `<div class="rd-col rd-note-card">
      <h3 class="serif">Crie uma senha nova</h3>
      <form class="rd-form" data-form="recover" novalidate>
        <label class="field"><span class="field-label">Senha nova</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-solid btn-wide">Salvar senha</button>
      </form>
    </div>`;
  }

  setupHtml(u) {
    const m = u.user_metadata || {};
    return `<div class="rd-col rd-note-card">
      <p class="rd-kicker">Ficha de leitor</p>
      <h3 class="serif">Como os amigos vão te encontrar?</h3>
      <form class="rd-form" data-form="profile" novalidate>
        <label class="field"><span class="field-label">Seu nome</span><input name="display_name" maxlength="40" value="${esc(m.display_name || '')}" required></label>
        <label class="field"><span class="field-label">@usuário</span><span class="at-input"><span aria-hidden="true">@</span><input name="username" maxlength="20" autocapitalize="none" spellcheck="false" value="${esc(m.username || '')}" required></span><span class="hint-line">Letras minúsculas, números e _.</span></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-solid btn-wide">Abrir minha ficha</button>
      </form>
      <button type="button" class="link-btn" data-act="signout">Sair da conta</button>
    </div>`;
  }

  homeHtml(p) {
    const n = store.isReadOnly() ? '' : store.getState().books.length;
    return `<div class="rd-home">
      <article class="reader-card is-me" aria-label="Sua ficha de leitor">
        <span class="mono lg" aria-hidden="true">${esc(initial(p.display_name))}</span>
        <div class="rc-main">
          <p class="rd-kicker">Sua ficha</p>
          <h3 class="serif">${esc(p.display_name)}</h3>
          <p class="rc-user">@${esc(p.username)}${n !== '' ? ` · ${n} ${n === 1 ? 'volume' : 'volumes'}` : ''}</p>
          <p class="rc-sync" data-sync></p>
        </div>
        <label class="check rc-share"><input type="checkbox" data-share ${store.settings().shareReading ? 'checked' : ''}${store.isReadOnly() ? ' disabled' : ''}><span>Mostrar aos leitores o que estou lendo, o que já li e em que página estou</span></label>
        <div class="rc-actions">
          <button type="button" class="btn" data-act="copy">Copiar link da minha estante</button>
          <button type="button" class="link-btn" data-act="signout">Sair</button>
        </div>
      </article>
      <div class="seg rd-tabs" role="tablist" aria-label="Registro">
        <button type="button" role="tab" class="seg-btn${this.homeTab === 'mural' ? ' is-on' : ''}" aria-selected="${this.homeTab === 'mural'}" data-home-tab="mural">Mural de leituras</button>
        <button type="button" role="tab" class="seg-btn${this.homeTab === 'people' ? ' is-on' : ''}" aria-selected="${this.homeTab === 'people'}" data-home-tab="people">Leitores da casa</button>
      </div>
      <div data-home-panel="mural"${this.homeTab === 'mural' ? '' : ' hidden'}><div class="mural" data-mural aria-live="polite"><p class="rd-loading">Abrindo o mural…</p></div></div>
      <div data-home-panel="people"${this.homeTab === 'people' ? '' : ' hidden'}><ol class="reader-list" data-people aria-live="polite"><li class="rd-loading">Abrindo o registro…</li></ol></div>
    </div>`;
  }

  renderSync() {
    const el = this.body.querySelector('[data-sync]');
    if (!el) return;
    const s = cloud.syncStatus();
    const t = {
      idle: '', loading: 'Trazendo sua estante da conta…', pending: 'Alterações a salvar…', saving: 'Salvando na conta…',
      saved: s.at ? `Estante salva na conta às ${s.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : 'Estante salva na conta.',
      error: 'Não deu para salvar na conta agora. Seus livros continuam neste navegador e tentamos de novo na próxima mudança.',
    }[s.state];
    el.textContent = t || '';
    el.classList.toggle('is-error', s.state === 'error');
  }

  async loadPeople() {
    this.renderSync();
    const list = this.body.querySelector('[data-people]');
    if (!this.people) {
      try {
        this.people = await cloud.listReaders();
        this.peopleError = null;
      } catch (e) {
        this.peopleError = message(e);
      }
    }
    if (!list.isConnected) return;
    if (this.peopleError) { list.innerHTML = `<li class="rd-loading">Não deu para abrir o registro: ${esc(this.peopleError)}</li>`; return; }
    const me = cloud.currentUser().id;
    const others = this.people.filter((x) => x.id !== me);
    if (!others.length) {
      list.innerHTML = `<li class="rd-empty"><p class="serif">Por enquanto só você.</p><p class="small">Mande o link do site para os amigos criarem a conta. Eles aparecem aqui assim que abrirem a ficha.</p></li>`;
      return;
    }
    const visiting = store.visiting();
    list.innerHTML = others.map((x) => {
      const sum = (x.shelf && x.shelf.summary) || null;
      const covers = (sum && sum.covers) || [];
      return `<li><button type="button" class="reader-card${visiting && visiting.id === x.id ? ' is-on' : ''}" data-visit="${esc(x.username)}">
        <span class="mono" aria-hidden="true">${esc(initial(x.display_name))}</span>
        <span class="rc-main">
          <span class="rc-name serif">${esc(x.display_name)}</span>
          <span class="rc-user">@${esc(x.username)}</span>
          <span class="rc-meta">${sum ? `${sum.count} ${sum.count === 1 ? 'volume' : 'volumes'} · ${sum.sections} ${sum.sections === 1 ? 'seção' : 'seções'} · atualizada ${fmtDate(x.shelf.updated_at)}` : 'Estante ainda vazia'}</span>
        </span>
        <span class="rc-covers" aria-hidden="true">${covers.map((c) => `<img src="${esc(c)}" alt="" loading="lazy" referrerpolicy="no-referrer">`).join('')}</span>
        <span class="rc-go">Visitar</span>
      </button></li>`;
    }).join('');
    if (!this.reduce) gsap.from(list.children, { opacity: 0, y: 10, duration: 0.4, ease: 'power3.out', stagger: 0.04 });
  }

  async loadMural({ fresh = false } = {}) {
    const box = this.body.querySelector('[data-mural]');
    if (!box) return;
    let feed;
    try {
      if (!fresh) await cloud.pushNow();
      feed = await cloud.loadFeed({ fresh: true });
    } catch (e) {
      box.innerHTML = `<p class="rd-loading">Não deu para abrir o mural: ${esc(message(e))}</p>`;
      return;
    }
    if (!box.isConnected) return;
    const me = cloud.currentProfile();
    const name = (w) => (w.id === me.id ? 'Você' : w.display_name);
    const thumb = (r) => r.cover
      ? `<img class="mu-cover" src="${esc(r.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="mu-cover drawn" style="background:${esc(r.color || '#6b4a2b')};color:${esc(r.ink || '#f3ead8')}" aria-hidden="true">${esc(String(r.title || '').slice(0, 18))}</span>`;
    const reading = feed.reading.slice(0, 12).map((r) => {
      const pct = r.total ? Math.min(100, Math.round((r.page / r.total) * 100)) : 0;
      return `<li><button type="button" class="mu-reading" data-open-book="${esc(r.bookId)}" data-owner="${esc(r.who.username)}">
        ${thumb(r)}
        <span class="mu-body"><span class="mu-who">${esc(name(r.who))}</span><span class="mu-title serif">${esc(r.title)}</span>
        <span class="mu-meta">${r.page ? `pág. ${nf.format(r.page)}${r.total ? ` de ${nf.format(r.total)}` : ''}` : 'começou a ler'}</span>
        ${r.total ? `<span class="bm-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ''}</span>
      </button></li>`;
    }).join('');
    const reviews = feed.reviews.slice(0, 40).map((r) => `<li class="mu-review">
      <button type="button" class="mu-book" data-open-book="${esc(r.bookId)}" data-owner="${esc(r.who.username)}" aria-label="Abrir ${esc(r.title)}">${thumb(r)}</button>
      <div class="mu-body">
        <p class="mu-line"><span class="mono sm" aria-hidden="true">${esc(initial(r.who.display_name))}</span><strong>${esc(name(r.who))}</strong> ${r.kind === 'link' ? 'indicou uma resenha de' : 'escreveu sobre'} <button type="button" class="mu-link serif" data-open-book="${esc(r.bookId)}" data-owner="${esc(r.who.username)}">${esc(r.title)}</button><span class="mu-meta"> · ${esc((r.authors || [])[0] || '')} · ${esc(when(r.at))}</span></p>
        ${r.kind !== 'link' && r.rating ? stars(r.rating) : ''}
        ${r.text ? `<p class="rv-text">${esc(r.text)}</p>` : ''}
        ${r.url ? `<a class="ext rv-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source || r.url)}</a>` : ''}
      </div>
    </li>`).join('');
    box.innerHTML = `
      <h3 class="rd-h">Lendo agora</h3>
      ${reading ? `<ol class="mu-reading-list">${reading}</ol>` : '<p class="rd-empty-line">Ninguém marcou um livro como “Lendo” ainda. Na ficha do livro, marque Lendo e registre a página.</p>'}
      <h3 class="rd-h">Resenhas publicadas</h3>
      ${reviews ? `<ol class="mu-reviews">${reviews}</ol>` : '<p class="rd-empty-line">Nenhuma resenha publicada ainda. Abra um livro, vá em Resenhas e publique a primeira.</p>'}`;
    if (!this.reduce) gsap.from(box.querySelectorAll('li'), { opacity: 0, y: 10, duration: 0.4, ease: 'power3.out', stagger: 0.03 });
  }

  async openFromMural(owner, bookId) {
    const me = cloud.currentProfile();
    if (me && owner === me.username) {
      if (store.isReadOnly()) this.leave();
    } else {
      const v = store.visiting();
      if (!v || v.username !== owner) await this.visit(owner);
      if (!store.visiting() || store.visiting().username !== owner) return;
    }
    this.close();
    setTimeout(() => this.openBook(bookId), this.reduce ? 0 : 320);
  }

  /* ---------------- actions ---------------- */
  async onSubmit(form) {
    const kind = form.dataset.form;
    if (!kind) return;
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('[type="submit"]');
    const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
    err.textContent = '';
    const check = () => {
      if (form.elements.display_name && !v('display_name')) return 'Diga seu nome.';
      if (form.elements.username && !cloud.USERNAME_RE.test(v('username').toLowerCase())) return 'O @usuário deve ter de 3 a 20 letras minúsculas, números ou _.';
      if (form.elements.email && !/^\S+@\S+\.\S+$/.test(v('email'))) return 'Confira o e-mail.';
      if (form.elements.password && kind !== 'signin' && form.elements.password.value.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
      if (form.elements.password && !form.elements.password.value) return 'Digite a senha.';
      return '';
    };
    const problem = check();
    if (problem) { err.textContent = problem; return; }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Um momento…';
    try {
      if (kind === 'signin') {
        await cloud.signIn(v('email'), form.elements.password.value);
        this.toast('Bem-vindo de volta.');
      } else if (kind === 'signup') {
        const r = await cloud.signUp(v('email'), form.elements.password.value, { username: v('username').toLowerCase(), display_name: v('display_name') });
        if (r.needsConfirm) { this.mode = 'sent'; this.sentTo = v('email'); this.render(); return; }
        this.toast('Conta criada. Sua estante agora fica salva na conta.');
      } else if (kind === 'reset') {
        await cloud.sendReset(v('email'));
        this.mode = 'sent'; this.sentTo = v('email'); this.render(); return;
      } else if (kind === 'recover') {
        await cloud.setPassword(form.elements.password.value);
        location.hash = '';
        window.location.reload();
        return;
      } else if (kind === 'profile') {
        await cloud.saveProfile({ username: v('username').toLowerCase(), display_name: v('display_name') });
        this.toast('Ficha aberta. Sua estante já está na conta.');
        this.render();
        return;
      }
    } catch (e) {
      err.textContent = message(e);
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  }

  onClick(e) {
    const mode = e.target.closest('[data-mode]');
    if (mode) { this.mode = mode.dataset.mode; this.render(); const i = this.body.querySelector('input'); if (i) i.focus(); return; }
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'signout') { this.signOut(); return; }
    if (act && act.dataset.act === 'copy') { this.copyLink(act); return; }
    const ht = e.target.closest('[data-home-tab]');
    if (ht) {
      this.homeTab = ht.dataset.homeTab;
      this.body.querySelectorAll('[data-home-tab]').forEach((b) => { const on = b === ht; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); });
      this.body.querySelectorAll('[data-home-panel]').forEach((p) => { p.hidden = p.dataset.homePanel !== this.homeTab; });
      return;
    }
    const ob = e.target.closest('[data-open-book]');
    if (ob) { this.openFromMural(ob.dataset.owner, ob.dataset.openBook); return; }
    const visit = e.target.closest('[data-visit]');
    if (visit) this.visit(visit.dataset.visit);
  }

  async signOut() {
    await cloud.signOut();
    this.mode = 'signin';
    this.toast('Você saiu. Este navegador voltou para o acervo inicial.');
    this.render();
  }

  async copyLink(btn) {
    const p = cloud.currentProfile();
    const url = `${location.origin}${location.pathname}#@${p.username}`;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Link copiado';
    } catch (e) {
      btn.textContent = url;
    }
    setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copiar link da minha estante'; }, 2500);
  }

  /* ---------------- visiting ---------------- */
  fromHash() {
    const m = location.hash.match(/^#@([a-z0-9_]{3,20})$/i);
    if (!m) { if (store.isReadOnly()) this.leave({ fromHash: true }); return; }
    const name = m[1].toLowerCase();
    const p = cloud.currentProfile();
    if (p && p.username === name) { if (store.isReadOnly()) this.leave({ fromHash: true }); return; }
    this.pendingVisit = name;
    this.tryPendingVisit();
  }

  tryPendingVisit() {
    if (!this.pendingVisit) return;
    if (!cloud.currentUser()) {
      // Wait for the session to restore before asking to sign in.
      clearTimeout(this.askT);
      this.askT = setTimeout(() => { if (!cloud.currentUser() && this.pendingVisit) this.open(); }, 1500);
      return;
    }
    if (!cloud.currentProfile()) return;
    const s = cloud.syncStatus().state;
    if (s === 'loading') return;
    const name = this.pendingVisit;
    this.pendingVisit = null;
    this.visit(name);
  }

  async visit(username) {
    const me = cloud.currentProfile();
    if (me && me.username === username) { this.leave(); this.close(); return; }
    try {
      await cloud.pushNow();
      const shelf = await cloud.loadShelf(username);
      if (!shelf) { this.toast(`Não achei a estante de @${username}.`); return; }
      if (!shelf.data || !shelf.data.books || !shelf.data.books.length) { this.toast(`${shelf.profile.display_name} ainda não tem livros na estante.`); return; }
      store.startVisit(shelf.profile, shelf.data);
      if (location.hash !== `#@${username}`) history.replaceState(null, '', `#@${username}`);
      this.onVisit(shelf.profile);
      this.close();
    } catch (e) {
      this.toast(message(e));
    }
  }

  leave({ fromHash = false } = {}) {
    if (!store.isReadOnly()) return;
    store.endVisit();
    if (!fromHash && location.hash) history.replaceState(null, '', location.pathname + location.search);
    this.onLeave();
  }
}
