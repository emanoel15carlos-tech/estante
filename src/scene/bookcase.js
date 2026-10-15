// The rotating bookcase in the hero: real 3D books with their covers.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { drawCover, drawSpine, loadCorsImage } from '../lib/covers.js';

const MAX_BOOKS = 36;

export class Bookcase {
  constructor(canvas, { onOpen, reduce = false } = {}) {
    this.cv = canvas;
    this.onOpen = onOpen;
    this.reduce = reduce;
    this.meshes = [];
    this.byId = new Map();
    this.known = new Set();
    this.s = { spin: 0, drag: 0, mx: 0, my: 0, tmx: 0, tmy: 0, p: 0, down: false, lastX: 0, moved: 0, hover: null, on: true };
    this.R = 4.2;
    this.camZ = 15;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x15110d, 13, 34);
    this.camera = new THREE.PerspectiveCamera(30, 2, 0.1, 120);

    this.scene.add(new THREE.HemisphereLight(0xffe9c9, 0x1a120c, 1.1));
    const key = (this.key = new THREE.DirectionalLight(0xffd29a, 2.6));
    key.position.set(5, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8aa6c8, 0.9);
    rim.position.set(-6, 3, -6);
    this.scene.add(rim);

    this.ring = new THREE.Group();
    this.scene.add(this.ring);
    this.baseY = -1.7;
    this.discMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.85 });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.22, 96), this.discMat);
    this.disc.position.y = this.baseY - 0.11;
    this.disc.receiveShadow = true;
    this.scene.add(this.disc);

    const pc = document.createElement('canvas');
    pc.width = 64; pc.height = 64;
    const px = pc.getContext('2d');
    px.fillStyle = '#EFE5D2'; px.fillRect(0, 0, 64, 64);
    px.fillStyle = '#D3C5A9';
    for (let y = 0; y < 64; y += 3) px.fillRect(0, y, 64, 1);
    this.pagesTex = new THREE.CanvasTexture(pc);
    this.pagesTex.colorSpace = THREE.SRGBColorSpace;
    this.pagesMat = new THREE.MeshStandardMaterial({ map: this.pagesTex, roughness: 0.95 });
    this.aniso = r.capabilities.getMaxAnisotropy();

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.bind();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);

    this.st = [
      ScrollTrigger.create({ trigger: canvas, start: 'top bottom', end: 'bottom top', onToggle: (t) => { this.s.on = t.isActive; } }),
    ];
    if (!reduce) {
      this.scrub = gsap.to(this.s, { p: 1, ease: 'none', scrollTrigger: { trigger: canvas, start: 'top 55%', end: 'bottom top', scrub: 1 } });
    }
    this.tick = this.tick.bind(this);
    gsap.ticker.add(this.tick);
  }

  layout(count) {
    // Each book needs ~1.3 units of the circle; small collections keep a minimum ring.
    this.R = Math.max(3.4, (count * 1.3) / (Math.PI * 2));
    this.disc.scale.set(this.R + 0.95, 1, this.R + 0.95);
    const k = this.key.shadow.camera;
    const e = this.R + 3;
    k.left = -e; k.right = e; k.top = e; k.bottom = -e; k.near = 1; k.far = 40 + this.R * 2;
    k.updateProjectionMatrix();
    this.resize();
  }

  /** Rebuilds the ring from the collection. New books drop in; known ones stay put. */
  setBooks(list) {
    const books = [...list].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, MAX_BOOKS);
    const ids = new Set(books.map((b) => b.id));
    // Remove books no longer present.
    for (const m of [...this.meshes]) {
      if (!ids.has(m.userData.id)) this.disposeMesh(m);
    }
    this.meshes = this.meshes.filter((m) => ids.has(m.userData.id));
    // Add or refresh.
    const fresh = [];
    for (const b of books) {
      const m = this.byId.get(b.id);
      if (!m) {
        fresh.push(this.createMesh(b));
      } else if (m.userData.sig !== this.sig(b)) {
        this.disposeMesh(m);
        this.meshes = this.meshes.filter((x) => x !== m);
        const n = this.createMesh(b);
        n.userData.intro = 1;
      }
    }
    // Order around the ring follows the collection order.
    this.meshes.sort((a, b) => books.findIndex((x) => x.id === a.userData.id) - books.findIndex((x) => x.id === b.userData.id));
    this.meshes.forEach((m, i) => { m.userData.th = (i / this.meshes.length) * Math.PI * 2; });
    this.layout(this.meshes.length);
    if (fresh.length) {
      const targets = fresh.map((m) => m.userData);
      if (this.reduce) targets.forEach((u) => { u.intro = 1; });
      else gsap.to(targets, { intro: 1, duration: 1.2, ease: 'back.out(1.4)', stagger: { each: 0.04, from: 'center' }, delay: this.known.size ? 0.2 : 0.15 });
    }
    books.forEach((b) => this.known.add(b.id));
  }

  sig(b) { return [b.title, b.cover, b.color, b.spineW, b.spineH].join('|'); }

  createMesh(b) {
    const H = b.spineH / 68, Tk = b.spineW / 72, D = 2.2;
    const geo = new THREE.BoxGeometry(Tk, H, D);
    const coverMat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.62 });
    const backMat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7 });
    const spineMat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.6 });
    // Box faces: +x front cover, -x back, +y/-y page edges, +z spine (faces out), -z fore-edge.
    const m = new THREE.Mesh(geo, [coverMat, backMat, this.pagesMat, this.pagesMat, spineMat, this.pagesMat]);
    m.castShadow = true;
    m.userData = { id: b.id, book: b, H, Tk, D, th: 0, lift: 0, intro: this.reduce ? 1 : 0, coverMat, backMat, spineMat, textures: [], sig: this.sig(b) };
    this.ring.add(m);
    this.meshes.push(m);
    this.byId.set(b.id, m);
    this.paint(m);
    return m;
  }

  async paint(m) {
    const u = m.userData, b = u.book;
    const ready = document.fonts ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
    await ready;
    if (!this.byId.has(u.id) || this.byId.get(u.id) !== m) return;
    const sw = Math.max(48, Math.round((512 * u.Tk) / u.H));
    const spine = new THREE.CanvasTexture(drawSpine(b, sw));
    this.applyTex(m, u.spineMat, spine);
    let coverSource = null;
    if (b.cover) coverSource = await loadCorsImage(b.cover);
    if (!this.byId.has(u.id) || this.byId.get(u.id) !== m) return;
    const tex = coverSource ? new THREE.Texture(coverSource) : new THREE.CanvasTexture(drawCover(b, 512, Math.round((512 * u.H) / u.D)));
    tex.needsUpdate = true;
    this.applyTex(m, u.coverMat, tex);
  }

  applyTex(m, mat, tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.aniso;
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    m.userData.textures.push(tex);
  }

  disposeMesh(m) {
    const u = m.userData;
    this.ring.remove(m);
    this.byId.delete(u.id);
    m.geometry.dispose();
    [u.coverMat, u.backMat, u.spineMat].forEach((x) => x.dispose());
    u.textures.forEach((t) => t.dispose());
    if (this.s.hover === m) this.s.hover = null;
  }

  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const base = 15 * (this.R / 4.2);
    this.camZ = this.camera.aspect < 1.3 ? (base * 1.45) / this.camera.aspect : base;
    this.lookY = this.camera.aspect < 1.3 ? -1.3 : 0.1;
    this.scene.fog.near = this.camZ - this.R;
    this.scene.fog.far = this.camZ + this.R * 3;
    this.camera.updateProjectionMatrix();
  }

  pick(e) {
    const rc = this.cv.getBoundingClientRect();
    this.ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    return hit ? hit.object : null;
  }

  setHover(m) {
    const s = this.s;
    if (s.hover === m) return;
    if (s.hover) gsap.to(s.hover.userData, { lift: 0, duration: 0.5, ease: 'expo.out' });
    s.hover = m;
    if (m) gsap.to(m.userData, { lift: 1, duration: 0.5, ease: 'expo.out' });
    this.cv.style.cursor = m ? 'pointer' : '';
  }

  bind() {
    const s = this.s;
    this.onMove = (e) => {
      const rc = this.cv.getBoundingClientRect();
      s.tmx = (e.clientX - rc.left) / rc.width - 0.5;
      s.tmy = (e.clientY - rc.top) / rc.height - 0.5;
      if (s.down) {
        const dx = e.clientX - s.lastX;
        s.lastX = e.clientX;
        s.drag += dx * 0.006;
        s.moved += Math.abs(dx);
        if (s.moved > 6) this.setHover(null);
      } else if (e.pointerType === 'mouse') this.setHover(this.pick(e));
    };
    this.onDown = (e) => {
      s.down = true; s.lastX = e.clientX; s.moved = 0;
      try { this.cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    };
    this.onUp = (e) => {
      if (!s.down) return;
      s.down = false;
      if (s.moved < 6) {
        const m = this.pick(e);
        if (m && this.onOpen) this.onOpen(m.userData.id, this.screenRect(m.userData.id));
      }
    };
    this.onLeave = () => { this.setHover(null); s.tmx = 0; s.tmy = 0; };
    this.cv.addEventListener('pointermove', this.onMove);
    this.cv.addEventListener('pointerdown', this.onDown);
    this.cv.addEventListener('pointerup', this.onUp);
    this.cv.addEventListener('pointerleave', this.onLeave);
  }

  /** Where a book is on screen, as a spine-shaped rectangle (origin for the fly-out). */
  screenRect(id) {
    const m = this.byId.get(id);
    if (!m) return null;
    const u = m.userData, rc = this.cv.getBoundingClientRect();
    const top = new THREE.Vector3(), bot = new THREE.Vector3();
    m.getWorldPosition(top);
    bot.copy(top);
    top.y += u.H / 2; bot.y -= u.H / 2;
    top.project(this.camera); bot.project(this.camera);
    const cx = rc.left + ((top.x + 1) / 2) * rc.width;
    const ty = rc.top + ((1 - top.y) / 2) * rc.height;
    const by = rc.top + ((1 - bot.y) / 2) * rc.height;
    const h = Math.max(40, by - ty);
    return { left: cx - h * 0.09, top: ty, width: h * 0.18, height: h };
  }

  tick(time, dtMs) {
    const s = this.s;
    if (!s.on) return;
    const dt = Math.min(dtMs, 50) / 1000;
    if (!this.reduce && !s.down && !s.hover) s.spin += dt * 0.12;
    s.mx += (s.tmx - s.mx) * 0.06;
    s.my += (s.tmy - s.my) * 0.06;
    this.ring.rotation.y = s.spin + s.drag + s.p * 1.4 + s.mx * 0.25;
    const zoom = this.R / 4.2;
    this.camera.position.set(s.mx * 0.8, (2.4 - s.my * 0.6 + s.p * 1.6) * Math.max(1, zoom * 0.8), this.camZ);
    this.camera.lookAt(0, (this.lookY ?? 0.1) - s.p * 0.5, 0);
    for (const m of this.meshes) {
      const u = m.userData;
      const rr = this.R + u.lift * 0.75;
      // Intro: each book grows up out of the plinth, then settles.
      const grow = Math.max(0.001, u.intro);
      const y = this.baseY + (u.H * grow) / 2 + u.lift * 0.12;
      m.scale.set(1, grow, 1);
      m.position.set(Math.sin(u.th) * rr, y, Math.cos(u.th) * rr);
      m.rotation.set(0, u.th, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    gsap.ticker.remove(this.tick);
    this.ro.disconnect();
    this.st.forEach((t) => t.kill());
    if (this.scrub) this.scrub.scrollTrigger.kill();
    this.cv.removeEventListener('pointermove', this.onMove);
    this.cv.removeEventListener('pointerdown', this.onDown);
    this.cv.removeEventListener('pointerup', this.onUp);
    this.cv.removeEventListener('pointerleave', this.onLeave);
    [...this.meshes].forEach((m) => this.disposeMesh(m));
    this.disc.geometry.dispose();
    this.discMat.dispose();
    this.pagesTex.dispose();
    this.pagesMat.dispose();
    this.renderer.dispose();
  }
}
