// Likes and comments under a published review. Used in the book card and in the mural.
import * as cloud from '../lib/cloud.js';
import { esc } from '../lib/util.js';

const HEART = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14s-5.5-3.4-5.5-7.4A3 3 0 0 1 8 4.4a3 3 0 0 1 5.5 2.2C13.5 10.6 8 14 8 14z"/></svg>';
const open = new Set(); // reviews whose comments are unfolded
let names = new Map();

const ago = (iso) => {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
};

/** Placeholder; hydrate() fills it once likes and comments are loaded. */
export function socialHtml(ownerId, reviewId) {
  if (!cloud.currentProfile() || !ownerId || !reviewId) return '';
  return `<div class="social" data-social data-owner-id="${esc(ownerId)}" data-rid="${esc(reviewId)}">${inner(ownerId, reviewId)}</div>`;
}

function inner(owner, rid) {
  const s = cloud.socialFor(owner, rid);
  if (s.off) return '';
  const me = cloud.currentUser().id;
  const liked = s.likes.has(me);
  const n = s.likes.size;
  const c = s.comments.length;
  const k = owner + ':' + rid;
  const isOpen = open.has(k);
  const likers = [...s.likes].map((id) => (id === me ? 'você' : (names.get(id) || 'alguém'))).join(', ');
  return `<div class="so-bar">
      <button type="button" class="so-like${liked ? ' is-on' : ''}" data-so="like" aria-pressed="${liked}" ${n ? `title="Curtiram: ${esc(likers)}"` : ''}>${HEART}<span>${n ? n : 'Curtir'}</span></button>
      <button type="button" class="so-talk" data-so="toggle" aria-expanded="${isOpen}">${c ? `${c} ${c === 1 ? 'comentário' : 'comentários'}` : 'Comentar'}</button>
    </div>
    ${isOpen ? `<div class="so-thread">
      ${c ? `<ul class="so-comments">${s.comments.map((x) => `<li>
          <p><strong>${esc(x.user_id === me ? 'Você' : (names.get(x.user_id) || 'Leitor'))}</strong> <span class="so-when">${esc(ago(x.created_at))}</span></p>
          <p class="so-body">${esc(x.body)}</p>
          ${x.user_id === me || owner === me ? `<button type="button" class="link-btn" data-so="del" data-cid="${esc(x.id)}">Apagar</button>` : ''}
        </li>`).join('')}</ul>` : ''}
      <form class="so-form" data-so-form novalidate>
        <label class="sr" for="so-${esc(rid)}">Seu comentário</label>
        <textarea id="so-${esc(rid)}" name="body" rows="2" maxlength="1000" placeholder="Escreva um comentário…"></textarea>
        <button type="submit" class="btn btn-sm">Enviar</button>
      </form>
    </div>` : ''}`;
}

/** Loads likes and comments, then fills every placeholder inside root. */
export async function hydrate(root, { fresh = false } = {}) {
  if (!cloud.currentProfile() || !root.querySelector('[data-social]')) return;
  try {
    const [, feed] = await Promise.all([cloud.loadSocial({ fresh }), cloud.loadFeed().catch(() => null)]);
    if (feed) names = new Map(feed.people.map((p) => [p.id, p.display_name]));
  } catch (e) { return; }
  root.querySelectorAll('[data-social]').forEach((el) => { el.innerHTML = inner(el.dataset.ownerId, el.dataset.rid); });
}

function refresh(el) { el.innerHTML = inner(el.dataset.ownerId, el.dataset.rid); }

/** Wires clicks and submits for every review inside root (event delegation). */
export function bind(root, toast) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-so]');
    if (!b) return;
    const el = b.closest('[data-social]');
    if (!el) return;
    e.preventDefault();
    const owner = el.dataset.ownerId;
    const rid = el.dataset.rid;
    const k = owner + ':' + rid;
    try {
      if (b.dataset.so === 'like') {
        b.disabled = true;
        await cloud.toggleLike(owner, rid);
        refresh(el);
        el.querySelector('[data-so="like"]').focus();
      } else if (b.dataset.so === 'toggle') {
        open.has(k) ? open.delete(k) : open.add(k);
        refresh(el);
        const t = el.querySelector('textarea');
        if (t) t.focus();
      } else if (b.dataset.so === 'del') {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmar'; return; }
        await cloud.removeComment(owner, rid, b.dataset.cid);
        refresh(el);
      }
    } catch (err) {
      b.disabled = false;
      toast('Não deu agora. Confira a conexão e tente de novo.');
    }
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-so-form]');
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    const el = f.closest('[data-social]');
    const body = f.elements.body.value.trim();
    if (!body) { f.elements.body.focus(); return; }
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      await cloud.addComment(el.dataset.ownerId, el.dataset.rid, body);
      refresh(el);
      const t = el.querySelector('textarea');
      if (t) t.focus();
    } catch (err) {
      btn.disabled = false;
      toast('Não deu para comentar agora. Tente de novo.');
    }
  }, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest('[data-so-form]')) e.target.closest('form').requestSubmit();
  });
}
