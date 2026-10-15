// Cover images: loading real covers (with CORS when possible), drawing a
// typographic cover when there is none, and shrinking uploaded photos.

const FRAUNCES = '"IM Fell English", Georgia, serif';
const FIGTREE = '"Figtree Variable", "Figtree", system-ui, sans-serif';

/**
 * Loads an image for use in WebGL / canvas. Resolves null when the server
 * does not allow cross-origin use (the <img> tags still show it; only the
 * 3D texture falls back to a drawn cover).
 */
export function loadCorsImage(url, timeout = 10000) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => resolve(null), timeout);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 8 ? img : null); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

/** Average color of an image (for the spine), or null if the canvas is tainted. */
export function averageColor(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 12; c.height = 18;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 12, 18);
    const d = x.getImageData(0, 0, 12, 18).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return { color: hex, ink: lum > 0.55 ? '#2A2018' : '#F3EBDC' };
  } catch (e) {
    return null;
  }
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Typographic cover drawn on a canvas (used when a book has no image). */
export function drawCover(book, w = 512, h = 768) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = book.color; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, 0, 14, h);
  x.strokeStyle = book.ink; x.globalAlpha = 0.4; x.lineWidth = 2;
  x.strokeRect(34, 22, w - 56, h - 44);
  x.beginPath(); x.arc(w / 2, h * 0.45, 70, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(w / 2, h * 0.45, 46, 0, Math.PI * 2); x.stroke();
  x.globalAlpha = 1;
  x.fillStyle = book.ink; x.textBaseline = 'top';
  x.font = `500 22px ${FIGTREE}`;
  x.fillText(String((book.authors || [])[0] || '').toUpperCase().slice(0, 34), 62, 52);
  let size = 58;
  x.font = `400 ${size}px ${FRAUNCES}`;
  let lines = wrap(x, book.title, w - 120);
  while (lines.length > 4 && size > 30) { size -= 4; x.font = `400 ${size}px ${FRAUNCES}`; lines = wrap(x, book.title, w - 120); }
  const lh = size * 1.04;
  const y0 = h - 70 - lines.length * lh;
  lines.forEach((l, k) => x.fillText(l, 62, y0 + k * lh));
  x.font = `500 22px ${FIGTREE}`; x.globalAlpha = 0.8;
  x.fillText(String(book.year || ''), 62, h - 62);
  return c;
}

function splitTwo(ctx, text) {
  const words = String(text).split(' ');
  if (words.length < 2) return [text];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const wMax = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || wMax < best.w) best = { w: wMax, lines: [a, b] };
  }
  return best.lines;
}

/**
 * Spine drawn on a canvas: title reading bottom to top (one or two lines),
 * author's surname near the foot, bands at both ends. w × h in pixels.
 */
export function drawSpine(book, w, h = 1024) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = book.color; x.fillRect(0, 0, w, h);
  // Bands
  x.fillStyle = book.ink; x.globalAlpha = 0.38;
  x.fillRect(w * 0.08, h * 0.045, w * 0.84, Math.max(3, h * 0.005));
  x.fillRect(w * 0.08, h * 0.062, w * 0.84, Math.max(2, h * 0.0025));
  x.fillRect(w * 0.08, h * 0.935, w * 0.84, Math.max(2, h * 0.0025));
  x.fillRect(w * 0.08, h * 0.95, w * 0.84, Math.max(3, h * 0.005));
  x.globalAlpha = 1;

  x.save();
  x.translate(w / 2, h / 2);
  x.rotate(-Math.PI / 2); // +x now runs up the spine
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = book.ink;

  const room = h * 0.6; // length available to the title
  const centre = h * 0.07; // title sits a little above the middle; author goes below
  let size = Math.round(w * 0.42);
  const min = Math.round(w * 0.24);
  x.font = `400 ${size}px ${FRAUNCES}`;
  while (x.measureText(book.title).width > room && size > min) { size -= 1; x.font = `400 ${size}px ${FRAUNCES}`; }
  if (x.measureText(book.title).width <= room) {
    x.fillText(book.title, centre, 0);
  } else {
    // Two lines across the spine's width.
    size = Math.round(w * 0.27);
    x.font = `400 ${size}px ${FRAUNCES}`;
    let lines = splitTwo(x, book.title);
    while (Math.max(...lines.map((l) => x.measureText(l).width)) > room && size > 10) {
      size -= 1; x.font = `400 ${size}px ${FRAUNCES}`; lines = splitTwo(x, book.title);
    }
    const gap = size * 0.58;
    x.fillText(lines[0], centre, -gap);
    if (lines[1]) x.fillText(lines[1], centre, gap);
  }

  const author = String((book.authors || [])[0] || '').split(' ').filter(Boolean).pop() || '';
  if (author) {
    let as = Math.round(w * 0.2);
    x.font = `500 ${as}px ${FIGTREE}`;
    while (x.measureText(author.toUpperCase()).width > h * 0.2 && as > 8) { as -= 1; x.font = `500 ${as}px ${FIGTREE}`; }
    x.globalAlpha = 0.8;
    x.fillText(author.toUpperCase(), -h * 0.36, 0);
  }
  x.restore();
  return c;
}

/** Shrinks an uploaded photo to a JPEG data URL small enough for localStorage. */
export function fileToCover(file, maxW = 420) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Escolha um arquivo de imagem (JPG, PNG ou WebP).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler essa imagem.')); };
    img.src = url;
  });
}
