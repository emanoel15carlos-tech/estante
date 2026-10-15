import './styles.css';
import './compare.css';
import { getState } from './lib/store.js';
import { openLibraryDescription, probeImage, searchGoogle, searchOpenLibrary } from './lib/apis.js';
import { cleanIsbn, esc, isIsbn, norm } from './lib/util.js';

const $form = document.getElementById('batch-form');
const $titles = document.getElementById('titles');
const $status = document.getElementById('cmp-status');
const $rows = document.getElementById('rows');
const $score = document.getElementById('score');
const $tableBox = document.getElementById('table-box');
const $run = document.getElementById('run');
const $deep = document.getElementById('deep');

const MAX = 40;
const YES = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M4 9.5l3.2 3L14 5.5" stroke="currentColor" stroke-width="2"/></svg><span class="sr">sim</span>';
const NO = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" stroke-width="1.6"/></svg><span class="sr">não</span>';
const ERR = '<span class="cell-err">erro</span>';

let running = null;

function parse(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX).map((line) => {
    if (isIsbn(line)) return { line, isbn: cleanIsbn(line), title: '', author: '' };
    const [title, author = ''] = line.split(/\s+[—–-]\s+|;/).map((s) => s.trim());
    return { line, isbn: '', title, author };
  });
}

function titleMatches(result, wanted) {
  if (!wanted.title) return true; // ISBN search: the API already matched it
  const a = norm(result.title), b = norm(wanted.title);
  return a.includes(b) || b.includes(a);
}

async function check(source, item, deep, signal) {
  const query = item.isbn
    ? item.isbn
    : source === 'google'
      ? `intitle:${item.title}${item.author ? ` inauthor:${item.author}` : ''}`
      : `${item.title} ${item.author}`.trim();
  const list = source === 'google'
    ? await searchGoogle(query, { signal, limit: 8 })
    : await searchOpenLibrary(query, { signal, limit: 8 });
  const match = list.find((r) => titleMatches(r, item)) || null;
  const pt = list.some((r) => r.language === 'pt' || r.language === 'por');
  if (!match) return { found: false, cover: false, synopsis: false, pt, title: '' };
  let cover = !!(match.cover || match.coverFallback);
  let synopsis = !!match.synopsis;
  if (deep) {
    if (cover) cover = (await probeImage(match.coverFallback || match.cover)) || (await probeImage(match.cover));
    if (!cover && source === 'openlibrary') {
      // Another result of the same work may carry the cover.
      const other = list.find((r) => r !== match && titleMatches(r, item) && r.cover);
      if (other) cover = await probeImage(other.cover);
    }
    if (source === 'openlibrary' && !synopsis) synopsis = !!(await openLibraryDescription(match.sourceId, { signal }).catch(() => ''));
  }
  return { found: true, cover, synopsis, pt, title: match.title + (match.authors[0] ? ' — ' + match.authors[0] : '') };
}

function cells(r, deep, source) {
  if (!r) return '<td class="wait" colspan="4">…</td>';
  if (r.error) return `<td colspan="4">${ERR}</td>`;
  const syn = source === 'openlibrary' && !deep && !r.synopsis ? '<span class="cell-na">não verificado</span>' : r.synopsis ? YES : NO;
  return [r.found, r.cover, null, r.pt]
    .map((v, i) => i === 2 ? `<td class="${r.synopsis ? 'y' : 'n'}">${syn}</td>` : `<td class="${v ? 'y' : 'n'}">${v ? YES : NO}</td>`)
    .join('');
}

function rowHtml(item, g, o, deep) {
  const found = [g && g.found && `<span>Google: ${esc(g.title)}</span>`, o && o.found && `<span>Open Library: ${esc(o.title)}</span>`].filter(Boolean).join('');
  return `<th scope="row"><span class="q">${esc(item.line)}</span>${found ? `<span class="m">${found}</span>` : ''}</th>${cells(g, deep, 'google')}${cells(o, deep, 'openlibrary')}`;
}

function renderScore(results, deep) {
  const failed = results.filter((r) => r.g.error || r.o.error).length;
  results = results.filter((r) => !r.g.error && !r.o.error);
  const n = results.length;
  const sum = (src, k) => results.filter((r) => r[src] && r[src][k]).length;
  const metrics = [['found', 'Encontrados'], ['cover', 'Com capa'], ['synopsis', 'Com sinopse'], ['pt', 'Em português']];
  const col = (src, label) => `<div class="score-col">
      <h2 class="serif">${label}</h2>
      <dl>${metrics.map(([k, l]) => {
        const a = sum(src, k), b = sum(src === 'g' ? 'o' : 'g', k);
        const na = k === 'synopsis' && src === 'o' && !deep;
        return `<div class="${!na && a > b ? 'win' : ''}"><dt>${l}</dt><dd>${na ? '—' : `${a}<span>/${n}</span>`}</dd></div>`;
      }).join('')}</dl>
    </div>`;
  const gScore = metrics.reduce((t, [k]) => t + sum('g', k), 0);
  const oScore = metrics.reduce((t, [k]) => t + sum('o', k), 0);
  const verdict = !n
    ? 'As APIs não responderam. Verifique a conexão e rode de novo.'
    : n < 5
    ? 'Teste com pelo menos 10 livros para ter uma conclusão confiável.'
    : gScore === oScore
      ? 'Empate técnico com esses livros. Usar as duas juntas, como a estante faz, cobre o máximo.'
      : `Com esses livros, ${gScore > oScore ? 'o Google Books' : 'a Open Library'} se saiu melhor. A estante já usa ${gScore > oScore ? 'o Google Books como fonte principal' : 'as duas, mas vale inverter a ordem'}.`;
  $score.innerHTML = `${col('g', 'Google Books')}${col('o', 'Open Library')}<p class="verdict">${esc(verdict)}${failed ? ` ${failed} ${failed === 1 ? 'livro ficou' : 'livros ficaram'} de fora por erro de conexão.` : ''}</p>`;
  $score.hidden = false;
}

async function run(items, deep) {
  if (running) running.abort();
  const ctrl = (running = new AbortController());
  $rows.innerHTML = items.map((it, i) => `<tr data-i="${i}">${rowHtml(it, null, null, deep)}</tr>`).join('');
  $tableBox.hidden = false;
  $score.hidden = true;
  $run.disabled = true;
  const results = [];
  try {
    for (let i = 0; i < items.length; i++) {
      if (ctrl.signal.aborted) return;
      $status.textContent = `Testando ${i + 1} de ${items.length}: ${items[i].line}`;
      const [g, o] = await Promise.all([
        check('google', items[i], deep, ctrl.signal).catch(() => ({ error: true })),
        check('openlibrary', items[i], deep, ctrl.signal).catch(() => ({ error: true })),
      ]);
      results.push({ g, o });
      const tr = $rows.querySelector(`tr[data-i="${i}"]`);
      if (tr) tr.innerHTML = rowHtml(items[i], g, o, deep);
      renderScore(results, deep);
    }
    const errors = results.filter((r) => r.g.error || r.o.error).length;
    $status.textContent = errors
      ? `Concluído, mas ${errors} ${errors === 1 ? 'consulta falhou' : 'consultas falharam'} (conexão ou limite da API). Rode de novo mais tarde para esses.`
      : `Concluído: ${items.length} ${items.length === 1 ? 'livro testado' : 'livros testados'}.`;
  } finally {
    $run.disabled = false;
  }
}

$form.addEventListener('submit', (e) => {
  e.preventDefault();
  const items = parse($titles.value);
  if (!items.length) { $status.textContent = 'Escreva pelo menos um livro, um por linha.'; $titles.focus(); return; }
  if ($titles.value.split('\n').filter((l) => l.trim()).length > MAX) $status.textContent = `Usando os primeiros ${MAX} livros da lista.`;
  run(items, $deep.checked);
});

document.getElementById('from-shelf').addEventListener('click', () => {
  const { books } = getState();
  $titles.value = books.slice(0, MAX).map((b) => (b.isbn ? b.isbn : `${b.title} — ${(b.authors || [])[0] || ''}`)).join('\n');
  $titles.focus();
});
