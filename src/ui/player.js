// The listening room: one audiobook player for the whole site, docked at the bottom of the
// page so the story keeps playing while the reader walks around the shelves.
import { gsap } from 'gsap';
import { esc, normalizeUrl, parseDrive } from '../lib/util.js';

const SPEEDS = [0.8, 1, 1.15, 1.25, 1.5, 1.75, 2];
const POS_PREFIX = 'estante:ouvindo:';

const fmt = (s) => {
  if (!isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/**
 * Turns what the reader pasted into something an <audio> element can play.
 * Google Drive files stream through Drive's download address; folders and very large
 * files can only be opened in Drive's own player (`drive` is kept for that fallback).
 */
export function playable(url) {
  const d = parseDrive(url);
  if (d) {
    if (d.kind === 'file') return { src: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(d.id)}`, drive: d };
    return { src: null, drive: d };
  }
  const n = normalizeUrl(url);
  return n ? { src: n, drive: null } : null;
}

/** Splits pasted lines ("Capítulo 1 | https://…" or just the link) into tracks. */
export function parseTracks(text) {
  return String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line, i) => {
    const m = line.match(/^(.*?)[\s|;—–-]*\s(https?:\/\/\S+|drive\.google\.com\/\S+|docs\.google\.com\/\S+)$/i);
    const url = m ? m[2] : line;
    const title = m && m[1].trim() ? m[1].trim().replace(/[|;:—–-]+$/, '').trim() : '';
    const p = playable(url);
    return p ? { title: title || `Parte ${i + 1}`, url: normalizeUrl(url) || url } : null;
  }).filter(Boolean).slice(0, 200);
}

const DISC = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49" fill="#111"/><g fill="none" stroke="#2a2a2a" stroke-width=".8"><circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="36"/><circle cx="50" cy="50" r="32"/><circle cx="50" cy="50" r="28"/></g><path d="M18 30a38 38 0 0 1 22-14" stroke="rgba(255,255,255,.18)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';

export class Player {
  constructor({ reduce, toast, openDrive }) {
    this.reduce = reduce;
    this.toast = toast;
    this.openDrive = openDrive;
    this.root = document.getElementById('player');
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.item = null; // { key, title, author, cover, color, tracks, onSave, startAt }
    this.index = 0;
    this.speed = 1;
    this.lastSave = 0;

    this.audio.addEventListener('timeupdate', () => this.tick());
    this.audio.addEventListener('loadedmetadata', () => this.tick());
    this.audio.addEventListener('play', () => this.setPlaying(true));
    this.audio.addEventListener('pause', () => { this.setPlaying(false); this.save(true); });
    this.audio.addEventListener('ended', () => this.next(true));
    this.audio.addEventListener('error', () => this.failed());
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => {
      if (e.target.matches('[data-seek]') && isFinite(this.audio.duration)) {
        this.audio.currentTime = (+e.target.value / 1000) * this.audio.duration;
      }
    });
    this.root.addEventListener('change', (e) => {
      if (e.target.matches('[data-track-select]')) this.go(+e.target.value, 0, true);
    });
    window.addEventListener('pagehide', () => this.save(true));
    document.addEventListener('keydown', (e) => {
      if (!this.item || e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'k' || (e.key === ' ' && e.target === document.body)) { e.preventDefault(); this.toggle(); }
    });
  }

  get playing() { return !this.audio.paused; }
  isCurrent(key) { return !!this.item && this.item.key === key; }

  /** Starts (or resumes) an audiobook. */
  load(item, { autoplay = true, index = null } = {}) {
    if (!item || !item.tracks || !item.tracks.length) return;
    const same = this.isCurrent(item.key);
    if (same && index === null) { if (autoplay) this.audio.play().catch(() => {}); return; }
    this.save(true);
    this.item = item;
    const saved = index !== null ? { i: index, t: 0 } : (item.startAt || this.storedPos(item.key) || { i: 0, t: 0 });
    this.render();
    this.show();
    this.go(Math.min(saved.i || 0, item.tracks.length - 1), saved.t || 0, autoplay);
  }

  go(i, t = 0, autoplay = true) {
    const track = this.item.tracks[i];
    if (!track) return;
    this.index = i;
    const p = playable(track.url);
    this.renderTrack();
    if (!p || !p.src) {
      // A Drive folder or an item Drive won't stream: use Drive's own player.
      this.audio.removeAttribute('src');
      this.setPlaying(false);
      if (p && p.drive) this.openDrive(p.drive, `${this.item.title} · ${track.title}`);
      return;
    }
    this.audio.src = p.src;
    this.audio.playbackRate = this.speed;
    const start = () => {
      if (t > 0 && isFinite(this.audio.duration)) this.audio.currentTime = Math.min(t, this.audio.duration - 2);
      if (autoplay) this.audio.play().catch(() => this.setPlaying(false));
    };
    this.audio.addEventListener('loadedmetadata', start, { once: true });
    this.audio.load();
    this.mediaSession();
  }

  failed() {
    if (!this.item || !this.audio.getAttribute('src')) return;
    const track = this.item.tracks[this.index];
    const p = track && playable(track.url);
    this.setPlaying(false);
    if (p && p.drive) {
      this.toast('O Drive não deixou tocar este arquivo aqui (arquivo grande ou não compartilhado). Abrimos o player do Drive.');
      this.openDrive(p.drive, `${this.item.title} · ${track.title}`);
    } else {
      this.toast('Não deu para tocar este áudio. Confira se o link é de um arquivo de áudio público.');
    }
  }

  toggle() {
    if (!this.item) return;
    if (this.playing) this.audio.pause();
    else if (!this.audio.getAttribute('src')) this.go(this.index, 0, true);
    else this.audio.play().catch(() => {});
  }

  next(auto = false) {
    if (!this.item) return;
    if (this.index < this.item.tracks.length - 1) this.go(this.index + 1, 0, true);
    else if (auto) { this.setPlaying(false); this.save(true, { done: true }); this.toast(`Fim de “${this.item.title}”.`); }
  }

  prev() {
    if (!this.item) return;
    if (this.audio.currentTime > 5 || this.index === 0) this.audio.currentTime = 0;
    else this.go(this.index - 1, 0, true);
  }

  skip(s) { if (this.item && isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + s)); }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length];
    this.audio.playbackRate = this.speed;
    const b = this.root.querySelector('[data-pl="speed"]');
    if (b) b.textContent = `${String(this.speed).replace('.', ',')}×`;
  }

  close() {
    this.save(true);
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.item = null;
    const done = () => { this.root.hidden = true; document.body.classList.remove('has-player'); };
    if (this.reduce) done();
    else gsap.to(this.root, { y: 120, opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: done });
    document.dispatchEvent(new CustomEvent('player:change'));
  }

  /* ---------------- position ---------------- */

  storedPos(key) {
    try { return JSON.parse(localStorage.getItem(POS_PREFIX + key) || 'null'); } catch (e) { return null; }
  }

  save(force = false, extra = {}) {
    if (!this.item) return;
    const now = Date.now();
    if (!force && now - this.lastSave < 30000) return;
    this.lastSave = now;
    const pos = { i: this.index, t: Math.floor(this.audio.currentTime || 0), at: new Date().toISOString(), ...extra };
    try { localStorage.setItem(POS_PREFIX + this.item.key, JSON.stringify(pos)); } catch (e) { /* storage off */ }
    if (this.item.onSave) this.item.onSave(pos);
  }

  /* ---------------- view ---------------- */

  show() {
    if (!this.root.hidden) return;
    this.root.hidden = false;
    document.body.classList.add('has-player');
    if (!this.reduce) gsap.fromTo(this.root, { y: 120, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' });
  }

  render() {
    const it = this.item;
    const label = it.cover
      ? `<img src="${esc(it.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
      : '';
    this.root.innerHTML = `
      <div class="pl-disc${this.playing ? ' is-spinning' : ''}" aria-hidden="true">${DISC}<span class="pl-label" style="background:${esc(it.color || '#7a2e22')}">${label}</span></div>
      <div class="pl-main">
        <p class="pl-kicker">Ouvindo${it.who ? ` · de ${esc(it.who)}` : ''}</p>
        <p class="pl-title serif">${esc(it.title)}</p>
        <div class="pl-track-row">${it.tracks.length > 1
          ? `<label class="sr" for="pl-track">Capítulo</label><select id="pl-track" data-track-select>${it.tracks.map((t, i) => `<option value="${i}">${esc(t.title)}</option>`).join('')}</select>`
          : `<span class="pl-track">${esc(it.tracks[0].title)}</span>`}</div>
        <div class="pl-seek"><span data-cur>0:00</span><input type="range" min="0" max="1000" value="0" data-seek aria-label="Posição no capítulo"><span data-dur>0:00</span></div>
      </div>
      <div class="pl-controls">
        <button type="button" class="pl-btn" data-pl="prev" aria-label="Capítulo anterior"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4v12M16 4L7 10l9 6z"/></svg></button>
        <button type="button" class="pl-btn" data-pl="back" aria-label="Voltar 30 segundos"><span>−30</span></button>
        <button type="button" class="pl-btn pl-play" data-pl="toggle" aria-label="Tocar"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l11 6-11 6z"/></svg></button>
        <button type="button" class="pl-btn" data-pl="fwd" aria-label="Avançar 30 segundos"><span>+30</span></button>
        <button type="button" class="pl-btn" data-pl="next" aria-label="Próximo capítulo"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 4v12M4 4l9 6-9 6z"/></svg></button>
        <button type="button" class="pl-btn pl-speed" data-pl="speed" aria-label="Velocidade">${String(this.speed).replace('.', ',')}×</button>
        <button type="button" class="pl-btn pl-close" data-pl="close" aria-label="Fechar o player"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
      </div>`;
    document.dispatchEvent(new CustomEvent('player:change'));
  }

  renderTrack() {
    const sel = this.root.querySelector('[data-track-select]');
    if (sel) sel.value = String(this.index);
  }

  setPlaying(on) {
    this.root.querySelector('.pl-disc')?.classList.toggle('is-spinning', on);
    const b = this.root.querySelector('[data-pl="toggle"]');
    if (b) {
      b.setAttribute('aria-label', on ? 'Pausar' : 'Tocar');
      b.innerHTML = on ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l11 6-11 6z"/></svg>';
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
    document.dispatchEvent(new CustomEvent('player:change'));
  }

  tick() {
    const a = this.audio;
    const cur = this.root.querySelector('[data-cur]');
    if (!cur) return;
    cur.textContent = fmt(a.currentTime);
    this.root.querySelector('[data-dur]').textContent = fmt(a.duration);
    const seek = this.root.querySelector('[data-seek]');
    if (seek && document.activeElement !== seek && isFinite(a.duration)) seek.value = String(Math.round((a.currentTime / a.duration) * 1000) || 0);
    this.save();
  }

  onClick(e) {
    const b = e.target.closest('[data-pl]');
    if (!b) return;
    const act = b.dataset.pl;
    if (act === 'toggle') this.toggle();
    else if (act === 'prev') this.prev();
    else if (act === 'next') this.next();
    else if (act === 'back') this.skip(-30);
    else if (act === 'fwd') this.skip(30);
    else if (act === 'speed') this.cycleSpeed();
    else if (act === 'close') this.close();
  }

  mediaSession() {
    if (!('mediaSession' in navigator) || !this.item) return;
    const it = this.item;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${it.title} · ${it.tracks[this.index].title}`,
        artist: it.author || '',
        album: 'Estante',
        artwork: it.cover && !String(it.cover).startsWith('data:') ? [{ src: it.cover, sizes: '512x512' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => this.audio.play());
      navigator.mediaSession.setActionHandler('pause', () => this.audio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => this.skip(-30));
      navigator.mediaSession.setActionHandler('seekforward', () => this.skip(30));
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    } catch (e) { /* older browsers */ }
  }
}
