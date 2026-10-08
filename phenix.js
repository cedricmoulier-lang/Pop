/*!
 * Phénix 3D : un oiseau de feu modélisé en 3D qui se promène sur une page HTML.
 * Ajoutez juste avant </body> :
 *
 *   <script src="phenix.js" defer></script>
 *
 * Le script charge three.js (environ 170 Ko compressés) depuis jsDelivr. Si WebGL ou le CDN
 * ne sont pas disponibles, il bascule sur la version 2D, phenix-2d.js, à placer à côté.
 *
 * Réglages, en attributs de la balise <script> :
 *   data-taille="90"            taille de l'oiseau, en pixels
 *   data-perchoirs="h1, img"    sélecteur CSS des éléments où il peut se poser
 *
 * API : Phenix.traverser(), Phenix.auCentre(), Phenix.renaitre(), Phenix.pause(),
 *       Phenix.reprendre(), Phenix.masquer(), Phenix.afficher(), Phenix.etat()
 */
(() => {
  'use strict';
  if (window.Phenix) return;

  const script = document.currentScript;
  const base = script && script.src ? script.src.replace(/[^/]*$/, '') : '';
  const opts = Object.assign({}, script && script.dataset);
  const THREE_URLS = [
    'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js',
    'https://unpkg.com/three@0.170.0/build/three.module.min.js',
  ];

  // L'API existe tout de suite ; les appels faits pendant le chargement sont rejoués ensuite.
  let impl = null;
  const pending = [];
  const relay = (name) => (...args) => {
    if (impl) return impl[name](...args);
    pending.push([name, args]);
    return undefined;
  };
  window.Phenix = {
    __options: opts,
    __attach(api) {
      impl = api;
      for (const [n, a] of pending.splice(0)) api[n](...a);
    },
    traverser: relay('traverser'),
    auCentre: relay('auCentre'),
    renaitre: relay('renaitre'),
    pause: relay('pause'),
    reprendre: relay('reprendre'),
    masquer: relay('masquer'),
    afficher: relay('afficher'),
    etat: () => (impl ? impl.etat() : 'chargement'),
  };

  function fallback2D() {
    const s = document.createElement('script');
    s.src = base + 'phenix-2d.js';
    document.head.appendChild(s);
  }
  function webglOK() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (err) {
      return false;
    }
  }
  async function loadThree() {
    for (const url of THREE_URLS) {
      try { return await import(url); } catch (err) { /* CDN suivant */ }
    }
    return null;
  }
  function boot() {
    if (!webglOK()) { fallback2D(); return; }
    loadThree().then((THREE) => {
      if (!THREE) { fallback2D(); return; }
      try { start(THREE); } catch (err) { console.error(err); fallback2D(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* =================================================================================== */

  function start(THREE) {
    const PERCHES = opts.perchoirs || 'h1, h2, h3, img, button, [data-phenix-perchoir], .phenix-perchoir';
    const TEXTUAL = 'h1, h2, h3, h4, h5, h6, p, a, span, li, label, strong, em';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const TAU = Math.PI * 2;
    const V3 = THREE.Vector3;
    const lerp = (a, b, k) => a + (b - a) * k;
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const rand = (a, b) => a + Math.random() * (b - a);
    const smooth = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
    const approach = (v, t, step) => (Math.abs(t - v) <= step ? t : v + Math.sign(t - v) * step);
    const ease = (v, t, dt, rate) => v + (t - v) * Math.min(1, dt * rate);

    /* ---------- Textures dessinées une fois ---------- */
    function canvasTex(w, h, draw, flipY) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (flipY === false) t.flipY = false;
      return t;
    }

    /* ---------- Plumes : textures calculées pixel par pixel ---------- */
    // Pas de traits dessinés : des barbes fines et irrégulières, un bord effiloché, des barbes qui
    // s'écartent par endroits, du duvet à la base, et une carte de relief pour que la lumière
    // accroche les barbes comme sur une vraie plume.

    // Bruit de valeur lissé (irrégularités, marbrures, duvet)
    function valueNoise() {
      const P = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) P[i] = Math.random();
      const h = (x, y) => P[((x * 73856093) ^ (y * 19349663)) & 1023];
      return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      };
    }
    // Couleur interpolée le long d'une suite de paliers [t, [r, v, b]]
    const ramp = (stops) => (t) => {
      let j = 1;
      while (j < stops.length - 1 && stops[j][0] < t) j++;
      const [t0, c0] = stops[j - 1], [t1, c1] = stops[j], f = clamp((t - t0) / (t1 - t0), 0, 1);
      return [lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)];
    };
    // Couleur + relief. px(x, y, o) remplit o = [r, v, b, a, nx, ny, nz] ; y = 0 en haut de l'image.
    // Les données vont directement à la carte graphique (pas de canvas : les pixels transparents gardent
    // leur couleur, sinon un liseré sombre apparaît autour de chaque plume).
    function texPair(W, H, px) {
      const col = new Uint8Array(W * H * 4), nor = new Uint8Array(W * H * 4), o = new Float32Array(7);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          o[4] = 0; o[5] = 0; o[6] = 1;
          px(x, y, o);
          const i = ((H - 1 - y) * W + x) * 4; // ligne retournée : le haut de l'image en v = 1
          col[i] = clamp(o[0], 0, 255); col[i + 1] = clamp(o[1], 0, 255); col[i + 2] = clamp(o[2], 0, 255); col[i + 3] = clamp(o[3], 0, 255);
          nor[i] = (o[4] * 0.5 + 0.5) * 255; nor[i + 1] = (-o[5] * 0.5 + 0.5) * 255; nor[i + 2] = (o[6] * 0.5 + 0.5) * 255; nor[i + 3] = 255;
        }
      }
      const mk = (data, srgb) => {
        const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 8;
        t.needsUpdate = true;
        return t;
      };
      return { map: mk(col, true), normalMap: mk(nor, false) };
    }

    // Plume vue de dessus, bout à gauche (u = 0), base à droite (u = 1).
    // f.width(t) → [demi-largeur côté haut, côté bas] (fraction de la hauteur), f.color(t, s) → [r, v, b]
    // (s : 0 au rachis, 1 au bord), f.spacing : écart des barbes (px), f.down : part duveteuse à la base,
    // f.touch(t, dy, o) : retouche facultative (ocelle…).
    function featherPair(W, H, f) {
      const n = valueNoise(), cy = H / 2, sp = f.spacing || 2.6, sl = f.slant || 1.5, down = f.down ?? 0.16;
      const rachis = ramp([[0, [190, 96, 60]], [0.5, [246, 206, 150]], [1, [255, 238, 205]]]);
      return texPair(W, H, (x, y, o) => {
        const t = x / (W - 1), dy = (y + 0.5 - cy) / H, top = dy < 0, ad = Math.abs(dy);
        const wv = f.width(t), half = Math.max(1e-3, top ? wv[0] : wv[1]);
        const s = ad / half;
        const b = x + ad * H * sl; // reste constant le long d'une barbe
        const ph = (b + n(b * 0.04, ad * H * 0.05) * 7) / sp;
        const barb = 0.5 + 0.5 * Math.cos(ph * TAU), slope = -Math.sin(ph * TAU) * Math.PI;
        // Contour net (pas de zones à demi transparentes : à l'écran elles se tramaient en pixels) :
        // bord effiloché qui suit la pointe des barbes, quelques encoches où les barbes s'écartent,
        // base duveteuse au contour plus ébouriffé
        const fluff = down > 0 ? smooth((t - (1 - down)) / down) : 0;
        const edge = s - 0.86 + (n(b * 0.035, 7.3) - 0.5) * 0.18 + fluff * (n(x * 0.08, y * 0.08) - 0.35) * 0.6;
        let a = 1 - smooth(edge / 0.05 + 0.5);
        a *= 1 - smooth((n(b * 0.03 + 31, 1.7) - 0.78) / 0.04) * smooth((s - 0.45) / 0.1);
        const c = f.color(t, Math.min(1, s));
        let k = (0.82 + 0.26 * barb) * (0.88 + 0.24 * n(x * 0.012, y * 0.04)) * (1 - 0.18 * s * s);
        k = lerp(k, 1.06, fluff * 0.6);
        o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k; o[3] = 255 * clamp(a, 0, 1);
        const rw = (0.5 + 1.6 * t) / H; // demi-largeur de la tige
        if (ad < rw && t > 0.015) {
          const m = 1 - ad / rw, rc = rachis(t);
          o[0] = lerp(o[0], rc[0], m * 0.85); o[1] = lerp(o[1], rc[1], m * 0.85); o[2] = lerp(o[2], rc[2], m * 0.85);
          o[3] = 255;
          o[5] = (top ? -0.5 : 0.5) * (1 - m);
          o[6] = Math.sqrt(1 - o[5] * o[5]);
        } else {
          // relief : chaque barbe est un petit cylindre, et la vexille se creuse un peu vers le bord
          const kx = 0.5 * slope, ky = 0.5 * slope * sl * (top ? -1 : 1) + (top ? -0.3 : 0.3) * s;
          const L = Math.hypot(kx, ky, 1);
          o[4] = -kx / L; o[5] = -ky / L; o[6] = 1 / L;
        }
        if (f.touch) f.touch(t, dy, o, x, y);
      });
    }
    const profile = (P) => (t) => {
      const k = Math.min(1, t / P.tip) ** P.round * (t > 0.84 ? 1 - ((t - 0.84) / 0.16) * 0.6 : 1);
      return [P.top * k, P.bot * k];
    };
    // Couleurs : bouts sombres, rouge profond, orange de braise, or pâle à la base
    const PAL = {
      primary: ramp([[0, [48, 11, 13]], [0.1, [92, 16, 18]], [0.26, [160, 30, 22]], [0.5, [218, 76, 26]], [0.75, [240, 144, 46]], [0.92, [248, 196, 108]], [1, [252, 224, 168]]]),
      secondary: ramp([[0, [84, 16, 17]], [0.18, [158, 32, 22]], [0.45, [220, 86, 28]], [0.75, [242, 152, 52]], [1, [250, 218, 156]]]),
      covert: ramp([[0, [168, 42, 24]], [0.3, [224, 98, 32]], [0.7, [244, 164, 62]], [1, [250, 216, 148]]]),
      tail: ramp([[0, [54, 12, 14]], [0.12, [112, 20, 20]], [0.35, [188, 46, 24]], [0.65, [234, 116, 38]], [1, [248, 202, 118]]]),
      crest: ramp([[0, [140, 24, 20]], [0.3, [214, 66, 26]], [0.7, [244, 156, 54]], [1, [250, 210, 136]]]),
      contour: ramp([[0, [232, 124, 42]], [0.35, [208, 74, 28]], [0.75, [228, 124, 50]], [1, [246, 200, 140]]]),
      small: ramp([[0, [236, 132, 48]], [0.5, [226, 112, 40]], [1, [240, 160, 72]]]),
    };
    const FEATHER = {
      primary: { top: 0.17, bot: 0.45, tip: 0.12, round: 0.55, spacing: 2.4 },
      secondary: { top: 0.3, bot: 0.45, tip: 0.18, round: 0.8, spacing: 2.6 },
      covert: { top: 0.42, bot: 0.42, tip: 0.35, round: 0.9, spacing: 2.8, down: 0.22 },
      tail: { top: 0.42, bot: 0.42, tip: 0.14, round: 0.7, spacing: 2.4 },
      crest: { top: 0.2, bot: 0.2, tip: 0.08, round: 0.3, spacing: 2.2, down: 0.25 },
      contour: { top: 0.44, bot: 0.44, tip: 0.32, round: 0.85, spacing: 3, slant: 1.1, down: 0.3 },
      small: { top: 0.46, bot: 0.46, tip: 0.5, round: 1, spacing: 5, slant: 1, down: 0 },
    };
    function realFeather(kind) {
      const P = FEATHER[kind], col = PAL[kind];
      return featherPair(512, 128, { width: profile(P), spacing: P.spacing, slant: P.slant, down: P.down ?? 0.12, color: (t, s) => {
        const c = col(t); // le bord de la vexille un peu plus sombre
        return [c[0] * (1 - 0.12 * s), c[1] * (1 - 0.16 * s), c[2] * (1 - 0.16 * s)];
      } });
    }

    // Longue plume de queue : tige nue, puis large vexille qui finit en flamme, avec un ocelle
    function realPlume() {
      const W = 1024, H = 128, cy = H / 2, ex = W * 0.16, er = H * 0.42;
      const col = ramp([[0, [70, 12, 14]], [0.12, [168, 34, 22]], [0.35, [228, 92, 28]], [0.66, [246, 160, 44]], [1, [252, 222, 160]]]);
      const eye = ramp([[0, [255, 240, 196]], [0.3, [250, 176, 52]], [0.62, [196, 44, 22]], [1, [168, 34, 22]]]);
      const w = (t) => {
        if (t > 0.55) return 0.05 + 0.04 * (1 - t);
        return 0.06 + 0.36 * Math.sin(Math.PI * Math.min(1, (t / 0.55) * 1.15)) ** 0.8;
      };
      return featherPair(W, H, { width: (t) => [w(t), w(t)], spacing: 2.8, slant: 1.8, down: 0, color: col,
        touch: (t, dy, o, x, y) => {
          const d = Math.hypot((x - ex) / er, (y - cy) / er);
          if (d < 1) {
            const c = eye(d), m = 1 - smooth((d - 0.75) / 0.25);
            o[0] = lerp(o[0], c[0] * (o[0] / 255 * 0.3 + 0.75), m); o[1] = lerp(o[1], c[1] * 0.92, m); o[2] = lerp(o[2], c[2] * 0.92, m);
          }
        } });
    }

    // Pattes : rangées d'écailles bombées (scutelles), sillons sombres entre elles
    function scutesPair() {
      const n = valueNoise(), W = 64, H = 128, rows = 22, cols = 6;
      return texPair(W, H, (x, y, o) => {
        const v = y / H * rows, row = Math.floor(v), u = x / W * cols + (row % 2) * 0.5;
        const fu = u - Math.floor(u) - 0.5, fv = v - row - 0.5;
        const d = Math.max(Math.abs(fu) * 1.1, Math.abs(fv) * 1.25);
        const bump = 1 - smooth((d - 0.3) / 0.2);
        const k = (0.62 + 0.42 * bump) * (0.9 + 0.2 * n(x * 0.1, y * 0.1));
        o[0] = 232 * k; o[1] = 158 * k; o[2] = 62 * k; o[3] = 255;
        const gx = -fu * 2.4 * (1 - bump) * bump * 4, gy = -fv * 2.4 * (1 - bump) * bump * 4;
        const L = Math.hypot(gx, gy, 1);
        o[4] = gx / L; o[5] = gy / L; o[6] = 1 / L;
      });
    }

    // Duvet ras du corps et de la tête : de fines mèches couchées, marbrées
    function velvetPair(W, H, color, dir) {
      const n = valueNoise(), m = valueNoise();
      return texPair(W, H, (x, y, o) => {
        const u = dir ? y : x, v = dir ? x : y; // les mèches suivent u
        const s1 = n(u * 0.05, v * 0.55), s2 = m(u * 0.11 + 9, v * 1.1);
        const streak = s1 * 0.65 + s2 * 0.35;
        const c = color(y / (H - 1));
        const k = (0.88 + 0.18 * streak) * (0.92 + 0.16 * m(x * 0.02, y * 0.02));
        o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k; o[3] = 255;
        const g = (n(u * 0.05, (v + 1) * 0.55) - s1) * 1.1;
        o[dir ? 5 : 4] = 0; o[dir ? 4 : 5] = g; o[6] = Math.sqrt(Math.max(0.2, 1 - g * g));
      });
    }

    function spriteTex(draw, size) {
      return canvasTex(size, size, draw, false);
    }
    const smokeTex = spriteTex((g, W) => {
      const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.6)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, W);
    }, 64);
    const glowTex = spriteTex((g, W) => {
      const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
      gr.addColorStop(0, 'rgba(255,190,90,0.85)');
      gr.addColorStop(0.3, 'rgba(255,140,50,0.35)');
      gr.addColorStop(1, 'rgba(255,90,30,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, W);
    }, 128);

    const TEX = {
      primary: realFeather('primary'),
      secondary: realFeather('secondary'),
      covert: realFeather('covert'),
      tail: realFeather('tail'),
      crest: realFeather('crest'),
      contour: realFeather('contour'),
      small: realFeather('small'),
      plume: realPlume(),
      body: velvetPair(256, 256, ramp([[0, [246, 178, 92]], [0.5, [236, 132, 50]], [1, [214, 84, 34]]]), true),
      scales: scutesPair(),
    };
    for (const t of [TEX.body.map, TEX.body.normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); }
    // Plumes : relief des barbes, reflet velouté sous la lumière rasante (sheen), lueur interne discrète,
    // bords adoucis par l'anticrénelage (alphaToCoverage), teinte propre à chaque plume (couleurs de sommets)
    const featherMat = (tex, glow, tint = true) => new THREE.MeshPhysicalMaterial({
      map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      emissiveMap: tex.map, emissive: 0xffffff, emissiveIntensity: glow,
      sheen: 0.45, sheenRoughness: 0.42, sheenColor: new THREE.Color(0xffb870),
      roughness: 0.55, metalness: 0, vertexColors: tint,
      alphaTest: 0.25, alphaToCoverage: true, side: THREE.DoubleSide,
    });
    const MAT = {
      primary: featherMat(TEX.primary, 0.2),
      secondary: featherMat(TEX.secondary, 0.22),
      covert: featherMat(TEX.covert, 0.24),
      bodyCovert: featherMat(TEX.contour, 0.24),
      headFeather: featherMat(TEX.small, 0.22),
      tail: featherMat(TEX.tail, 0.2),
      crest: featherMat(TEX.crest, 0.26),
      plume: featherMat(TEX.plume, 0.28, false),
      body: new THREE.MeshStandardMaterial({ map: TEX.body.map, normalMap: TEX.body.normalMap, emissiveMap: TEX.body.map, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.8 }),
      leg: new THREE.MeshStandardMaterial({ map: TEX.scales.map, normalMap: TEX.scales.normalMap, roughness: 0.5, emissive: 0x3a1606, emissiveIntensity: 0.4 }),
      talon: new THREE.MeshStandardMaterial({ color: 0x1a0a0c, roughness: 0.25 }),
    };

    /* ---------- Géométrie ---------- */
    const SPHERE = new THREE.SphereGeometry(1, 28, 20);
    const BODY_SPHERE = (() => { // pôles orientés vers l'avant et l'arrière, pour que le plumage pointe vers la queue
      const g = new THREE.SphereGeometry(1, 36, 24);
      g.rotateZ(-Math.PI / 2);
      return g;
    })();

    // Plumes souples : chaque plume fléchit sur sa longueur (de plus en plus vers la pointe), ondule
    // et son bord de fuite frémit dans l'air. Le calcul se fait dans le shader ; chaque groupe de plumes
    // (rémiges, couvertures, aigrette, queue, plumes du corps) a ses propres réglages, mis à jour à chaque image.
    // Variante « pivot » (plumes fusionnées des ailes) : chaque plume tourne en plus autour de sa base,
    // de son angle replié à son angle déployé (uExt, commun aux deux ailes) — un seul objet par rangée.
    const FOLDU = { ext: { value: 0 }, jit: { value: 0 } };
    function softFeathers(mat, shared, pivot) {
      const u = shared || { bend: { value: 0 }, flutter: { value: 0 }, ripple: { value: 0 }, time: { value: 0 } };
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uBend = u.bend;
        sh.uniforms.uFlutter = u.flutter;
        sh.uniforms.uRipple = u.ripple;
        sh.uniforms.uTime = u.time;
        sh.uniforms.uExt = FOLDU.ext;
        sh.uniforms.uJit = FOLDU.jit;
        let vs = 'uniform float uBend; uniform float uFlutter; uniform float uRipple; uniform float uTime; uniform float uExt; uniform float uJit;\n'
          + 'attribute float aPhase; attribute float aFlex; attribute float aT; attribute float aW; attribute vec3 aN;\n'
          + (pivot ? 'attribute vec3 aPivot; attribute vec2 aFoldExt;\n' : '') + sh.vertexShader;
        if (pivot) {
          vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            float fAng = mix(aFoldExt.x, aFoldExt.y, uExt) + uJit * sin(uTime * 4.7 + aPhase * 3.0);
            float fC = cos(fAng), fS = sin(fAng);
            objectNormal = vec3(fC * objectNormal.x + fS * objectNormal.z, objectNormal.y, -fS * objectNormal.x + fC * objectNormal.z);`);
        }
        vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
            // aT : distance à la base de la plume, aW : position en travers, aN : normale de la plume
            transformed += aN * (aFlex * aT * aT * (uBend + uFlutter * sin(uTime * 11.0 + aPhase - aT * 8.0))
              + aW * aT * aFlex * uRipple * sin(uTime * 16.0 + aPhase * 1.7 - aT * 11.0));` + (pivot ? `
            vec3 fLp = transformed - aPivot;
            transformed = aPivot + vec3(fC * fLp.x + fS * fLp.z, fLp.y, -fS * fLp.x + fC * fLp.z);` : ''));
        sh.vertexShader = vs;
      };
      mat.customProgramCacheKey = () => (pivot ? 'plume-pivot' : 'plume');
      return u;
    }
    const SOFT = {
      primary: softFeathers(MAT.primary), secondary: softFeathers(MAT.secondary), covert: softFeathers(MAT.covert),
      body: softFeathers(MAT.bodyCovert), crest: softFeathers(MAT.crest), tail: softFeathers(MAT.tail),
    };
    softFeathers(MAT.headFeather, SOFT.body);
    MAT.covertW = MAT.covert.clone();
    MAT.bodyCovertW = MAT.bodyCovert.clone();
    softFeathers(MAT.covertW, SOFT.covert, true);
    softFeathers(MAT.bodyCovertW, SOFT.body, true);
    // Rangée de plumes d'aile fusionnée : chaque plume garde sa base (pivot) et ses angles replié/déployé
    function wingRow(items, mat) {
      const P = [], Nn = [], UV = [], CO = [], PH = [], FX = [], T = [], WW = [], AN = [], PV = [], FE = [], IDX = [];
      for (const it of items) {
        const g = featherMesh(mat, it.L, it.w, it.bend, it.flex).geometry;
        const base = P.length / 3, pos = g.attributes.position, n = pos.count;
        for (let i = 0; i < n; i++) {
          P.push(pos.getX(i) + it.x, pos.getY(i) + it.y, pos.getZ(i) + it.z);
          PV.push(it.x, it.y, it.z);
          FE.push(it.fold, it.ext);
        }
        Nn.push(...g.attributes.normal.array); UV.push(...g.attributes.uv.array); CO.push(...g.attributes.color.array);
        PH.push(...g.attributes.aPhase.array); FX.push(...g.attributes.aFlex.array);
        T.push(...g.attributes.aT.array); WW.push(...g.attributes.aW.array); AN.push(...g.attributes.aN.array);
        for (const k of g.index.array) IDX.push(base + k);
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      const set = (name, arr, k) => geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, k));
      set('position', P, 3); set('normal', Nn, 3); set('uv', UV, 2); set('color', CO, 3); set('aPhase', PH, 1); set('aFlex', FX, 1);
      set('aT', T, 1); set('aW', WW, 1); set('aN', AN, 3); set('aPivot', PV, 3); set('aFoldExt', FE, 2);
      geo.setIndex(IDX);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false; // la forme dépliée sort de la boîte englobante calculée au repos
      return m;
    }

    // Plume : un plan légèrement incurvé, base à l'origine, bout vers -X ; flex règle sa souplesse.
    function featherMesh(mat, L, w, bend, flex = 1) {
      const geo = new THREE.PlaneGeometry(L, w, 6, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-L / 2, 0, 0);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = -pos.getX(i) / L;
        pos.setY(i, pos.getY(i) + bend * L * t * t);
      }
      geo.computeVertexNormals();
      const n = pos.count, aT = new Float32Array(n), aW = new Float32Array(n), aN = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { aT[i] = Math.max(0, -pos.getX(i)); aW[i] = pos.getZ(i); aN[i * 3 + 1] = 1; }
      geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(Math.random() * TAU), 1));
      geo.setAttribute('aFlex', new THREE.BufferAttribute(new Float32Array(n).fill(flex), 1));
      geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
      geo.setAttribute('aW', new THREE.BufferAttribute(aW, 1));
      geo.setAttribute('aN', new THREE.BufferAttribute(aN, 3));
      // teinte propre à la plume : un peu plus claire ou sombre, tirant vers l'or ou le rouge
      const k = rand(0.84, 1.06), hue = rand(-0.08, 0.06), cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cols.set([k, k * (1 + hue), k * (1 + hue * 0.6)], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return new THREE.Mesh(geo, mat);
    }
    // Des dizaines de petites plumes fusionnées en un seul objet (un seul appel de dessin), chacune
    // gardant sa souplesse propre. items : [{ L, w, bend, flex, pos, rot }]
    function mergeFeathers(items, mat) {
      const P = [], Nn = [], UV = [], PH = [], FX = [], T = [], WW = [], AN = [], CO = [], IDX = [];
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new V3(), one = new V3(1, 1, 1);
      for (const it of items) {
        const g = featherMesh(mat, it.L, it.w, it.bend, it.flex).geometry;
        if (it.q) q.copy(it.q); else q.setFromEuler(it.rot);
        m4.compose(it.pos, q, one);
        const base = P.length / 3, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m4); P.push(v.x, v.y, v.z);
          v.fromBufferAttribute(nor, i).applyQuaternion(q); Nn.push(v.x, v.y, v.z);
          v.set(0, 1, 0).applyQuaternion(q); AN.push(v.x, v.y, v.z);
          UV.push(uv.getX(i), uv.getY(i));
        }
        PH.push(...g.attributes.aPhase.array); FX.push(...g.attributes.aFlex.array);
        T.push(...g.attributes.aT.array); WW.push(...g.attributes.aW.array);
        const tc = g.attributes.color.array, tint = it.tint || [1, 1, 1];
        for (let i = 0; i < tc.length; i++) CO.push(tc[i] * tint[i % 3]);
        for (const k of g.index.array) IDX.push(base + k);
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      const set = (name, arr, k) => geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, k));
      set('position', P, 3); set('normal', Nn, 3); set('uv', UV, 2); set('aPhase', PH, 1); set('aFlex', FX, 1);
      set('aT', T, 1); set('aW', WW, 1); set('aN', AN, 3); set('color', CO, 3);
      geo.setIndex(IDX);
      return new THREE.Mesh(geo, mat);
    }
    // Corps d'un seul tenant : une suite d'ellipses de la queue jusqu'à la tête, lissée.
    function loftGeo(rings, N, M) {
      const center = new THREE.CatmullRomCurve3(rings.map((r) => new V3(r[0], r[1], 0)));
      const radii = new THREE.CatmullRomCurve3(rings.map((r) => new V3(r[2], r[3], 0)));
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, c = center.getPoint(t), r = radii.getPoint(t);
        for (let j = 0; j <= M; j++) {
          const a = (j / M) * TAU;
          pos.push(c.x, c.y + Math.cos(a) * r.x, Math.sin(a) * r.y);
          uv.push(j / M, t);
        }
      }
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
          const a = i * (M + 1) + j, b = a + M + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    function anchor(parent, x, y, z, heat) {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      o.userData.heat = heat;
      parent.add(o);
      return o;
    }

    const anchors = [];
    const flameAnchors = [];
    function flameAt(parent, x, y, z, heat, size) {
      const o = anchor(parent, x, y, z, heat);
      o.userData.size = size;
      flameAnchors.push(o);
      return o;
    }
    const bird = new THREE.Group();
    bird.rotation.order = 'YZX';
    const body = new THREE.Group();
    bird.add(body);

    // Tronc et cou d'un seul tenant : poitrail profond, croupion effilé, cou court et épais
    const TORSO = [
      [-0.36, 0.012, 0.03, 0.045],
      [-0.27, 0.004, 0.072, 0.085],
      [-0.15, -0.004, 0.122, 0.128],
      [-0.01, -0.02, 0.155, 0.145],
      [0.1, -0.028, 0.162, 0.14],
      [0.19, -0.004, 0.138, 0.122],
      [0.25, 0.04, 0.112, 0.102],
      [0.3, 0.078, 0.094, 0.087],
      [0.34, 0.105, 0.082, 0.077],
    ];
    const torso = new THREE.Mesh(loftGeo(TORSO, 52, 32), MAT.body);
    body.add(torso);
    // Section du tronc à l'abscisse x : centre et demi-axes (interpolés entre les anneaux)
    function torsoAt(x) {
      let j = 1;
      while (j < TORSO.length - 1 && TORSO[j][0] < x) j++;
      const a = TORSO[j - 1], b = TORSO[j], f = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
      return { y: lerp(a[1], b[1], f), ry: lerp(a[2], b[2], f), rz: lerp(a[3], b[3], f) };
    }
    // Plumage : camail de plumes pointues sur le cou, puis plumes de contour en rangs qui se chevauchent
    // sur le poitrail, les flancs, le dos et le croupion, toutes couchées vers la queue.
    const plumage = [];
    for (const [x, y, r, L] of [[0.22, 0.03, 0.125, 0.16], [0.27, 0.06, 0.106, 0.14], [0.31, 0.088, 0.09, 0.12]]) {
      for (const a of [-1.75, -1.15, -0.55, 0, 0.55, 1.15, 1.75]) {
        plumage.push({ L, w: 0.075, bend: 0.12, flex: 0.8, pos: new V3(x + 0.02, y + Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92), rot: new THREE.Euler(a, 0, 0.18) });
      }
    }
    [0.19, 0.12, 0.05, -0.02, -0.09, -0.16, -0.23].forEach((x, row) => {
      const c = torsoAt(x), L = 0.15 - row * 0.006;
      const n = Math.round((TAU * (c.ry + c.rz) / 2) / 0.058);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI + ((i + (row % 2) * 0.5) / n) * TAU;
        const ra = Math.hypot(Math.cos(a) * c.ry, Math.sin(a) * c.rz);
        const b = torsoAt(x - L), rb = Math.hypot(Math.cos(a) * b.ry, Math.sin(a) * b.rz);
        const tilt = Math.atan2(ra - rb, L) + 0.06; // la plume suit la pente du corps, pointe vers lui
        plumage.push({ L: L * (0.9 + 0.2 * Math.random()), w: 0.085, bend: 0.1, flex: 0.65,
          pos: new V3(x, c.y + Math.cos(a) * c.ry * 0.97, Math.sin(a) * c.rz * 0.97), rot: new THREE.Euler(a, 0, tilt) });
      }
    });
    torso.add(mergeFeathers(plumage, MAT.bodyCovert));
    anchors.push(anchor(body, -0.05, 0.13, 0, 1), anchor(body, -0.2, 0.08, 0, 1), anchor(body, 0.15, -0.12, 0, 0.9));
    flameAt(body, -0.08, 0.12, 0.03, 1, 0.2);
    flameAt(body, -0.22, 0.07, -0.03, 1, 0.18);

    // Tête de rapace : crâne allongé et plat, joues pleines, arcades saillantes, gros bec crochu
    const headTex = velvetPair(256, 256, ramp([[0, [150, 30, 24]], [0.3, [208, 68, 28]], [0.55, [238, 140, 50]], [0.8, [248, 196, 108]], [1, [252, 226, 166]]]), false);
    MAT.head = new THREE.MeshPhysicalMaterial({ map: headTex.map, normalMap: headTex.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), emissiveMap: headTex.map, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.75, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffc887) });
    MAT.beak = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.22, emissive: 0x3a1806, emissiveIntensity: 0.22 });
    MAT.lid = new THREE.MeshStandardMaterial({ color: 0x2a0b08, roughness: 0.5 });
    const HEAD_SPHERE = new THREE.SphereGeometry(1, 32, 24);

    const head = new THREE.Group();
    head.position.set(0.37, 0.122, 0);
    body.add(head);
    // Crâne sculpté d'une pièce : ovale allongé au sommet aplati, arcades sourcilières saillantes qui
    // surplombent les yeux, orbites creusées, joues pleines, nuque qui rejoint le cou
    const gauss = (x, y, z, cx, cy, cz, w) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (w * w));
    function skullR(d) {
      const az = Math.abs(d.z);
      const r = 1 / Math.hypot(d.x / (d.x >= 0 ? 0.104 : 0.084), d.y / (d.y >= 0 ? 0.066 : 0.06), az / 0.066);
      return r * (1 + 0.16 * gauss(d.x, d.y, az, 0.55, 0.52, 0.62, 0.26) // arcade sourcilière
        - 0.05 * gauss(d.x, d.y, az, 0.45, 0.06, 0.88, 0.22) // orbite
        + 0.08 * gauss(d.x, d.y, az, 0.15, -0.6, 0.75, 0.4) // joue
        + 0.12 * gauss(d.x, d.y, az, -0.82, -0.3, 0, 0.5) // nuque
        - 0.05 * gauss(d.x, d.y, az, 0.25, 0.97, 0, 0.35)); // sommet aplati
    }
    {
      const geo = new THREE.SphereGeometry(1, 72, 54), p = geo.attributes.position, d = new V3();
      for (let i = 0; i < p.count; i++) {
        d.fromBufferAttribute(p, i).normalize();
        const r = skullR(d);
        p.setXYZ(i, d.x * r, d.y * r, d.z * r);
      }
      geo.computeVertexNormals();
      head.add(new THREE.Mesh(geo, MAT.head));
    }
    // Bec de rapace : une coque lissée le long d'une ligne qui se recourbe en crochet, à section arrondie
    // (bombée dessus, plus plate dessous) ; cire jaune à la base, corne ambrée, pointe sombre.
    // f(t) → { x, y, h, w } le long du bec ; col(t) → couleur ; flip : section bombée dessous (mandibule)
    function beakLoft(f, col, flip, N = 44, M = 28) {
      const pos = [], cols = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, a = f(t), p = f(Math.max(0, t - 0.01)), q = f(Math.min(1, t + 0.01));
        let tx = q.x - p.x, ty = q.y - p.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const c = col(t);
        for (let j = 0; j <= M; j++) {
          const ph = (j / M) * TAU, cs = Math.cos(ph), sn = flip ? -Math.sin(ph) : Math.sin(ph);
          let up = sn >= 0 ? Math.pow(sn, 0.8) : -Math.pow(-sn, 1.4) * 0.75;
          if (flip) up = -up;
          const yy = (up * a.h) / 2, zz = (Math.sign(cs) * Math.pow(Math.abs(cs), 0.8) * a.w) / 2;
          pos.push(a.x - ty * yy, a.y + tx * yy, zz);
          cols.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
          const k = i * (M + 1) + j, l = k + M + 1;
          if (flip) idx.push(k, k + 1, l, l, k + 1, l + 1); else idx.push(k, l, k + 1, l, l + 1, k + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, MAT.beak);
    }
    const BEAK_COL = [[0, '#ffcf5a'], [0.11, '#ffd96e'], [0.16, '#f4dca0'], [0.55, '#e0a03a'], [0.8, '#5a2a10'], [1, '#2a1208']].map(([t, h]) => [t, new THREE.Color(h)]);
    const beakColor = (stops) => (t) => {
      let j = 1;
      while (j < stops.length - 1 && stops[j][0] < t) j++;
      return stops[j - 1][1].clone().lerp(stops[j][1], clamp((t - stops[j - 1][0]) / (stops[j][0] - stops[j - 1][0]), 0, 1));
    };
    head.add(beakLoft((t) => {
      const hook = Math.pow(smooth((t - 0.45) / 0.55), 1.5), end = smooth((t - 0.7) / 0.3);
      return { x: 0.068 + 0.145 * t - 0.014 * end, y: 0.008 + 0.004 * t - 0.062 * hook, h: 0.062 * (1 - 0.7 * t) * (1 - 0.85 * end) + 0.002, w: 0.054 * (1 - 0.7 * t) * (1 - 0.85 * end) + 0.002 };
    }, beakColor(BEAK_COL), false));
    for (const s of [-1, 1]) { // narines, dans la cire
      const nostril = new THREE.Mesh(HEAD_SPHERE, MAT.lid);
      nostril.scale.set(0.007, 0.004, 0.003);
      nostril.position.set(0.086, 0.019, 0.022 * s);
      head.add(nostril);
    }
    // Mandibule, montée sur une articulation pour s'ouvrir
    const jaw = new THREE.Group();
    jaw.position.set(0.078, -0.022, 0);
    jaw.add(beakLoft((t) => ({ x: -0.006 + 0.104 * t, y: -0.004 - 0.004 * t - 0.006 * t * t, h: 0.026 * (1 - 0.75 * t) + 0.002, w: 0.046 * (1 - 0.7 * t) + 0.002 }),
      beakColor([[0, '#f2d79a'], [0.6, '#d29032'], [1, '#4a220c']].map(([t, h]) => [t, new THREE.Color(h)])), true));
    head.add(jaw);

    // Yeux de rapace, logés sous l'arcade : iris doré aux fibres rayonnantes, pupille noire,
    // paupière sombre, et une cornée bombée qui ne fait qu'ajouter les reflets (l'œil « vit »)
    const irisNoise = valueNoise();
    const irisTex = texPair(128, 128, (x, y, o) => {
      const n = irisNoise, dx = (x - 63.5) / 60, dy = (y - 63.5) / 60, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const fib = n(ang * 14 + 40, d * 5) * 0.6 + n(ang * 40 + 9, d * 12) * 0.4;
      let c;
      if (d < 0.36) c = [10, 5, 5];
      else if (d < 0.9) {
        const k = (d - 0.36) / 0.54;
        c = [lerp(255, 226, k), lerp(206, 112, k), lerp(70, 18, k)];
        const f = 0.72 + 0.5 * fib - 0.25 * smooth((0.46 - d) / 0.1) - 0.45 * smooth((d - 0.8) / 0.1);
        c = c.map((v) => v * f);
      } else c = [44, 12, 8];
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 255;
    });
    MAT.iris = new THREE.MeshStandardMaterial({ map: irisTex.map, emissiveMap: irisTex.map, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.4 });
    MAT.cornea = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const eyes = [];
    const eyeDir = new V3(0.45, 0.06, 0.88).normalize();
    for (const s of [-1, 1]) {
      const dE = eyeDir.clone().setZ(eyeDir.z * s);
      const e = new THREE.Group();
      e.position.copy(dE).multiplyScalar(skullR(dE) - 0.001);
      e.quaternion.setFromUnitVectors(new V3(0, 0, 1), dE);
      const iris = new THREE.Mesh(new THREE.CircleGeometry(0.02, 40), MAT.iris);
      const lid = new THREE.Mesh(new THREE.TorusGeometry(0.0208, 0.0042, 10, 40), MAT.lid);
      lid.position.z = 0.0008;
      const cornea = new THREE.Mesh(new THREE.SphereGeometry(0.029, 28, 10, 0, TAU, 0, 0.76), MAT.cornea);
      cornea.rotation.x = Math.PI / 2;
      cornea.position.z = -0.029 * Math.cos(0.76);
      e.add(iris, lid, cornea);
      head.add(e);
      eyes.push(e);
    }

    // Plumage de la tête : des centaines de petites plumes couchées vers la nuque, qui suivent le
    // crâne ; cramoisi sur le dessus, or sur la face, sombre sur l'arcade et en trait derrière l'œil.
    // Le front reste lisse : c'est là qu'est gravé le M.
    const M_DIR = new V3(0.64, 0.77, 0).normalize(), M_UP = new V3(-M_DIR.y, M_DIR.x, 0), M_SIDE = new V3(0, 0, 1);
    {
      const items = [], N = 300, golden = Math.PI * (3 - Math.sqrt(5)), d = new V3(), tip = new V3(), nrm = new V3();
      const brow = new V3(0.55, 0.52, 0.62).normalize(), stripe = new V3(-0.15, 0.08, 0.95).normalize();
      const crim = [0.95, 0.5, 0.44], gold = [1.08, 1.02, 0.86], dark = [0.62, 0.32, 0.27];
      for (let i = 0; i < N; i++) {
        const y = 1 - ((i + 0.5) / N) * 2, rr = Math.sqrt(1 - y * y), th = i * golden;
        d.set(Math.cos(th) * rr, y, Math.sin(th) * rr);
        if (d.x > 0.86 && Math.abs(d.y) < 0.4) continue; // base du bec
        if (d.y < -0.55 && d.x < 0.5) continue; // dessous : le cou et son camail
        const dz = new V3(d.x, d.y, Math.abs(d.z));
        if (dz.angleTo(eyeDir) < 0.36) continue; // l'œil
        const mc = d.dot(M_DIR);
        if (mc > 0 && (Math.atan2(d.dot(M_SIDE), mc) / 0.52) ** 2 + (Math.atan2(d.dot(M_UP), mc) / 0.44) ** 2 < 1) continue; // le M
        const r = skullR(d), back = smooth((0.6 - d.x) / 1.2);
        let L = 0.042 + 0.03 * back;
        // couleur selon la région
        const up = smooth((d.y + 0.2) / 0.8);
        let tint = [lerp(gold[0], crim[0], up), lerp(gold[1], crim[1], up), lerp(gold[2], crim[2], up)];
        const kb = smooth(1 - dz.angleTo(brow) / 0.32), ks = smooth(1 - dz.angleTo(stripe) / 0.34);
        if (kb > 0) { L *= 1 + 0.25 * kb; tint = tint.map((v, j) => lerp(v, dark[j] * 1.2, kb * 0.8)); }
        if (ks > 0) tint = tint.map((v, j) => lerp(v, dark[j], ks));
        // pointe vers la nuque, couchée sur la courbure du crâne
        tip.set(-1, 0, 0).addScaledVector(d, d.x);
        if (tip.lengthSq() < 0.04) tip.set(0, -1, 0).addScaledVector(d, -d.y);
        tip.normalize();
        const tilt = Math.atan(L / (2 * r));
        nrm.copy(d).multiplyScalar(Math.cos(tilt)).addScaledVector(tip, -Math.sin(tilt));
        tip.multiplyScalar(Math.cos(tilt)).addScaledVector(d, -Math.sin(tilt));
        const X = tip.clone().negate(), Y = nrm.clone(), Z = new V3().crossVectors(X, Y);
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
        items.push({ L, w: 0.036 + 0.01 * back, bend: 0, flex: 0.3, pos: d.clone().multiplyScalar(r * 0.985), q, tint });
      }
      head.add(mergeFeathers(items, MAT.headFeather));
    }

    // M gravé sur le front : une incision sombre, incrustée d'or en fusion. C'est un décalque
    // qui épouse le crâne (même forme, à peine plus grande).
    const mTex = canvasTex(256, 256, (g) => {
      const M = new Path2D('M 46 222 L 62 46 L 128 156 L 194 46 L 210 222');
      g.lineJoin = 'miter';
      g.miterLimit = 3;
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(255,214,150,0.55)'; // arête éclairée
      g.lineWidth = 42;
      g.translate(3, 4); g.stroke(M); g.translate(-3, -4);
      g.strokeStyle = 'rgba(52,6,4,0.95)'; // creux de la gravure
      g.lineWidth = 40;
      g.stroke(M);
      const gold = g.createLinearGradient(0, 40, 0, 225);
      gold.addColorStop(0, '#fff3c4');
      gold.addColorStop(0.5, '#ffc94a');
      gold.addColorStop(1, '#ff9a1e');
      g.strokeStyle = gold; // incrustation
      g.lineWidth = 17;
      g.stroke(M);
    });
    MAT.mark = new THREE.MeshStandardMaterial({
      map: mTex, emissiveMap: mTex, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.3, metalness: 0.2,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    {
      const c = M_DIR, up = M_UP, side = M_SIDE;
      const G = 10, pos = [], uv = [], idx = [], d = new V3();
      for (let j = 0; j <= G; j++) {
        for (let i = 0; i <= G; i++) {
          const a = i / G * 2 - 1, b = j / G * 2 - 1;
          d.copy(c).addScaledVector(side, a * 0.62).addScaledVector(up, b * 0.5).normalize();
          d.multiplyScalar(skullR(d) * 1.012);
          pos.push(d.x, d.y, d.z);
          uv.push(i / G, j / G);
          if (i < G && j < G) { const q = j * (G + 1) + i; idx.push(q, q + G + 1, q + 1, q + 1, q + G + 1, q + G + 2); } // face tournée vers l'extérieur
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mark = new THREE.Mesh(geo, MAT.mark);
      mark.renderOrder = 1;
      head.add(mark);
    }

    // Aigrette : longues plumes couchées vers l'arrière, comme une crinière qui flotte
    const crest = [];
    for (let i = 0; i < 9; i++) {
      const k = (i - 4) / 4;
      const L = 0.4 - Math.abs(k) * 0.12;
      const m = featherMesh(MAT.crest, L, 0.085, 0.32, 1.3);
      m.position.set(-0.02, 0.055 - Math.abs(k) * 0.012, k * 0.04);
      m.rotation.order = 'ZYX';
      m.rotation.set(1.35 + k * 0.2, k * 0.22, -(0.16 + 0.1 * Math.abs(k)));
      head.add(m);
      crest.push({ m, k, base: m.rotation.z });
    }

    // Ailes : épaule → coude → poignet, avec rémiges, couvertures et os recouverts de plumes
    function buildWing(side) {
      const root = new THREE.Group();
      root.userData.side = side;
      root.position.set(0.1, 0.075, 0.085 * side);
      if (side < 0) root.scale.z = -1;
      const shoulder = new THREE.Group();
      const elbow = new THREE.Group();
      const wrist = new THREE.Group();
      root.add(shoulder);
      shoulder.add(elbow);
      elbow.add(wrist);
      elbow.position.z = 0.27;
      wrist.position.z = 0.31;
      const bone = (parent, len, r) => {
        const m = new THREE.Mesh(BODY_SPHERE, MAT.body);
        m.scale.set(r * 1.4, r, len / 2);
        m.position.set(0.012, 0, len / 2);
        parent.add(m);
      };
      bone(shoulder, 0.3, 0.02);
      bone(elbow, 0.34, 0.016);
      bone(wrist, 0.26, 0.012);
      const feathers = [], tips = [];
      const rows = new Map(); // couvertures : regroupées par os et par matière, dessinées en un seul objet
      const add = (group, mat, L, w, x, y, z, ext, fold, bend, flex) => {
        if (mat === MAT.covert || mat === MAT.bodyCovert) {
          const key = group.uuid + mat.uuid;
          if (!rows.has(key)) rows.set(key, { group, mat: mat === MAT.covert ? MAT.covertW : MAT.bodyCovertW, items: [] });
          rows.get(key).items.push({ L, w, x, y, z, ext, fold, bend, flex });
          return null;
        }
        const m = featherMesh(mat, L, w, bend, flex);
        m.position.set(x, y, z);
        group.add(m);
        feathers.push({ m, ext, fold, j: feathers.length });
        return m;
      };
      // Rémiges primaires, sur la main
      for (let i = 0; i < 10; i++) {
        const r = i / 9;
        const L = lerp(0.42, 0.6, r) * (i === 9 ? 0.92 : 1);
        const m = add(wrist, MAT.primary, L, 0.085, 0, 0.0014 * (10 - i), 0.02 + i * 0.026, lerp(0.42, 1.42, r ** 0.9), 1.5, 0.1, 1);
        if (i >= 5) tips.push(anchor(m, -L, 0, 0, 0.8));
        if (i % 2 === 1) flameAt(m, -L * 0.85, 0, 0, 0.85, 0.2);
      }
      // Rémiges secondaires, sur l'avant-bras
      for (let i = 0; i < 12; i++) {
        const r = i / 11;
        const sec = add(elbow, MAT.secondary, 0.34, 0.1, -0.005, 0.016 + 0.0013 * (12 - i), 0.012 + i * 0.026, lerp(0.05, 0.38, r), -1.45, 0.06, 0.8);
        if (i % 3 === 1) flameAt(sec, -0.3, 0, 0, 0.9, 0.17);
      }
      // Tertiaires, près du corps
      for (let i = 0; i < 4; i++) add(shoulder, MAT.secondary, 0.3, 0.1, -0.01, 0.034 + 0.0013 * i, 0.05 + i * 0.055, -0.12, 0.55, 0.05, 0.7);
      // Grandes couvertures
      for (let i = 0; i < 9; i++) add(elbow, MAT.covert, 0.18, 0.08, 0.03, 0.05 + 0.001 * i, 0.02 + i * 0.033, lerp(0.05, 0.38, i / 8), -1.45, 0.08, 0.5);
      for (let i = 0; i < 6; i++) add(wrist, MAT.covert, 0.17, 0.07, 0.025, 0.05 + 0.001 * i, 0.02 + i * 0.04, lerp(0.45, 1.3, i / 5), 1.5, 0.08, 0.5);
      // Petites couvertures et plumes du bord d'attaque : deux rangs serrés de plumes douces qui se chevauchent
      for (let i = 0; i < 15; i++) {
        add(elbow, MAT.bodyCovert, rand(0.1, 0.125), 0.07, 0.06, 0.062 + 0.0008 * i, 0.01 + i * 0.021, 0.2, -1.4, 0.08, 0.35);
        add(elbow, MAT.bodyCovert, rand(0.07, 0.09), 0.06, 0.08, 0.072 + 0.0008 * i, 0.02 + i * 0.021, 0.2, -1.4, 0.06, 0.3);
      }
      for (let i = 0; i < 8; i++) {
        add(shoulder, MAT.bodyCovert, rand(0.11, 0.135), 0.075, 0.045, 0.066 + 0.0008 * i, 0.03 + i * 0.034, -0.05, 0.5, 0.08, 0.35);
        add(shoulder, MAT.bodyCovert, rand(0.08, 0.1), 0.065, 0.065, 0.076 + 0.0008 * i, 0.045 + i * 0.034, -0.05, 0.5, 0.06, 0.3);
      }
      // Le bord d'attaque est emplumé tout autour de l'os : rang sur la main, rangs sous l'aile
      for (let i = 0; i < 10; i++) add(wrist, MAT.bodyCovert, rand(0.07, 0.09), 0.06, 0.05, 0.04 + 0.0008 * i, 0.01 + i * 0.025, lerp(0.45, 1.2, i / 9), 1.5, 0.06, 0.3);
      for (let i = 0; i < 15; i++) add(elbow, MAT.bodyCovert, rand(0.09, 0.11), 0.065, 0.06, -0.02 - 0.0008 * i, 0.015 + i * 0.021, 0.2, -1.4, -0.06, 0.3);
      for (let i = 0; i < 15; i++) add(elbow, MAT.bodyCovert, rand(0.06, 0.075), 0.055, 0.07, 0.028 + 0.0008 * i, 0.02 + i * 0.021, 0.2, -1.4, 0.02, 0.25);
      for (let i = 0; i < 8; i++) add(shoulder, MAT.bodyCovert, rand(0.07, 0.085), 0.06, 0.06, 0.03 + 0.0008 * i, 0.05 + i * 0.034, -0.05, 0.5, 0.02, 0.25);
      for (let i = 0; i < 8; i++) add(shoulder, MAT.bodyCovert, rand(0.1, 0.12), 0.07, 0.05, -0.024 - 0.0008 * i, 0.04 + i * 0.034, -0.05, 0.5, -0.06, 0.3);
      for (let i = 0; i < 8; i++) add(wrist, MAT.bodyCovert, rand(0.06, 0.08), 0.055, 0.045, -0.016 - 0.0008 * i, 0.015 + i * 0.028, lerp(0.45, 1.2, i / 7), 1.5, -0.05, 0.3);
      tips.push(anchor(wrist, 0, 0, 0.26, 0.9));
      for (const r of rows.values()) r.group.add(wingRow(r.items, r.mat));
      return { root, shoulder, elbow, wrist, feathers, tips };
    }
    const wings = [buildWing(1), buildWing(-1)];
    for (const w of wings) { body.add(w.root); anchors.push(...w.tips); }

    // Queue : rectrices en éventail, souples comme les autres plumes,
    // et trois longues plumes simulées (voir updatePlumes).
    const tail = new THREE.Group();
    tail.position.set(-0.25, -0.005, 0);
    body.add(tail);
    const tailFeathers = [];
    for (let i = 0; i < 12; i++) {
      const k = (i - 5.5) / 5.5;
      const L = 0.6 + 0.2 * (1 - Math.abs(k));
      const m = featherMesh(MAT.tail, L, 0.12, -0.04);
      m.position.set(0, 0.0013 * (6 - Math.abs(i - 5.5)), 0);
      tail.add(m);
      tailFeathers.push({ m, k, i });
      anchors.push(anchor(m, -L, 0, 0, 0.75));
      if (i % 3 === 1) flameAt(m, -L * 0.8, 0, 0, 0.8, 0.22);
    }
    // Longues plumes : un squelette « au repos » accroché à la queue sert de cible ; une chaîne simulée
    // (inertie, ressorts plus souples vers le bout, gravité, résistance de l'air) le suit avec du retard,
    // et la plume est un ruban reconstruit à chaque image le long de cette chaîne.
    const loose = new THREE.Group(); // repères placés directement dans la scène
    const plumes = [];
    const PSEG = 8;
    for (const j of [-1, 0, 1]) {
      const segs = [];
      let parent = tail;
      const SL = (0.34 + (j ? 0 : 0.06)) * 4 / PSEG;
      for (let i = 0; i < PSEG; i++) {
        const g = new THREE.Group();
        if (i) g.position.x = -SL;
        else g.position.set(-0.05, 0.012, j * 0.03);
        parent.add(g);
        segs.push(g);
        parent = g;
      }
      const tip = new THREE.Object3D();
      tip.position.x = -SL;
      parent.add(tip);
      const N = PSEG + 1;
      const geo = new THREE.BufferGeometry();
      const uv = new Float32Array(N * 4), idx = [];
      for (let i = 0; i < N; i++) {
        uv.set([1 - i / PSEG, 0, 1 - i / PSEG, 1], i * 4);
        if (i < PSEG) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, MAT.plume);
      mesh.frustumCulled = false;
      const tipFx = anchor(loose, 0, 0, 0, 0.7);
      anchors.push(tipFx);
      const flame = flameAt(loose, 0, 0, 0, 0.75, 0.24);
      const vecs = () => Array.from({ length: N }, () => new V3());
      plumes.push({ segs, tip, j, SL, mesh, geo, tipFx, flame, vane: 1.25 + j * 0.15, p: vecs(), v: vecs(), tgt: vecs(), prev: vecs(), ready: false });
    }

    // Pattes : cuisse emplumée, tarse écailleux, doigts et serres
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.03, -0.075, 0.055 * s);
      body.add(hip);
      const thigh = new THREE.Mesh(BODY_SPHERE, MAT.body);
      thigh.scale.set(0.036, 0.056, 0.028);
      thigh.position.set(-0.015, -0.025, -0.012 * s);
      hip.add(thigh);
      // Culotte : deux rangs de plumes douces qui enveloppent la cuisse et retombent sur le tarse
      const pants = [];
      for (let i = 0; i < 7; i++) {
        const a = -1.2 + i * 0.4;
        pants.push({ L: rand(0.14, 0.17), w: 0.07, bend: 0.1, flex: 0.7, pos: new V3(0.012, 0.015, Math.sin(a) * 0.036), rot: new THREE.Euler(Math.PI / 2 + a * 0.6, 0, Math.PI / 2 - 0.12, 'ZYX') });
      }
      for (let i = 0; i < 5; i++) {
        const a = -1 + i * 0.5;
        pants.push({ L: rand(0.11, 0.13), w: 0.065, bend: 0.1, flex: 0.6, pos: new V3(0.004, -0.03, Math.sin(a) * 0.03), rot: new THREE.Euler(Math.PI / 2 + a * 0.6, 0, Math.PI / 2 - 0.08, 'ZYX') });
      }
      hip.add(mergeFeathers(pants, MAT.bodyCovert));
      const shin = new THREE.Group();
      shin.position.set(0, -0.11, 0);
      hip.add(shin);
      const tarsus = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.16, 10), MAT.leg);
      tarsus.position.y = -0.08;
      shin.add(tarsus);
      const foot = new THREE.Group();
      foot.position.y = -0.16;
      shin.add(foot);
      const toes = [];
      for (const [yaw, len] of [[0.35, 0.07], [0, 0.08], [-0.35, 0.07], [Math.PI, 0.055]]) {
        const toe = new THREE.Group();
        toe.rotation.y = yaw;
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, len, 8), MAT.leg);
        bone.rotation.z = -Math.PI / 2;
        bone.position.x = len / 2;
        const talon = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.04, 8), MAT.talon);
        talon.position.set(len + 0.008, -0.012, 0);
        talon.rotation.z = -2.4;
        toe.add(bone, talon);
        foot.add(toe);
        toes.push(toe);
      }
      legs.push({ hip, shin, foot, toes });
    }
    const footMark = anchor(legs[0].foot, 0, -0.012, 0, 0);
    const centerMark = anchor(body, 0.06, 0.05, 0, 0);

    /* ---------- Scène, caméra, lumières ---------- */
    let W = window.innerWidth, H = window.innerHeight, S = 80, D = 1000, quality = 1, workEma = 8;
    const FOV = 30;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;';
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 40000);
    const scene = new THREE.Scene();
    const glowScene = new THREE.Scene();
    scene.add(bird);
    scene.add(loose);
    for (const p of plumes) scene.add(p.mesh);
    scene.add(new THREE.HemisphereLight(0xfff2dc, 0x6a1c12, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
    key.position.set(-0.6, 1, 0.9);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9a40, 1.6);
    rim.position.set(0.5, 0.25, -1);
    scene.add(rim);
    // Lumière d'ambiance : un ciel chaud et diffus avec une grande source douce en haut à gauche, dont
    // les plumes renvoient des reflets veloutés (éclairage par image, calculé sur place, sans fichier)
    {
      const env = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 32, 16), pos = geo.attributes.position, cols = [];
      const top = new THREE.Color(1.05, 0.98, 0.9), mid = new THREE.Color(0.95, 0.72, 0.5), low = new THREE.Color(0.22, 0.08, 0.06), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 10;
        c.copy(mid).lerp(y > 0 ? top : low, Math.abs(y));
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
      const soft = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 4.1), side: THREE.DoubleSide }));
      soft.position.set(-4.5, 6, 5);
      soft.lookAt(0, 0, 0);
      env.add(soft);
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(env, 0.03).texture;
      scene.environmentIntensity = 0.35;
      pm.dispose();
    }
    renderer.toneMapping = THREE.NeutralToneMapping; // hautes lumières adoucies, couleurs préservées
    renderer.toneMappingExposure = 1;

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.4 }));
    glowScene.add(glow);

    /* ---------- Feu ---------- */
    // Les flammes ne sont pas dessinées une à une (ce qui donne des gouttes) : chaque particule dépose
    // une densité floue dans une image à basse résolution, puis un shader transforme ce champ en feu —
    // bruit fractal qui monte, contours déchirés en langues, cœur jaune, bords rouges translucides.
    const RAMP = [[0, [0.42, 0.06, 0.1]], [0.25, [0.76, 0.14, 0.1]], [0.45, [0.93, 0.33, 0.11]], [0.65, [0.99, 0.54, 0.15]], [0.82, [1, 0.73, 0.25]], [1, [1, 0.88, 0.47]]];
    function rampColor(k, out) {
      for (let j = 1; j < RAMP.length; j++) {
        if (k <= RAMP[j][0]) {
          const [k0, c0] = RAMP[j - 1], [k1, c1] = RAMP[j], f = (k - k0) / (k1 - k0);
          out[0] = lerp(c0[0], c1[0], f); out[1] = lerp(c0[1], c1[1], f); out[2] = lerp(c0[2], c1[2], f);
          return out;
        }
      }
      out[0] = 1; out[1] = 0.88; out[2] = 0.47;
      return out;
    }
    const FIRE_GLSL = `
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; }
        return v;
      }
      vec3 fireColor(float k) {
        vec3 a = vec3(0.62, 0.07, 0.03), b = vec3(0.95, 0.27, 0.04), c = vec3(1.0, 0.55, 0.08), d = vec3(1.0, 0.78, 0.26), e = vec3(1.0, 0.92, 0.55);
        return k < 0.3 ? mix(a, b, k / 0.3) : k < 0.6 ? mix(b, c, (k - 0.3) / 0.3) : k < 0.85 ? mix(c, d, (k - 0.6) / 0.25) : mix(d, e, (k - 0.85) / 0.15);
      }`;
    // Couleurs prémultipliées, mélange « par-dessus » ; ou additif pour accumuler la densité
    const BLEND = {
      transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    };
    const ADD = {
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    };
    const FULL_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const pointsVS = `
      attribute float size; attribute float alpha; attribute vec3 color; attribute float pkind; attribute float pheat;
      varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vHeat;
      uniform float scale; uniform float maxSize;
      void main() {
        vColor = color; vAlpha = alpha; vKind = pkind; vHeat = pheat;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(maxSize, size * scale / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`;
    // Densité d'une particule : tache floue, plus haute que large, plus dense vers le bas
    const densFS = `
      varying float vAlpha; varying float vKind; varying float vHeat;
      void main() {
        if (vKind > 0.5) discard;
        vec2 c = gl_PointCoord - vec2(0.5, 0.56);
        float d = exp(-c.x * c.x / 0.036 - c.y * c.y / 0.055) * vAlpha;
        gl_FragColor = vec4(d, d * vHeat, 0.0, d);
      }`;
    // Braises : point incandescent cerné d'un halo orangé
    const sparkFS = `
      varying vec3 vColor; varying float vAlpha; varying float vKind;
      void main() {
        if (vKind < 0.5) discard;
        float r = length(gl_PointCoord - 0.5);
        float core = 1.0 - smoothstep(0.08, 0.2, r), halo = 1.0 - smoothstep(0.12, 0.5, r);
        float a = (core + halo * halo * 0.5 * (1.0 - core)) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vColor, vec3(1.0, 0.97, 0.82), core) * a, a);
      }`;
    const smokeFS = `
      uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        float a = t.a * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * t.rgb * a, a);
      }`;
    function makePool(max) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
      const pkind = new Float32Array(max), pheat = new Float32Array(max);
      const attr = (name, arr, n) => geo.setAttribute(name, new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage));
      attr('position', pos, 3); attr('color', col, 3); attr('size', size, 1); attr('alpha', alpha, 1); attr('pkind', pkind, 1); attr('pheat', pheat, 1);
      return {
        max, n: 0, geo, mats: [], pos, col, size, alpha, pkind, pheat,
        vx: new Float32Array(max), vy: new Float32Array(max), vz: new Float32Array(max),
        life: new Float32Array(max), maxLife: new Float32Array(max), s0: new Float32Array(max), heat: new Float32Array(max), kind: new Uint8Array(max), seed: new Float32Array(max),
      };
    }
    function drawPool(pool, fs, blend, target, tex) {
      const mat = new THREE.ShaderMaterial(Object.assign({
        uniforms: { map: { value: tex || null }, scale: { value: 1 }, maxSize: { value: 256 } },
        vertexShader: pointsVS, fragmentShader: fs,
      }, blend));
      const pts = new THREE.Points(pool.geo, mat);
      pts.frustumCulled = false;
      target.add(pts);
      pool.mats.push(mat);
      return mat;
    }
    const densScene = new THREE.Scene(), backScene = new THREE.Scene();
    const fire = makePool(2600), smoke = makePool(200);
    const densMat = drawPool(fire, densFS, ADD, densScene);
    const sparkMat = drawPool(fire, sparkFS, BLEND, scene);
    const smokeMat = drawPool(smoke, smokeFS, BLEND, backScene, smokeTex);
    const FLAME = 0, SPARK = 1;

    // Flammes accrochées aux plumes : des traînées de densité qui montent, que le shader déchire
    const FL_MAX = 72;
    const flGeo = new THREE.InstancedBufferGeometry();
    {
      const quad = new THREE.PlaneGeometry(1, 1);
      flGeo.index = quad.index;
      flGeo.setAttribute('position', quad.attributes.position);
      flGeo.setAttribute('uv', quad.attributes.uv);
    }
    const flPos = new THREE.InstancedBufferAttribute(new Float32Array(FL_MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const flData = new THREE.InstancedBufferAttribute(new Float32Array(FL_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    flGeo.setAttribute('iPos', flPos);
    flGeo.setAttribute('iData', flData);
    flGeo.instanceCount = 0;
    const flMat = new THREE.ShaderMaterial(Object.assign({
      vertexShader: `
        attribute vec3 iPos; attribute vec4 iData;
        varying vec2 vUv; varying float vInt;
        void main() {
          vUv = uv; vInt = iData.w;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          mv.xy += vec2(position.x * iData.x, (position.y + 0.38) * iData.x * iData.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vInt;
        void main() {
          float w = 0.19 * pow(max(0.0, 1.0 - vUv.y), 0.55) + 0.015;
          float x = vUv.x - 0.5;
          float d = exp(-x * x / (w * w)) * smoothstep(0.0, 0.16, vUv.y) * pow(max(0.0, 1.0 - vUv.y), 1.2) * vInt;
          gl_FragColor = vec4(d, d * min(1.0, 0.7 + 0.3 * vInt), 0.0, d);
        }`,
    }, ADD));
    const flMesh = new THREE.Mesh(flGeo, flMat);
    flMesh.frustumCulled = false;
    densScene.add(flMesh);
    let fireBoost = 1, fireUnit = 40, shake = 0;
    function updateAttachedFlames() {
      if (!st.visible || reduce.matches) { flGeo.instanceCount = 0; return; }
      const list = flameAnchors;
      const n = Math.min(FL_MAX, list.length);
      for (let i = 0; i < n; i++) {
        const a = list[i];
        a.getWorldPosition(tmpV);
        const flick = 0.8 + 0.25 * Math.sin(time * 9 + i * 1.7) + 0.15 * Math.sin(time * 23 + i * 3.1);
        flPos.array[i * 3] = tmpV.x;
        flPos.array[i * 3 + 1] = tmpV.y;
        flPos.array[i * 3 + 2] = tmpV.z;
        flData.array[i * 4] = S * a.userData.size * flick * fireBoost;
        flData.array[i * 4 + 1] = 2 + 0.5 * Math.sin(time * 5 + i);
        flData.array[i * 4 + 2] = 0;
        flData.array[i * 4 + 3] = clamp(a.userData.heat * (0.75 + 0.25 * fireBoost), 0, 1.5);
      }
      flGeo.instanceCount = n;
      flPos.needsUpdate = true;
      flData.needsUpdate = true;
    }

    // Image de densité (résolution CSS) → image du feu (résolution de l'écran) → plaquée sur l'écran
    const rtOpts = { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const densRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    const fireRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    const fxRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    const fsScene = new THREE.Scene();
    const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    fsQuad.frustumCulled = false;
    fsScene.add(fsQuad);
    const compMat = new THREE.ShaderMaterial({
      uniforms: { dens: { value: densRT.texture }, time: { value: 0 }, px: { value: new THREE.Vector2(1, 1) }, unit: { value: 40 } },
      vertexShader: FULL_VS,
      fragmentShader: FIRE_GLSL + `
        uniform sampler2D dens; uniform float time; uniform vec2 px; uniform float unit; varying vec2 vUv;
        void main() {
          vec2 q = vUv * px / unit;
          vec2 qa = vec2(q.x * 1.8, q.y * 0.7); // bruit étiré en hauteur : des langues, pas des taches
          float n1 = fbm(qa + vec2(0.0, -time * 1.3));
          float n2 = fbm(qa * 2.1 + vec2(5.2, -time * 3.0));
          vec2 o = unit / px; // une « taille de flamme » en coordonnées d'image
          // On lit la densité plus bas, d'un pas qui varie avec le bruit : le feu s'étire vers le haut
          vec2 lift = vec2((n1 - 0.5) * 0.45, -0.12 - 0.75 * n2) * o;
          vec2 s0 = texture2D(dens, vUv + vec2((n2 - 0.5) * 0.25 * o.x, 0.0)).rg;
          vec2 s1 = texture2D(dens, vUv + lift).rg;
          vec2 s2 = texture2D(dens, vUv + lift * 2.2).rg;
          float d = max(s0.x, max(s1.x * 0.8, s2.x * 0.55));
          float heat = (s0.y + s1.y + s2.y) / max(1e-3, s0.x + s1.x + s2.x);
          float tn = n2 * 0.65 + n1 * 0.35;
          float I = d * (0.3 + 1.25 * tn) - 0.15;
          // Bords nets ; les flammes qui refroidissent s'effacent au lieu de virer au rouge sombre
          float a = smoothstep(0.0, 0.24, I) * 0.93 * (0.3 + 0.7 * smoothstep(0.12, 0.5, heat));
          // Halo de chaleur autour des flammes
          vec2 h = o * 0.8;
          float g = 0.25 * (texture2D(dens, vUv + vec2(h.x, 0.0)).r + texture2D(dens, vUv - vec2(h.x, 0.0)).r
                          + texture2D(dens, vUv + vec2(0.0, h.y)).r + texture2D(dens, vUv - vec2(0.0, h.y)).r);
          float ga = min(0.22, g * 0.35) * (1.0 - a);
          // La couleur suit aussi la densité alentour : bords orangés, pas de liseré sombre
          vec3 col = fireColor(clamp(I * 0.6 + g * 0.6 + (heat - 0.6) * 0.3 - (1.0 - tn) * 0.3 + 0.08, 0.28, 0.93));
          float A = a + ga;
          if (A < 0.003) discard;
          gl_FragColor = vec4(col * a + vec3(1.0, 0.45, 0.1) * ga, A);
        }`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const blitMat = new THREE.ShaderMaterial(Object.assign({
      uniforms: { map: { value: null } },
      vertexShader: FULL_VS,
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }',
    }, BLEND, { depthTest: false }));
    // Traversée de l'écran : flash, onde de choc, puis un anneau de feu part du point d'impact et balaie
    // l'écran en un instant, laissant derrière lui un liseré de braises qui s'éteint. La page reste lisible.
    const impactMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, k: { value: -1 }, aspect: { value: 1 }, shake: { value: new THREE.Vector2() } },
      vertexShader: FULL_VS,
      fragmentShader: FIRE_GLSL + `
        uniform float time; uniform float k; uniform float aspect; uniform vec2 shake; varying vec2 vUv;
        vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
        void main() {
          vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5) + shake;
          vec2 qa = vec2(p.x * 7.0, p.y * 2.6);
          float n1 = fbm(qa + vec2(0.0, -time * 1.6));
          float n2 = fbm(qa * 2.1 + vec2(4.0, -time * 3.6));
          float tn = n2 * 0.6 + n1 * 0.4;
          float r = length(p);
          float n = fbm(p * 2.4 + vec2(0.0, -time * 1.2));
          float rr = r + (n - 0.5) * 0.4 + (n2 - 0.5) * 0.12;
          float Ro = 2.0 * (1.0 - exp(-k * 2.6));       // bord extérieur de l'anneau
          float Ri = Ro - 0.08 - 0.3 * exp(-k * 3.0);    // bord intérieur : la page réapparaît derrière
          float fade = 1.0 - smoothstep(0.35, 0.75, k);
          float ringF = smoothstep(Ro, Ro - 0.12, rr) * smoothstep(Ri - 0.04, Ri + 0.06, rr);
          float I = ringF * (0.35 + 1.1 * tn) * fade - 0.12;
          float a = smoothstep(0.0, 0.4, I) * 0.92;
          vec4 c = vec4(fireColor(clamp(I * 1.05, 0.0, 1.0)) * a, a);
          // Liseré de braises et trace roussie, juste derrière l'anneau
          float trail = smoothstep(0.03, 0.08, k) * fade;
          float charA = 0.4 * trail * smoothstep(Ri - 0.05, Ri - 0.005, rr) * step(rr, Ri);
          c = over(c, vec4(vec3(0.16, 0.05, 0.02) * charA, charA));
          float e = min(1.0, trail * exp(-pow((rr - Ri) / 0.013, 2.0)) * (0.6 + 0.5 * n2));
          c = over(vec4(vec3(1.0, 0.74, 0.28) * e, e), c);
          // Onde de choc et flash
          float R = k * 3.6;
          float ring = 0.75 * exp(-pow((r - R) / (0.02 + 0.06 * k), 2.0)) * (1.0 - smoothstep(0.0, 0.45, k));
          c = over(vec4(vec3(1.0, 0.9, 0.66) * ring, ring), c);
          float fa = 0.8 * exp(-k * 18.0) * (1.0 - 0.5 * smoothstep(0.0, 1.0, r));
          c = over(vec4(vec3(1.0, 0.96, 0.84) * fa, fa), c);
          if (c.a < 0.003) discard;
          gl_FragColor = c;
        }`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });

    function spawn(pool, kind, x, y, z, vx, vy, vz, life, s0, heat) {
      if (pool.n >= pool.max) return;
      const i = pool.n++;
      pool.pos[i * 3] = x; pool.pos[i * 3 + 1] = y; pool.pos[i * 3 + 2] = z;
      pool.vx[i] = vx; pool.vy[i] = vy; pool.vz[i] = vz;
      pool.life[i] = 0; pool.maxLife[i] = life; pool.s0[i] = s0; pool.heat[i] = heat; pool.kind[i] = kind; pool.seed[i] = Math.random() * TAU;
    }
    function movePart(p, from, to) {
      for (let k = 0; k < 3; k++) p.pos[to * 3 + k] = p.pos[from * 3 + k];
      p.vx[to] = p.vx[from]; p.vy[to] = p.vy[from]; p.vz[to] = p.vz[from];
      p.life[to] = p.life[from]; p.maxLife[to] = p.maxLife[from]; p.s0[to] = p.s0[from]; p.heat[to] = p.heat[from]; p.kind[to] = p.kind[from]; p.seed[to] = p.seed[from];
    }
    const tmpC = [0, 0, 0];
    function updatePool(p, dt, isSmoke) {
      const dragF = Math.exp(-2.1 * dt), dragS = Math.exp(-0.9 * dt);
      for (let i = 0; i < p.n; i++) {
        p.life[i] += dt;
        if (p.life[i] >= p.maxLife[i]) {
          const j = --p.n;
          if (i !== j) movePart(p, j, i);
          i--;
          continue;
        }
        const a = p.life[i] / p.maxLife[i];
        if (isSmoke) {
          p.vy[i] += 0.35 * S * dt;
          p.vx[i] *= dragS; p.vy[i] *= dragS; p.vz[i] *= dragS;
          p.size[i] = p.s0[i] * (1 + 1.6 * a);
          p.alpha[i] = 0.32 * (1 - a) * Math.min(1, a * 5);
          p.col[i * 3] = 0.5; p.col[i * 3 + 1] = 0.45; p.col[i * 3 + 2] = 0.44;
        } else if (p.kind[i] === FLAME) {
          p.vy[i] += 1.7 * S * dt;
          p.vx[i] += Math.sin(p.pos[i * 3 + 1] * 0.02 + time * 2.8 + p.seed[i]) * 0.6 * S * dt;
          p.vx[i] *= dragF; p.vy[i] *= dragF; p.vz[i] *= dragF;
          p.size[i] = p.s0[i] * (0.9 + 0.7 * a);
          p.alpha[i] = 0.34 * (1 - a) ** 1.2 * Math.min(1, a * 12);
          p.pheat[i] = p.heat[i] * (1 - a) ** 0.9;
        } else {
          p.vy[i] += 0.45 * S * dt;
          p.vx[i] *= dragS; p.vy[i] *= dragS; p.vz[i] *= dragS;
          p.size[i] = p.s0[i] * 2.6;
          p.alpha[i] = (1 - a) * (0.55 + 0.45 * Math.sin(time * 10 + p.seed[i] * 7));
          rampColor(1 - 0.4 * a, tmpC);
          p.col[i * 3] = tmpC[0]; p.col[i * 3 + 1] = tmpC[1]; p.col[i * 3 + 2] = tmpC[2];
        }
        p.pos[i * 3] += p.vx[i] * dt;
        p.pos[i * 3 + 1] += p.vy[i] * dt;
        p.pos[i * 3 + 2] += p.vz[i] * dt;
        p.pkind[i] = p.kind[i];
      }
      p.geo.setDrawRange(0, p.n);
      for (const k of ['position', 'color', 'size', 'alpha', 'pkind', 'pheat']) p.geo.attributes[k].needsUpdate = true;
    }

    /* ---------- État et comportement ---------- */
    const pointer = { x: -1e5, y: -1e5, moved: -1e5 };
    let time = 0, paused = false, hidden = false, raf = 0, last = 0;
    const st = {
      state: 'perch', pos: new V3(), vel: new V3(),
      yaw: -0.55, yawTarget: -0.55, yawRate: 0, pitch: 0.8, roll: 0, dir: 1,
      phase: 0, glide: 0, gliding: false, glideT: 0, beats: 6,
      fold: 1, legs: 1, tailSpread: 0.6, flap: 0, ext: 0, sweep: 0, upFold: 0,
      timer: 3.5, flyTime: 0, target: null, perch: null, lastPerch: null, lastCenter: -99,
      passT: 0, startle: 0, blinkT: 0, nextBlink: 2, stretch: 0, nextStretch: 6,
      headYaw: 0, headPitch: 0, beak: 0, visible: true, burstPos: new V3(), pillar: false,
      tailSw: { x: 0, vx: 0, y: 0, vy: 0, z: 0, vz: 0 }, prevVy: 0, prevPitch: 0.8,
      air: 0, wingBend: 0, prevFlap: 0, crestSw: { p: 0, v: 0 }, prevHeadPitch: 0, prevHeadYaw: 0,
    };
    const fxList = [];

    const toWorld = (px, py) => new V3(px - W / 2, H / 2 - py, 0);
    function perchRect(el) {
      if (el.matches(TEXTUAL)) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        if (b.width > 0) return b;
      }
      return el.getBoundingClientRect();
    }
    function perchable(el) {
      if (!el.isConnected || el === canvas || el === hit) return false;
      const r = perchRect(el);
      return r.width >= S * 0.8 && r.height > 4 && r.top > S * 1.4 && r.top < H - S * 0.3 && r.right > S && r.left < W - S;
    }
    function candidates() {
      let list;
      try { list = document.querySelectorAll(PERCHES); } catch (err) { return []; }
      return Array.from(list).filter(perchable);
    }
    function perchPoint(tg) {
      if (!tg.el) return toWorld(tg.px, tg.py);
      const r = perchRect(tg.el);
      const lo = Math.max(r.left + S * 0.3, S * 0.9), hi = Math.min(r.right - S * 0.3, W - S * 0.9);
      return toWorld(hi > lo ? lerp(lo, hi, tg.fx) : (r.left + r.right) / 2, r.top);
    }
    const FOOT_DROP = 0.42; // distance approximative du centre aux serres, posé (en tailles)

    function pickTarget() {
      const list = st.flyTime > 1.5 ? candidates().filter((el) => el !== st.lastPerch) : [];
      const r = Math.random();
      if (list.length && r < 0.5) {
        st.target = { el: list[(Math.random() * list.length) | 0], fx: rand(0.1, 0.9) };
      } else if (!reduce.matches && st.flyTime > 1.5 && time - st.lastCenter > 10 && r < 0.78) {
        st.target = { center: true, pass: Math.random() < 0.5 };
      } else {
        st.target = { w: new V3(rand(-0.5, 0.5) * (W - 2.4 * S), rand(-0.5, 0.5) * (H - 3.2 * S), 0) };
      }
    }
    function targetWorld(tg) {
      if (tg.center) return new V3(0, 0, 0);
      if (tg.w) return tg.w;
      const p = perchPoint(tg);
      p.y += FOOT_DROP * S;
      return p;
    }

    // Demi-tour : il pivote en passant de face (ou parfois de dos), en s'inclinant dans le virage.
    function setHeading(dir) {
      if (dir === st.dir) return;
      st.dir = dir;
      // cap ramené entre -π et π
      st.yaw = Math.atan2(Math.sin(st.yaw), Math.cos(st.yaw));
      if (Math.abs(Math.abs(st.yaw) - Math.PI) < 1e-3) st.yaw = st.yaw > 0 ? Math.PI : -Math.PI;
      const wasRight = Math.cos(st.yaw) >= 0;
      const viaFront = Math.random() < 0.7; // le plus souvent, il pivote en nous faisant face
      if (dir > 0) {
        if (!wasRight) {
          if (viaFront && st.yaw > 0) st.yaw -= TAU;
          if (!viaFront && st.yaw < 0) st.yaw += TAU;
        }
        st.yawTarget = 0;
      } else if (wasRight) {
        st.yawTarget = viaFront ? -Math.PI : Math.PI;
      } else {
        st.yawTarget = st.yaw <= 0 ? -Math.PI : Math.PI;
      }
    }
    function turn(dt, rate) {
      const before = st.yaw;
      st.yaw = approach(st.yaw, st.yawTarget, rate * dt);
      st.yawRate = ease(st.yawRate, (st.yaw - before) / Math.max(dt, 1e-3), dt, 6);
    }

    function flapStep(dt, freq) {
      const before = Math.floor(st.phase / TAU);
      st.phase += TAU * freq * dt * (Math.cos(st.phase) < 0 ? 1.3 : 0.8) * (1 - st.glide);
      return Math.floor(st.phase / TAU) !== before;
    }

    function land() {
      st.state = 'perch';
      st.perch = st.target;
      st.lastPerch = st.target.el || null;
      st.vel.set(0, 0, 0);
      st.timer = rand(5, 10);
      st.flyTime = 0;
      st.nextStretch = rand(3, 6);
      const right = Math.cos(st.yaw) >= 0;
      st.yawTarget = right ? -0.55 : -Math.PI + 0.55;
      if (!right && st.yaw > 0) { st.yaw -= TAU; }
      sparks(footMark, 12);
    }
    function takeoff(away) {
      st.state = 'fly';
      st.flyTime = 0;
      st.phase = Math.PI / 2;
      st.beats = 6;
      st.gliding = false;
      if (away) {
        const pw = toWorld(pointer.x, pointer.y);
        const dir = st.pos.x > pw.x ? 1 : -1;
        st.target = { w: new V3(clamp(st.pos.x + dir * rand(3, 6) * S, -W / 2 + 1.2 * S, W / 2 - 1.2 * S), clamp(st.pos.y + rand(1, 3) * S, -H / 2 + 1.6 * S, H / 2 - 1.6 * S), 0) };
      } else {
        pickTarget();
      }
      const tw = targetWorld(st.target);
      st.dir = 0;
      setHeading(tw.x >= st.pos.x ? 1 : -1);
      st.vel.set(0, 2.6 * S, 0);
      sparks(footMark, 10);
    }

    function updateFly(dt) {
      st.flyTime += dt;
      let tg = st.target;
      if (!tg || (tg.el && !perchable(tg.el))) { pickTarget(); tg = st.target; }
      const T = targetWorld(tg);
      const dx = T.x - st.pos.x, dy = T.y - st.pos.y, dist = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx) > 0.35 * S) setHeading(dx > 0 ? 1 : -1);
      turn(dt, 2.3);
      const side = Math.abs(Math.sin(st.yaw)); // 1 quand il nous fait face ou nous tourne le dos
      const landing = !!tg.el && dist < 1.4 * S;
      const want = 3.4 * S * Math.min(1, dist / (tg.el ? 2.2 * S : 1.2 * S));
      const h = want * (0.4 + 0.6 * (1 - side));
      // Il avance dans le sens de son cap ; en virage, il décrit une boucle dans la profondeur
      const vx = Math.cos(st.yaw) * h;
      const vz = -Math.sin(st.yaw) * h * 0.8 - st.pos.z * 1.2;
      const vy = (dy / dist) * want + side * 0.7 * S;
      const k = Math.min(1, dt * 2.5);
      st.vel.x += (vx - st.vel.x) * k;
      st.vel.y += (vy - st.vel.y) * k;
      st.vel.z += (vz - st.vel.z) * k;
      // Il s'écarte du curseur
      const pw = toWorld(pointer.x, pointer.y);
      const px = st.pos.x - pw.x, py = st.pos.y - pw.y, pd = Math.hypot(px, py) || 1;
      if (pd < 1.3 * S && time - pointer.moved < 0.5) {
        st.vel.x += (px / pd) * 9 * S * dt;
        st.vel.y += (py / pd) * 9 * S * dt;
      }
      st.pos.addScaledVector(st.vel, dt);

      const climbing = st.vel.y > 0.6 * S;
      if (st.gliding) {
        st.glideT -= dt;
        if (st.glideT <= 0 || climbing || landing || side > 0.2) { st.gliding = false; st.beats = 4 + ((Math.random() * 4) | 0); }
      }
      st.glide = ease(st.glide, st.gliding ? 1 : 0, dt, 5);
      const freq = st.flyTime < 0.6 ? 4 : landing ? 3.8 : climbing ? 3.3 : 2.7;
      if (flapStep(dt, freq)) {
        st.beats--;
        if (st.beats <= 0 && !climbing && !landing && side < 0.1 && Math.abs(st.vel.x) > 1.6 * S && st.flyTime > 1.2) {
          st.gliding = true;
          st.glideT = rand(0.6, 1.1);
        }
      }
      const s = Math.sin(st.phase), c = Math.cos(st.phase);
      st.flap = lerp(lerp(-0.7, 0.95, (s + 1) / 2), 0.12, st.glide);
      st.upFold = Math.max(0, c) ** 0.7 * (1 - st.glide);
      st.ext = 1;
      st.sweep = lerp(0.12 - 0.45 * st.upFold, 0.05, st.glide);
      st.fold = ease(st.fold, 0, dt, 8);
      st.legs = ease(st.legs, landing ? clamp(1 - dist / (1.4 * S), 0, 1) : 0, dt, 6);
      st.tailSpread = ease(st.tailSpread, landing ? 1.4 : side > 0.3 ? 1.15 : st.glide > 0.5 ? 0.9 : 0.6, dt, 4);
      // Assiette : nez levé en montée et pour se poser ; il s'incline dans les virages
      const pitchT = landing ? 0.9 * (1 - dist / (1.4 * S)) + 0.2 : clamp(st.vel.y / (3 * S), -0.35, 0.45);
      st.pitch = ease(st.pitch, pitchT + 0.05 * s * (1 - st.glide), dt, 5);
      st.roll = ease(st.roll, clamp(st.yawRate * 0.45, -0.85, 0.85), dt, 5);
      st.headPitch = ease(st.headPitch, -st.pitch * 0.8, dt, 8);
      st.headYaw = ease(st.headYaw, 0, dt, 6);

      if (tg.el ? dist < 0.25 * S : dist < 0.6 * S) {
        if (tg.el) land();
        else if (tg.center) arriveCenter(tg);
        else pickTarget();
      }
    }

    function foldedWings(dt) {
      st.fold = ease(st.fold, 1, dt, 6);
      st.flap = ease(st.flap, -0.1, dt, 6);
      st.ext = ease(st.ext, 0, dt, 6);
      st.upFold = 0;
    }

    function updatePerch(dt) {
      const tg = st.perch;
      if (tg.el) {
        const r = perchRect(tg.el);
        if (!tg.el.isConnected || r.width === 0 || r.top < S * 0.5 || r.top > H - S * 0.1) {
          if (reduce.matches) { relocateStill(); return; }
          takeoff(false);
          return;
        }
      }
      // Il se tourne vers le curseur, en pivotant de face
      const pw = toWorld(pointer.x, pointer.y);
      if (time - pointer.moved < 2 && Math.abs(pw.x - st.pos.x) > S) {
        const right = pw.x > st.pos.x;
        const t = right ? -0.55 : -Math.PI + 0.55;
        if (Math.abs(st.yawTarget - t) > 0.1) { if (st.yaw > 0) st.yaw -= TAU; st.yawTarget = t; }
      }
      turn(dt, 3);
      st.pitch = ease(st.pitch, 0.8, dt, 6);
      st.roll = ease(st.roll, 0, dt, 6);
      st.legs = ease(st.legs, 1, dt, 8);
      st.tailSpread = ease(st.tailSpread, 0.55, dt, 4);
      st.vel.set(0, 0, 0);
      st.pos.z = ease(st.pos.z, 0, dt, 6);
      // La tête suit le curseur
      const hx = pw.x - st.pos.x, hy = pw.y - (st.pos.y + 0.3 * S);
      const look = time - pointer.moved < 3;
      st.headYaw = ease(st.headYaw, look ? clamp(Math.atan2(hx, 4 * S) * (Math.cos(st.yaw) >= 0 ? 1 : -1) * 0.6, -0.7, 0.7) : 0.15 * Math.sin(time * 0.7), dt, 5);
      st.headPitch = ease(st.headPitch, -st.pitch * 0.95 + (look ? clamp(hy / (6 * S), -0.4, 0.4) : 0), dt, 5);

      if (reduce.matches) { st.fold = 1; st.ext = 0; st.flap = -0.1; alignFeet(tg); return; }

      // Respiration et, de temps en temps, il étire les ailes
      st.nextStretch -= dt;
      if (st.nextStretch <= 0) { st.stretch = 1.4; st.nextStretch = rand(6, 11); }
      if (st.stretch > 0) {
        st.stretch -= dt;
        const k2 = Math.sin(Math.PI * clamp(1 - st.stretch / 1.4, 0, 1));
        st.fold = ease(st.fold, 1 - 0.8 * k2, dt, 8);
        st.ext = ease(st.ext, k2, dt, 8);
        st.flap = ease(st.flap, 0.9 * k2, dt, 8);
        st.sweep = 0;
      } else {
        foldedWings(dt);
      }
      alignFeet(tg);

      // Le curseur s'approche : il sursaute, bec ouvert et ailes à demi levées, puis s'envole
      const pd = Math.hypot(pw.x - st.pos.x, pw.y - (st.pos.y + 0.1 * S));
      if (st.startle <= 0 && pd < 1.25 * S && time - pointer.moved < 0.35) {
        st.startle = 0.35;
        st.beak = 1;
      }
      if (st.startle > 0) {
        st.startle -= dt;
        st.fold = ease(st.fold, 0.4, dt, 14);
        st.flap = ease(st.flap, 0.8, dt, 14);
        if (st.startle <= 0) { takeoff(true); return; }
      }
      st.timer -= dt;
      if (st.timer <= 0) takeoff(false);
    }

    // Place l'oiseau pour que ses serres touchent le haut de l'élément.
    const tmpV = new V3();
    function alignFeet(tg) {
      applyPose();
      footMark.getWorldPosition(tmpV);
      const p = perchPoint(tg);
      st.pos.x += p.x - tmpV.x;
      st.pos.y += p.y - tmpV.y;
    }

    function relocateStill() {
      const list = candidates();
      st.perch = list.length ? { el: list[0], fx: 0.8 } : { px: W - S * 1.2, py: H - S * 0.3 };
      st.state = 'perch';
      st.fold = 1; st.ext = 0; st.flap = -0.1; st.legs = 1; st.pitch = 0.8;
    }

    /* ---------- Centre de l'écran : vol sur place, ou traversée ---------- */
    function hoverPose(dt, facing) {
      if (facing !== undefined) st.yawTarget = facing;
      turn(dt, 2.6);
      st.gliding = false;
      st.glide = 0;
      flapStep(dt, 3.2);
      const s = Math.sin(st.phase), c = Math.cos(st.phase);
      st.flap = lerp(-0.55, 1.05, (s + 1) / 2);
      st.upFold = Math.max(0, c) ** 0.7 * 0.6;
      st.ext = 1;
      st.sweep = 0.35 * -c; // ailes vers l'avant à la descente, vers l'arrière à la remontée
      st.fold = ease(st.fold, 0, dt, 8);
      st.legs = ease(st.legs, 0.6, dt, 4);
      st.tailSpread = ease(st.tailSpread, 1.4, dt, 4);
      st.pitch = ease(st.pitch, 1.1, dt, 4);
      st.roll = ease(st.roll, 0, dt, 4);
      st.headPitch = ease(st.headPitch, -st.pitch * 0.85, dt, 6);
    }
    function arriveCenter(tg) {
      st.lastCenter = time;
      st.vel.set(0, 0, 0);
      // Il se tournera vers nous (cap -π/2) par le plus court
      st.yaw = Math.atan2(Math.sin(st.yaw), Math.cos(st.yaw));
      if (st.yaw > Math.PI / 2) st.yaw -= TAU;
      if (tg.pass) startPass();
      else { st.state = 'hover'; st.timer = rand(1.6, 2.6); }
    }
    function updateHover(dt) {
      hoverPose(dt, -Math.PI / 2);
      st.vel.x += ((0 - st.pos.x) * 6 - st.vel.x * 4) * dt;
      st.vel.y += ((0 - st.pos.y) * 6 - st.vel.y * 4) * dt;
      st.vel.z += ((0 - st.pos.z) * 6 - st.vel.z * 4) * dt;
      st.pos.addScaledVector(st.vel, dt);
      st.timer -= dt;
      if (st.timer <= 0) {
        st.state = 'fly';
        st.flyTime = 2;
        st.beats = 5;
        pickTarget();
        st.dir = 0;
      }
    }

    // Traversée : il prend un peu de recul dans la profondeur de la page, fait demi-tour,
    // puis revient droit sur nous, ailes tendues comme un avion, et passe derrière la caméra.
    // Étapes (s) : vol sur place, recul, demi-tour, approche.
    const P_HOVER = 0.5, P_AWAY = 1.6, P_TURN = 2.4, P_APPROACH = 1.6;
    const farZ = () => -0.5 * D; // juste assez de recul pour prendre de l'élan ; il reste bien visible
    function startPass() {
      st.state = 'pass';
      st.passT = 0;
      st.passStart = st.pos.clone();
    }
    function updatePass(dt) {
      const t = (st.passT += dt);
      const FAR = farZ();
      if (t < P_HOVER) {
        hoverPose(dt, -Math.PI / 2);
        st.pos.lerp(new V3(0, 0, 0), Math.min(1, dt * 4));
      } else if (t < P_AWAY) {
        // Il nous tourne le dos et s'éloigne en battant des ailes
        st.yawTarget = Math.PI / 2;
        if (st.yaw < -Math.PI / 2 - 0.01) st.yaw += TAU;
        turn(dt, 3.4);
        flapStep(dt, 3);
        const s = Math.sin(st.phase), c = Math.cos(st.phase);
        st.flap = lerp(-0.7, 0.95, (s + 1) / 2);
        st.upFold = Math.max(0, c) ** 0.7;
        st.sweep = 0.12 - 0.45 * st.upFold;
        st.ext = 1;
        st.legs = ease(st.legs, 0, dt, 5);
        st.tailSpread = ease(st.tailSpread, 0.7, dt, 4);
        st.pitch = ease(st.pitch, 0.1, dt, 3);
        st.roll = ease(st.roll, 0, dt, 4);
        const u = smooth((t - P_HOVER) / (P_AWAY - P_HOVER));
        st.pos.set(0, lerp(0, 0.6 * S, u), lerp(0, FAR, u));
      } else if (t < P_TURN) {
        // Demi-tour, incliné
        st.yawTarget = 1.5 * Math.PI;
        turn(dt, 4);
        flapStep(dt, 3);
        st.flap = lerp(-0.4, 0.8, (Math.sin(st.phase) + 1) / 2);
        st.upFold = 0;
        st.roll = ease(st.roll, 0.7, dt, 4);
        st.pitch = ease(st.pitch, 0.05, dt, 3);
      } else {
        // Comme un avion : ailes tendues à plat, sans battre, il plane droit sur la caméra
        const u = (t - P_TURN) / P_APPROACH;
        fireBoost = 1 - 0.45 * Math.min(1, u); // ses flammes se tassent : c'est l'oiseau qui remplit l'écran
        shake = Math.max(shake, 5 * clamp((u - 0.8) / 0.2, 0, 1));
        st.yawTarget = 1.5 * Math.PI;
        turn(dt, 3);
        st.flap = ease(st.flap, 0.2 + 0.02 * Math.sin(time * 3), dt, 4);
        st.upFold = 0;
        st.sweep = ease(st.sweep, 0.04, dt, 4);
        st.ext = 1;
        st.tailSpread = ease(st.tailSpread, 0.75, dt, 4);
        st.roll = ease(st.roll, 0.09 * Math.sin(time * 1.6) + 0.03 * Math.sin(time * 4.1), dt, 3);
        st.pitch = ease(st.pitch, -0.22, dt, 3); // léger piqué : on voit le dessus des ailes
        st.headPitch = ease(st.headPitch, 0.18, dt, 4);
        st.pos.set(Math.sin(time * 1.1) * 0.4 * S * (1 - u), lerp(0.6 * S, -0.1 * S, u ** 1.5), lerp(FAR, D, Math.min(1, u) ** 2.2));
        // Juste avant l'impact : des étincelles filent vers les bords de l'écran
        if (u > 0.82) {
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * TAU, r0 = rand(0.15, 0.45) * Math.min(W, H), v = rand(3, 6) * Math.max(W, H);
            spawn(fire, SPARK, Math.cos(a) * r0, Math.sin(a) * r0, D * 0.4, Math.cos(a) * v, Math.sin(a) * v, 0, rand(0.15, 0.3), S * rand(0.06, 0.12), 1);
          }
        }
        if (st.pos.z > D - 0.6 * S) { passThrough(); return; }
      }
      st.headPitch = ease(st.headPitch, -st.pitch * 0.8, dt, 6);
    }
    // Impact : flash, onde de choc, boule de feu et braises qui fusent, secousse ; puis l'écran
    // se consume depuis le centre (voir impactMat). La page elle-même n'est jamais modifiée.
    let impactT = -1;
    function passThrough() {
      fireBoost = 1;
      impactT = 0;
      const n = 120 * quality;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = rand(0.8, 2.2) * Math.max(W, H), r0 = rand(0, 0.2) * Math.min(W, H);
        const flame = i % 4 === 0;
        spawn(fire, flame ? FLAME : SPARK, Math.cos(a) * r0, Math.sin(a) * r0, D * 0.3, Math.cos(a) * v, Math.sin(a) * v, 0,
          rand(0.3, 0.55), flame ? S * rand(0.3, 0.55) : S * rand(0.05, 0.1), rand(0.85, 1));
      }
      addFlash(new V3(0, 0, D * 0.5), Math.max(W, H) * 0.6, 0.55);
      shake = 20;
      st.state = 'away';
      st.timer = 1.2;
      st.visible = false;
    }
    function reenter() {
      const fromLeft = Math.random() < 0.5;
      st.state = 'fly';
      st.visible = true;
      st.pos.set((fromLeft ? -1 : 1) * (W / 2 + 1.8 * S), rand(-0.15, 0.2) * H, 0);
      st.dir = fromLeft ? 1 : -1;
      st.yaw = st.yawTarget = fromLeft ? 0 : -Math.PI;
      st.vel.set(st.dir * 3 * S, 0, 0);
      st.pitch = 0; st.roll = 0; st.fold = 0; st.legs = 0;
      st.flyTime = 2;
      st.beats = 6;
      st.target = { w: new V3(st.dir * W * 0.15, st.pos.y, 0) };
    }
    function goCenter(pass) {
      if (reduce.matches || hidden || ['dead', 'pass', 'away'].includes(st.state)) return;
      paused = false;
      if (st.state === 'hover') {
        if (pass) startPass(); else st.timer = 2;
        kick();
        return;
      }
      if (st.state === 'perch') takeoff(false);
      st.state = 'fly';
      st.target = { center: true, pass };
      kick();
    }

    /* ---------- Embrasement et renaissance ---------- */
    function sparks(obj, n) {
      if (reduce.matches) return;
      obj.getWorldPosition(tmpV);
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI), v = rand(0.4, 1.4) * S;
        spawn(fire, SPARK, tmpV.x, tmpV.y, tmpV.z, Math.cos(a) * v, Math.sin(a) * v, rand(-0.5, 0.5) * S, rand(0.6, 1.4), S * rand(0.02, 0.035), 1);
      }
    }
    function addFlash(pos, size, life) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 1 }));
      sp.position.copy(pos);
      sp.scale.setScalar(size);
      glowScene.add(sp);
      fxList.push({ k: 'flash', sp, size, life: 0, max: life });
    }
    function burst() {
      if (['dead', 'pass', 'away'].includes(st.state) || hidden || reduce.matches) return;
      centerMark.getWorldPosition(st.burstPos);
      const c = st.burstPos;
      st.state = 'dead';
      st.visible = false;
      st.timer = 1.3;
      st.pillar = false;
      const n = 700 * quality;
      for (let i = 0; i < n; i++) {
        const a = anchors[(Math.random() * anchors.length) | 0];
        a.getWorldPosition(tmpV);
        const d = tmpV.clone().sub(c);
        const len = d.length() || 1, v = S * (0.8 + 3.2 * Math.random() ** 2);
        spawn(fire, FLAME, tmpV.x, tmpV.y, tmpV.z, (d.x / len) * v, (d.y / len) * v + 0.5 * S, (d.z / len) * v, rand(0.5, 1.2), S * rand(0.22, 0.4), rand(0.9, 1));
      }
      for (let i = 0; i < 150; i++) {
        const v = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4) * S);
        spawn(fire, SPARK, c.x, c.y, c.z, v.x, v.y + S, v.z, rand(1.2, 2.4), S * rand(0.02, 0.04), 1);
      }
      for (let i = 0; i < 28; i++) {
        spawn(smoke, 0, c.x + rand(-0.5, 0.5) * S, c.y + rand(-0.4, 0.4) * S, c.z, rand(-0.6, 0.6) * S, rand(0.3, 0.9) * S, rand(-0.3, 0.3) * S, rand(1.4, 2.4), S * rand(0.5, 0.9), 0);
      }
      addFlash(c, 4 * S, 0.55);
    }
    function reborn() {
      const c = st.burstPos;
      st.state = 'fly';
      st.visible = true;
      st.pos.copy(c).add(new V3(0, -0.2 * S, 0));
      st.vel.set(0, 2.6 * S, 0);
      st.fold = 0; st.legs = 0; st.pitch = 0.6; st.phase = Math.PI / 2; st.beats = 6; st.gliding = false;
      st.flyTime = 0;
      pickTarget();
      st.dir = 0;
      addFlash(c, 3 * S, 0.45);
      for (let i = 0; i < 40; i++) {
        const v = new V3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 3) * S);
        spawn(fire, SPARK, c.x, c.y, c.z, v.x, v.y, v.z, rand(0.8, 1.6), S * rand(0.02, 0.035), 1);
      }
    }

    /* ---------- Pose du squelette ---------- */
    // Aile repliée : rotation de l'épaule, écart au corps, hauteur de l'attache
    // (au-delà de la verticale, le bas de l'aile rentre vers le corps : elle épouse le flanc)
    const FOLD = { flap: -1.85, z: 0.105, y: 0.05, sweep: -1.05 };
    function applyPose() {
      bird.scale.setScalar(S);
      bird.position.copy(st.pos);
      bird.rotation.set(st.roll, st.yaw, st.pitch);
      const breath = st.state === 'perch' && !reduce.matches ? 1 + 0.018 * Math.sin(time * 2.3) : 1;
      torso.scale.set(1, breath, breath);
      // Ailes : battement à l'épaule, repli au coude et au poignet, éventail des plumes
      const fold = st.fold, up = st.upFold;
      const sweep = lerp(st.sweep, FOLD.sweep, fold);
      const elbowA = lerp(0.55 * up, 2.45, fold);
      const wristA = lerp(-0.95 * up, -3.0, fold);
      const flap = lerp(st.flap, FOLD.flap, fold); // repliée, l'aile tourne à la verticale contre le flanc
      for (const w of wings) {
        w.root.position.z = w.root.userData.side * lerp(0.085, FOLD.z, fold);
        w.root.position.y = lerp(0.075, FOLD.y, fold);
        w.shoulder.rotation.set(-flap, sweep, 0);
        w.elbow.rotation.y = elbowA;
        w.wrist.rotation.y = wristA;
        const ext = clamp(st.ext * (1 - fold) * (1 - 0.35 * up), 0, 1);
        // chaque rémige bouge un peu à son rythme dans le vent (rien quand l'aile est repliée)
        const jit = 0.02 * (1 - fold) * st.air;
        for (const f of w.feathers) f.m.rotation.y = lerp(f.fold, f.ext, ext) + jit * Math.sin(time * 4.7 + f.j * 1.9 + w.root.userData.side);
        FOLDU.ext.value = ext;
        FOLDU.jit.value = jit;
      }
      // Plumes souples (voir softFeathers) : flexion des ailes selon leur vitesse, frémissement dans l'air
      const speed = st.vel.length() / S, air = st.air;
      {
        const open = 1 - fold, flying = st.state !== 'perch' && st.state !== 'dead';
        const fl = open * (flying ? 0.012 + 0.03 * air : 0.003), rp = open * (flying ? 0.15 + 0.6 * air : 0.04);
        for (const u of [SOFT.primary, SOFT.secondary, SOFT.covert]) {
          u.time.value = time; u.bend.value = st.wingBend; u.flutter.value = fl; u.ripple.value = rp;
        }
        const b = SOFT.body;
        b.time.value = time; b.bend.value = 0.03 * Math.sin(time * 2.3) * (flying ? 0 : 1);
        b.flutter.value = flying ? 0.01 + 0.025 * air : 0.004; b.ripple.value = flying ? 0.1 + 0.4 * air : 0.03;
        const c = SOFT.crest;
        c.time.value = time; c.bend.value = st.crestSw.p; c.flutter.value = 0.008 + 0.03 * air; c.ripple.value = 0.1 + 0.5 * air;
        const t = SOFT.tail;
        t.time.value = time; t.bend.value = clamp(0.07 * st.tailSw.vz, -0.35, 0.35);
        t.flutter.value = flying ? 0.02 + 0.05 * air : 0.01; t.ripple.value = flying ? 0.1 + 0.5 * air : 0.03;
      }
      // Queue : l'éventail suit l'oiseau avec du retard (ressorts de tailDynamics), chaque rectrice
      // frémit à son rythme ; les longues plumes ont ici leur forme au repos, la simulation fait le reste.
      const sw = st.tailSw;
      tail.rotation.set(sw.x, sw.y, lerp(0.04, 0.12, st.legs) + sw.z);
      for (const f of tailFeathers) {
        f.m.rotation.y = f.k * 0.32 * st.tailSpread + 0.015 * air * Math.sin(time * 4.1 + f.i * 2.3);
        f.m.rotation.x = 0.06 * air * Math.sin(time * 6.3 + f.i * 1.7);
      }
      const droop = 0.03 + 0.05 * (1 - air);
      for (const p of plumes) {
        p.segs.forEach((g, i) => {
          g.rotation.z = (i ? droop : 0.05) + 0.035 * Math.sin(time * 2.4 - i * 0.7 + p.j);
          g.rotation.y = (i ? 0.02 * p.j : p.j * 0.18) + 0.03 * Math.sin(time * 1.7 - i * 0.6 + p.j * 2);
        });
      }
      // Pattes : repliées en vol, tendues verticalement une fois posé
      for (const l of legs) {
        l.hip.rotation.z = lerp(-1.9, -st.pitch + 0.15, st.legs);
        l.shin.rotation.z = lerp(0.5, -0.15, st.legs);
        l.foot.rotation.z = lerp(0.9, 0, st.legs);
        for (const t of l.toes) t.rotation.z = lerp(-0.6, 0, st.legs);
      }
      // Tête, bec, yeux, aigrette
      head.rotation.set(0, st.headYaw, st.headPitch);
      jaw.rotation.z = -0.35 * st.beak;
      const blink = st.blinkT > 0 ? 0.12 : 1;
      for (const e of eyes) e.scale.set(1, blink, 1);
      for (const c of crest) c.m.rotation.z = c.base + 0.07 * Math.sin(time * 3 + c.k * 2) + Math.min(0.12, speed * 0.04);
      bird.updateMatrixWorld(true);
    }

    /* ---------- Queue : mouvements secondaires ---------- */
    // L'éventail est monté sur des ressorts peu amortis : il bat à contretemps des ailes,
    // traîne quand l'oiseau monte ou se cabre, et se tord dans les virages.
    function tailDynamics(dt) {
      const sw = st.tailSw;
      if (dt <= 0) return;
      const flying = st.state !== 'perch' && st.state !== 'dead';
      const beat = flying ? (1 - st.glide) * st.ext : 0;
      const ay = (st.vel.y - st.prevVy) / dt, pr = (st.pitch - st.prevPitch) / dt;
      st.prevVy = st.vel.y;
      st.prevPitch = st.pitch;
      const tz = -0.11 * beat * Math.sin(st.phase) + clamp(ay / (20 * S), -0.3, 0.3) - clamp(0.12 * pr, -0.3, 0.3)
        + (flying ? 0 : 0.03 * Math.sin(time * 1.3));
      const tx = clamp(-0.15 * st.yawRate, -0.35, 0.35) + 0.04 * beat * Math.sin(st.phase * 0.5);
      const ty = clamp(0.12 * st.yawRate, -0.3, 0.3);
      const k = 55, c = 2 * 0.28 * Math.sqrt(k);
      for (const [a, va, t] of [['x', 'vx', tx], ['y', 'vy', ty], ['z', 'vz', tz]]) {
        sw[va] += (k * (t - sw[a]) - c * sw[va]) * dt;
        sw[a] = clamp(sw[a] + sw[va] * dt, -0.7, 0.7);
      }
    }

    // Rémiges : à la descente de l'aile, l'air relève leurs pointes, à la remontée il les abaisse ;
    // en plané, elles se recourbent vers le haut. Aigrette : elle fouette quand la tête bouge.
    function featherDynamics(dt) {
      st.air = ease(st.air, Math.min(1, st.vel.length() / (3 * S)), dt, 6);
      if (dt <= 0) return;
      const flapVel = (st.flap - st.prevFlap) / dt;
      st.prevFlap = st.flap;
      const open = 1 - st.fold;
      const target = open * (clamp(-0.018 * flapVel, -0.32, 0.32) + 0.1 * st.glide + (st.state === 'pass' ? 0.06 : 0));
      st.wingBend += (target - st.wingBend) * Math.min(1, dt * 16);
      const hp = (st.headPitch - st.prevHeadPitch) / dt, hy = (st.headYaw - st.prevHeadYaw) / dt;
      st.prevHeadPitch = st.headPitch;
      st.prevHeadYaw = st.headYaw;
      const cs = st.crestSw, k = 90, c = 2 * 0.2 * Math.sqrt(k);
      const ct = clamp(0.05 * hp + 0.04 * hy - (st.vel.y - st.prevVy) / (60 * S), -0.35, 0.35) - 0.06 * st.air;
      cs.v += (k * (ct - cs.p) - c * cs.v) * dt;
      cs.p = clamp(cs.p + cs.v * dt, -0.4, 0.4);
    }

    const tmpQ = new THREE.Quaternion(), tmpA = new V3(), tmpB = new V3(), tmpW = new V3();
    function updatePlumes(dt) {
      const N = PSEG + 1, g = 2.2 * S;
      for (const pl of plumes) {
        const L = pl.SL * S;
        for (let i = 0; i < N; i++) {
          pl.prev[i].copy(pl.tgt[i]);
          (i < PSEG ? pl.segs[i] : pl.tip).getWorldPosition(pl.tgt[i]);
        }
        // Premier passage, téléportation ou animations réduites : la plume prend sa forme au repos
        if (!pl.ready || reduce.matches || pl.tgt[0].distanceTo(pl.prev[0]) > 3 * S) {
          for (let i = 0; i < N; i++) { pl.p[i].copy(pl.tgt[i]); pl.v[i].set(0, 0, 0); }
          pl.ready = true;
        } else if (dt > 0) {
          const n = Math.ceil(dt * 60 - 1e-6), h = dt / n;
          for (let s = 1; s <= n; s++) {
            const f = s / n;
            pl.p[0].lerpVectors(pl.prev[0], pl.tgt[0], f);
            for (let i = 1; i < N; i++) {
              // raide près de la queue, de plus en plus souple vers le bout ; amortie par rapport à l'oiseau
              const k = lerp(140, 16, (i - 1) / (N - 2)), c = 2 * 0.22 * Math.sqrt(k);
              tmpA.lerpVectors(pl.prev[i], pl.tgt[i], f);
              tmpB.subVectors(pl.tgt[i], pl.prev[i]).divideScalar(dt);
              const v = pl.v[i], p = pl.p[i];
              v.x += (k * (tmpA.x - p.x) - c * (v.x - tmpB.x) - 0.7 * v.x) * h;
              v.y += (k * (tmpA.y - p.y) - c * (v.y - tmpB.y) - 0.7 * v.y - g) * h;
              v.z += (k * (tmpA.z - p.z) - c * (v.z - tmpB.z) - 0.7 * v.z) * h;
              p.addScaledVector(v, h);
            }
            // Elle se courbe sans faire d'angle vif, et ne s'étire pas : chaque maillon garde sa longueur
            for (let i = 1; i < N - 1; i++) {
              tmpW.addVectors(pl.p[i - 1], pl.p[i + 1]).multiplyScalar(0.5).sub(pl.p[i]).multiplyScalar(0.25);
              pl.p[i].add(tmpW);
            }
            for (let i = 1; i < N; i++) {
              tmpW.subVectors(pl.p[i], pl.p[i - 1]);
              const d = tmpW.length() || 1;
              tmpW.multiplyScalar(L / d - 1);
              pl.p[i].add(tmpW);
              pl.v[i].addScaledVector(tmpW, 0.9 / h);
            }
          }
        }
        // Ruban : la largeur part du plan de la vexille à la base, puis suit la plume de proche en proche
        // (transport parallèle), pour qu'elle ne vrille pas quand la plume pend à la verticale
        const arr = pl.geo.attributes.position.array, hw = 0.08 * S;
        pl.segs[0].getWorldQuaternion(tmpQ);
        tmpW.set(0, -Math.sin(pl.vane), Math.cos(pl.vane)).applyQuaternion(tmpQ);
        for (let i = 0; i < N; i++) {
          tmpA.subVectors(pl.p[Math.min(N - 1, i + 1)], pl.p[Math.max(0, i - 1)]).normalize();
          tmpW.addScaledVector(tmpA, -tmpW.dot(tmpA)).normalize();
          const p = pl.p[i];
          arr[i * 6] = p.x - tmpW.x * hw; arr[i * 6 + 1] = p.y - tmpW.y * hw; arr[i * 6 + 2] = p.z - tmpW.z * hw;
          arr[i * 6 + 3] = p.x + tmpW.x * hw; arr[i * 6 + 4] = p.y + tmpW.y * hw; arr[i * 6 + 5] = p.z + tmpW.z * hw;
        }
        pl.geo.attributes.position.needsUpdate = true;
        pl.geo.computeVertexNormals();
        pl.tipFx.position.copy(pl.p[N - 1]);
        pl.flame.position.lerpVectors(pl.p[N - 2], pl.p[N - 1], 0.4);
      }
    }

    /* ---------- Boucle ---------- */
    function emit(dt) {
      if (reduce.matches || !st.visible) return;
      const flying = st.state !== 'perch';
      const rate = (flying ? 900 : 320) * quality;
      let n = rate * dt;
      const z = st.pos.z;
      const persp = Math.min(2.5, D / Math.max(200, D - z));
      while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        const a = anchors[(Math.random() * anchors.length) | 0];
        a.getWorldPosition(tmpV);
        spawn(fire, FLAME, tmpV.x + rand(-1, 1) * 0.02 * S, tmpV.y + rand(-1, 1) * 0.02 * S, tmpV.z,
          st.vel.x * 0.12 + rand(-0.15, 0.15) * S, st.vel.y * 0.12 + rand(0.1, 0.4) * S, st.vel.z * 0.12,
          rand(0.22, 0.5), S * rand(0.24, 0.4) * fireBoost / persp * Math.min(persp, 1.6), clamp(a.userData.heat * rand(0.85, 1.05), 0, 1));
      }
      if (Math.random() < (flying ? 20 : 8) * dt) {
        const a = anchors[(Math.random() * anchors.length) | 0];
        a.getWorldPosition(tmpV);
        spawn(fire, SPARK, tmpV.x, tmpV.y, tmpV.z, rand(-0.4, 0.4) * S, rand(0.3, 0.8) * S, rand(-0.3, 0.3) * S, rand(0.9, 2), S * 0.03, 1);
      }
    }

    function update(dt) {
      if (!reduce.matches) time += dt;
      st.nextBlink -= dt;
      if (st.nextBlink <= 0) { st.blinkT = 0.13; st.nextBlink = rand(2, 5); }
      if (st.blinkT > 0) st.blinkT -= dt;
      st.beak = Math.max(0, st.beak - dt * 2.5);
      if (st.state === 'fly') updateFly(dt);
      else if (st.state === 'perch') updatePerch(dt);
      else if (st.state === 'hover') updateHover(dt);
      else if (st.state === 'pass') updatePass(dt);
      else if (st.state === 'away') { st.timer -= dt; if (st.timer <= 0) reenter(); }
      else {
        st.timer -= dt;
        if (st.timer < 0.45 && !st.pillar) { st.pillar = true; fxList.push({ k: 'column', life: 0, max: 0.6 }); }
        if (st.timer <= 0) reborn();
      }
      featherDynamics(dt);
      tailDynamics(dt);
      applyPose();
      updatePlumes(dt);
      emit(dt);
      for (let i = fxList.length - 1; i >= 0; i--) {
        const f = fxList[i];
        f.life += dt;
        if (f.k === 'flash') {
          f.sp.material.opacity = 1 - f.life / f.max;
          f.sp.scale.setScalar(f.size * (0.7 + 0.5 * f.life / f.max));
        } else if (f.k === 'column') {
          const c = st.burstPos;
          let n = 700 * quality * dt;
          while (n > 0) {
            if (n < 1 && Math.random() > n) break;
            n -= 1;
            spawn(fire, FLAME, c.x + rand(-0.22, 0.22) * S, c.y - 0.9 * S + rand(0, 0.2) * S, c.z + rand(-0.2, 0.2) * S,
              rand(-0.2, 0.2) * S, rand(1.6, 3.2) * S, 0, rand(0.35, 0.7), S * rand(0.28, 0.45), rand(0.9, 1));
          }
        }
        if (f.life >= f.max) {
          if (f.sp) { glowScene.remove(f.sp); f.sp.material.dispose(); }
          fxList.splice(i, 1);
        }
      }
      updatePool(fire, dt, false);
      updatePool(smoke, dt, true);
      updateAttachedFlames();
      if (impactT >= 0) {
        impactT += dt;
        if (impactT > 1) impactT = -1;
      }
      if (st.state !== 'pass') fireBoost = ease(fireBoost, 1, dt, 3);
      shake *= Math.exp(-5 * dt);
      if (shake < 0.2) shake = 0;
      // Taille des langues de feu : suit la perspective de l'oiseau
      const persp = clamp(D / Math.max(1, D - st.pos.z), 0.3, 5);
      fireUnit = ease(fireUnit, 0.42 * S * (st.visible ? persp : st.state === 'away' ? 1.6 : 1), dt, 10);
    }

    const hit = document.createElement('div');
    hit.setAttribute('aria-hidden', 'true');
    hit.title = 'Un clic : il renaît de ses cendres';
    hit.style.cssText = 'position:fixed;left:0;top:0;display:none;z-index:2147483001;border-radius:45%;cursor:pointer;background:transparent;-webkit-tap-highlight-color:transparent;';
    hit.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); burst(); kick(); });
    let hitKey = '';
    function placeHit() {
      let next = 'none';
      if (st.visible && ['fly', 'perch', 'hover'].includes(st.state) && !hidden && !reduce.matches) {
        centerMark.getWorldPosition(tmpV);
        const z = tmpV.z;
        tmpV.project(camera);
        const x = (tmpV.x + 1) / 2 * W, y = (1 - tmpV.y) / 2 * H, k = D / Math.max(1, D - z), s = S * 1.1 * k;
        next = `${(x - s / 2).toFixed(0)},${(y - s / 2).toFixed(0)},${s.toFixed(0)}`;
      }
      if (next === hitKey) return;
      hitKey = next;
      if (next === 'none') { hit.style.display = 'none'; return; }
      const [x, y, s] = next.split(',');
      hit.style.display = 'block';
      hit.style.width = hit.style.height = `${s}px`;
      hit.style.transform = `translate(${x}px, ${y}px)`;
    }

    // Zone de l'écran (px CSS) où il y a du feu : les flammes ne sont calculées que là
    const fireBox = { on: false, x0: 0, y0: 0, x1: 0, y1: 0 };
    function measureFire(side, top, bottom) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const add = (x, y, z, r) => {
        if (z > D - 1) return;
        const k = D / (D - z), sx = W / 2 + x * k, sy = H / 2 - y * k, rk = r * k;
        x0 = Math.min(x0, sx - rk); x1 = Math.max(x1, sx + rk);
        y0 = Math.min(y0, sy - rk); y1 = Math.max(y1, sy + rk);
      };
      for (let i = 0; i < fire.n; i++) if (fire.kind[i] === FLAME) add(fire.pos[i * 3], fire.pos[i * 3 + 1], fire.pos[i * 3 + 2], fire.size[i] * 0.5);
      const fp = flPos.array, fd = flData.array;
      for (let i = 0; i < flGeo.instanceCount; i++) add(fp[i * 3], fp[i * 3 + 1] + fd[i * 4] * fd[i * 4 + 1] * 0.38, fp[i * 3 + 2], fd[i * 4] * fd[i * 4 + 1] * 0.6);
      fireBox.x0 = clamp(x0 - side, 0, W); fireBox.x1 = clamp(x1 + side, 0, W);
      fireBox.y0 = clamp(y0 - top, 0, H); fireBox.y1 = clamp(y1 + bottom, 0, H);
      fireBox.on = fireBox.x1 > fireBox.x0 && fireBox.y1 > fireBox.y0;
    }
    function drawQuad(mat) {
      fsQuad.material = mat;
      renderer.render(fsScene, fsCam);
    }
    function blit(rt) {
      blitMat.uniforms.map.value = rt.texture;
      drawQuad(blitMat);
    }

    function render() {
      bird.visible = st.visible;
      for (const p of plumes) p.mesh.visible = st.visible;
      centerMark.getWorldPosition(tmpV);
      glow.position.copy(tmpV);
      glow.material.opacity = st.visible ? 0.24 + 0.04 * Math.sin(time * 9) : 0;
      glow.scale.setScalar(2.3 * S * (0.7 + 0.3 * fireBoost));
      // Secousse : la caméra tremble (la page, elle, ne bouge pas)
      const ox = shake * (0.6 * Math.sin(time * 71) + 0.4 * Math.sin(time * 43 + 1));
      const oy = shake * (0.6 * Math.sin(time * 59 + 2) + 0.4 * Math.sin(time * 37));
      camera.position.set(ox, oy, D);
      const pr = renderer.getPixelRatio();
      densMat.uniforms.scale.value = D * densRT.width / W;
      sparkMat.uniforms.scale.value = smokeMat.uniforms.scale.value = pr * D;

      // 1. Densité du feu, puis 2. le shader qui en fait des flammes
      measureFire(fireUnit + 16, 2.2 * fireUnit + 16, 0.9 * fireUnit + 16); // les langues montent
      if (fireBox.on) {
        renderer.setRenderTarget(densRT);
        renderer.clear();
        renderer.render(densScene, camera);
        fireRT.scissorTest = false;
        renderer.setRenderTarget(fireRT);
        renderer.clear();
        const fx = fireRT.width / W, fy = fireRT.height / H;
        fireRT.scissor.set(Math.floor(fireBox.x0 * fx), Math.floor((H - fireBox.y1) * fy), Math.ceil((fireBox.x1 - fireBox.x0) * fx) + 1, Math.ceil((fireBox.y1 - fireBox.y0) * fy) + 1);
        fireRT.scissorTest = true;
        renderer.setRenderTarget(fireRT);
        compMat.uniforms.time.value = time;
        compMat.uniforms.unit.value = fireUnit;
        compMat.uniforms.px.value.set(W, H);
        drawQuad(compMat);
        fireRT.scissorTest = false;
      }
      // 3. À l'écran : halo, fumée, feu, puis l'oiseau et les braises par-dessus
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(glowScene, camera);
      renderer.render(backScene, camera);
      if (fireBox.on) {
        renderer.setScissor(fireBox.x0, H - fireBox.y1, fireBox.x1 - fireBox.x0, fireBox.y1 - fireBox.y0);
        renderer.setScissorTest(true);
        blit(fireRT);
        renderer.setScissorTest(false);
      }
      renderer.render(scene, camera);
      // 4. Traversée de l'écran
      if (impactT >= 0) {
        impactMat.uniforms.k.value = impactT;
        impactMat.uniforms.time.value = time;
        impactMat.uniforms.aspect.value = W / H;
        impactMat.uniforms.shake.value.set(ox / H, oy / H);
        renderer.setRenderTarget(fxRT);
        renderer.clear();
        drawQuad(impactMat);
        renderer.setRenderTarget(null);
        blit(fxRT);
      }
      placeHit();
    }

    function frame(now) {
      raf = 0;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      const t0 = performance.now();
      if (!paused) update(dt);
      render();
      // Qualité adaptative : moins de flammes si une image coûte trop cher
      workEma = workEma * 0.92 + (performance.now() - t0) * 0.08;
      if (workEma > 14) quality = Math.max(0.35, quality - 0.02);
      else if (workEma < 8) quality = Math.min(1, quality + 0.005);
      if (!paused && !hidden) raf = requestAnimationFrame(frame);
    }
    function kick() {
      if (!raf && !hidden) { last = 0; raf = requestAnimationFrame(frame); }
    }

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      const wanted = parseFloat(opts.taille);
      S = wanted > 0 ? clamp(wanted, 30, 300) : clamp(Math.min(W, H) * 0.13, 56, 120);
      D = (H / 2) / Math.tan((FOV / 2) * Math.PI / 180);
      camera.aspect = W / H;
      camera.position.set(0, 0, D);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H, false);
      {
        const gl = renderer.getContext(), range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
        const maxSize = range ? range[1] : 256;
        for (const m of [densMat, sparkMat, smokeMat]) m.uniforms.maxSize.value = maxSize;
        // Feu à la résolution de l'écran (en basse résolution, ses contours paraissaient pixellisés)
        const pr = renderer.getPixelRatio(), fx = Math.min(pr, 1.5);
        densRT.setSize(Math.max(1, Math.round(W)), Math.max(1, Math.round(H)));
        fireRT.setSize(Math.max(1, Math.round(W * pr)), Math.max(1, Math.round(H * pr)));
        fxRT.setSize(Math.max(1, Math.round(W * fx)), Math.max(1, Math.round(H * fx)));
      }
      hitKey = '';
      kick();
    }

    document.body.appendChild(canvas);
    document.body.appendChild(hit);
    const track = (ev) => { pointer.x = ev.clientX; pointer.y = ev.clientY; pointer.moved = time; };
    document.addEventListener('pointermove', track, { passive: true });
    document.addEventListener('pointerdown', track, { passive: true });
    window.addEventListener('resize', resize);
    resize();

    // Premier état : posé sur un titre visible, sinon il arrive par un bord de l'écran
    const list = candidates();
    const first = list.find((el) => el.matches('h1')) || list[0];
    if (first) {
      st.perch = st.target = { el: first, fx: 0.85 };
      st.lastPerch = first;
      const p = perchPoint(st.perch);
      st.pos.set(p.x, p.y + FOOT_DROP * S, 0);
      const right = p.x < 0;
      st.yaw = st.yawTarget = right ? -0.55 : -Math.PI + 0.55;
      st.dir = right ? 1 : -1;
      alignFeet(st.perch);
    } else if (reduce.matches) {
      relocateStill();
    } else {
      st.state = 'fly';
      st.pos.set(-W / 2 - 1.8 * S, 0.1 * H, 0);
      st.yaw = st.yawTarget = 0;
      st.dir = 1;
      st.fold = 0; st.legs = 0; st.pitch = 0;
      st.vel.set(2.5 * S, 0, 0);
      pickTarget();
    }
    applyPose();
    updatePlumes(0);
    render();
    kick();

    window.Phenix.__attach({
      traverser() { goCenter(true); },
      auCentre() { goCenter(false); },
      renaitre() { paused = false; burst(); kick(); },
      pause() { paused = true; },
      reprendre() { paused = false; kick(); },
      masquer() { hidden = true; canvas.style.display = 'none'; hit.style.display = 'none'; hitKey = 'none'; },
      afficher() { hidden = false; canvas.style.display = ''; kick(); },
      etat() {
        return { perch: 'posé', fly: 'en vol', hover: 'au centre', pass: 'traverse l’écran', away: 'traverse l’écran', dead: 'en cendres' }[st.state];
      },
    });
  }
})();
