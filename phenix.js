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

    // Dégradé de feu le long d'une plume : bout rouge sombre, base dorée.
    function fireGradient(g, W) {
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#7a0f1f');
      grad.addColorStop(0.13, '#c2281c');
      grad.addColorStop(0.36, '#f0561a');
      grad.addColorStop(0.66, '#ffa02a');
      grad.addColorStop(0.9, '#ffd36e');
      grad.addColorStop(1, '#ffe6a4');
      return grad;
    }

    // Plume vue de dessus, le bout à gauche (u = 0) et la base à droite (u = 1).
    function featherTex(kind) {
      const P = {
        primary: { top: 0.17, bot: 0.45, tip: 0.12, round: 0.55 },
        secondary: { top: 0.3, bot: 0.45, tip: 0.18, round: 0.8 },
        covert: { top: 0.42, bot: 0.42, tip: 0.35, round: 0.9 },
        tail: { top: 0.42, bot: 0.42, tip: 0.14, round: 0.7 },
        crest: { top: 0.2, bot: 0.2, tip: 0.08, round: 0.3 },
      }[kind];
      return canvasTex(512, 128, (g, W, H) => {
        const cy = H / 2;
        const prof = (t) => {
          const tipK = Math.min(1, t / P.tip) ** P.round;
          const baseK = t > 0.84 ? 1 - ((t - 0.84) / 0.16) * 0.6 : 1;
          return tipK * baseK;
        };
        const vane = new Path2D();
        const N = 64;
        for (let i = 0; i <= N; i++) {
          const t = i / N, x = 3 + t * (W - 6), y = cy - P.top * H * prof(t);
          if (i) vane.lineTo(x, y); else vane.moveTo(x, y);
        }
        for (let i = N; i >= 0; i--) {
          const t = i / N;
          vane.lineTo(3 + t * (W - 6), cy + P.bot * H * prof(t));
        }
        vane.closePath();
        g.save();
        g.clip(vane);
        g.fillStyle = fireGradient(g, W);
        g.fillRect(0, 0, W, H);
        // Modelé : lumière sur un bord, ombre sur l'autre
        const vg = g.createLinearGradient(0, 0, 0, H);
        vg.addColorStop(0, 'rgba(255,240,205,0.28)');
        vg.addColorStop(0.42, 'rgba(255,240,205,0)');
        vg.addColorStop(0.58, 'rgba(90,10,15,0)');
        vg.addColorStop(1, 'rgba(90,10,15,0.42)');
        g.fillStyle = vg;
        g.fillRect(0, 0, W, H);
        // Barbes fines, alternativement claires et sombres
        g.lineWidth = 1;
        for (let x = 8; x < W - 12; x += 4) {
          const len = H * 0.55;
          g.strokeStyle = (x / 4) % 2 ? 'rgba(255,232,176,0.2)' : 'rgba(80,10,16,0.22)';
          g.beginPath();
          g.moveTo(x, cy);
          g.lineTo(x - len * 0.55, cy - len);
          g.moveTo(x, cy);
          g.lineTo(x - len * 0.55, cy + len);
          g.stroke();
        }
        g.restore();
        // Petites fentes dans la vexille, comme sur une vraie plume
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.lineWidth = 2;
        for (let i = 0; i < 9; i++) {
          const x = rand(0.1, 0.8) * W, s = Math.random() < 0.5 ? -1 : 1;
          g.beginPath();
          g.moveTo(x, cy + s * H * 0.48);
          g.lineTo(x + 14, cy + s * H * rand(0.22, 0.32));
          g.stroke();
        }
        g.restore();
        // Rachis et contour
        const rg = g.createLinearGradient(0, 0, W, 0);
        rg.addColorStop(0, 'rgba(255,236,190,0.25)');
        rg.addColorStop(1, 'rgba(255,246,218,0.95)');
        g.strokeStyle = rg;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(W * 0.05, cy - 2);
        g.quadraticCurveTo(W * 0.5, cy - 4, W, cy);
        g.stroke();
        g.strokeStyle = 'rgba(84,8,16,0.5)';
        g.lineWidth = 2;
        g.stroke(vane);
      });
    }

    // Longue plume de queue : tige nue, puis large vexille qui finit en flamme recourbée.
    function plumeTex() {
      return canvasTex(1024, 128, (g, W, H) => {
        const cy = H / 2;
        const w = (t) => { // t : 0 bout → 1 base
          if (t > 0.55) return 0.05 + 0.04 * (1 - t);
          const k = t / 0.55;
          return 0.06 + 0.36 * Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.8;
        };
        const vane = new Path2D();
        const N = 90;
        for (let i = 0; i <= N; i++) {
          const t = i / N, x = 3 + t * (W - 6);
          const curl = Math.sin(t * 20) * 4 * (1 - t);
          if (i) vane.lineTo(x, cy - w(t) * H + curl); else vane.moveTo(x, cy - w(t) * H + curl);
        }
        for (let i = N; i >= 0; i--) {
          const t = i / N;
          vane.lineTo(3 + t * (W - 6), cy + w(t) * H + Math.sin(t * 17 + 1) * 4 * (1 - t));
        }
        vane.closePath();
        g.save();
        g.clip(vane);
        g.fillStyle = fireGradient(g, W);
        g.fillRect(0, 0, W, H);
        // Ocelle de feu dans la vexille
        const eye = g.createRadialGradient(W * 0.16, cy, 2, W * 0.16, cy, H * 0.42);
        eye.addColorStop(0, 'rgba(255,245,200,0.95)');
        eye.addColorStop(0.35, 'rgba(255,170,40,0.7)');
        eye.addColorStop(0.7, 'rgba(160,20,24,0.55)');
        eye.addColorStop(1, 'rgba(160,20,24,0)');
        g.fillStyle = eye;
        g.fillRect(0, 0, W, H);
        g.lineWidth = 1;
        for (let x = 6; x < W * 0.6; x += 4) {
          g.strokeStyle = (x / 4) % 2 ? 'rgba(255,232,176,0.2)' : 'rgba(80,10,16,0.22)';
          g.beginPath();
          g.moveTo(x, cy);
          g.lineTo(x - 26, cy - H * 0.5);
          g.moveTo(x, cy);
          g.lineTo(x - 26, cy + H * 0.5);
          g.stroke();
        }
        g.restore();
        g.strokeStyle = 'rgba(255,240,206,0.85)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(W * 0.03, cy);
        g.lineTo(W, cy);
        g.stroke();
        g.strokeStyle = 'rgba(84,8,16,0.5)';
        g.lineWidth = 2;
        g.stroke(vane);
      });
    }

    // Plumage du corps : petites plumes en écailles, pointées vers la queue.
    function bodyTex() {
      const t = canvasTex(512, 512, (g, W, H) => {
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#ffd88a');
        grad.addColorStop(0.45, '#ff9c2c');
        grad.addColorStop(1, '#d8401c');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        const rows = 16, cols = 16, cw = W / cols, rh = H / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = -1; c <= cols; c++) {
            const x = (c + (r % 2) * 0.5) * cw, y = r * rh;
            const p = new Path2D();
            p.moveTo(x - cw * 0.55, y);
            p.quadraticCurveTo(x - cw * 0.55, y + rh * 1.5, x, y + rh * 1.7);
            p.quadraticCurveTo(x + cw * 0.55, y + rh * 1.5, x + cw * 0.55, y);
            const fg = g.createLinearGradient(0, y, 0, y + rh * 1.7);
            fg.addColorStop(0, 'rgba(255,236,170,0.0)');
            fg.addColorStop(0.6, 'rgba(255,236,170,0.22)');
            fg.addColorStop(1, 'rgba(120,20,16,0.32)');
            g.fillStyle = fg;
            g.fill(p);
            g.strokeStyle = 'rgba(96,14,16,0.35)';
            g.lineWidth = 1.2;
            g.stroke(p);
          }
        }
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
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
      primary: featherTex('primary'),
      secondary: featherTex('secondary'),
      covert: featherTex('covert'),
      tail: featherTex('tail'),
      crest: featherTex('crest'),
      plume: plumeTex(),
      body: bodyTex(),
    };
    TEX.body.repeat.set(3, 2);
    const featherMat = (tex, glow) => new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow,
      alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.62, metalness: 0,
    });
    const MAT = {
      primary: featherMat(TEX.primary, 0.42),
      secondary: featherMat(TEX.secondary, 0.45),
      covert: featherMat(TEX.covert, 0.5),
      tail: featherMat(TEX.tail, 0.42),
      crest: featherMat(TEX.crest, 0.5),
      plume: featherMat(TEX.plume, 0.48),
      body: new THREE.MeshStandardMaterial({ map: TEX.body, emissiveMap: TEX.body, emissive: 0xffffff, emissiveIntensity: 0.42, roughness: 0.75 }),
      leg: new THREE.MeshStandardMaterial({ color: 0xe6a03c, roughness: 0.45, emissive: 0x5a2208, emissiveIntensity: 0.4 }),
      talon: new THREE.MeshStandardMaterial({ color: 0x1a0a0c, roughness: 0.25 }),
      beak: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, emissive: 0x3a1806, emissiveIntensity: 0.4 }),
      iris: new THREE.MeshStandardMaterial({ color: 0xffb21a, emissive: 0xff7a00, emissiveIntensity: 0.45, roughness: 0.15 }),
      pupil: new THREE.MeshStandardMaterial({ color: 0x080203, roughness: 0.05 }),
      brow: new THREE.MeshStandardMaterial({ color: 0xc23a18, emissive: 0x6a1408, emissiveIntensity: 0.5, roughness: 0.6 }),
    };

    /* ---------- Géométrie ---------- */
    const SPHERE = new THREE.SphereGeometry(1, 28, 20);
    const BODY_SPHERE = (() => { // pôles orientés vers l'avant et l'arrière, pour que le plumage pointe vers la queue
      const g = new THREE.SphereGeometry(1, 36, 24);
      g.rotateZ(-Math.PI / 2);
      return g;
    })();

    // Plume : un plan légèrement incurvé, base à l'origine, bout vers -X.
    function featherMesh(mat, L, w, bend) {
      const geo = new THREE.PlaneGeometry(L, w, 6, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-L / 2, 0, 0);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = -pos.getX(i) / L;
        pos.setY(i, pos.getY(i) + bend * L * t * t);
      }
      geo.computeVertexNormals();
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
    const torso = new THREE.Mesh(loftGeo([
      [-0.36, 0.012, 0.03, 0.045],
      [-0.27, 0.004, 0.072, 0.085],
      [-0.15, -0.004, 0.122, 0.128],
      [-0.01, -0.02, 0.155, 0.145],
      [0.1, -0.028, 0.162, 0.14],
      [0.19, -0.004, 0.138, 0.122],
      [0.25, 0.04, 0.112, 0.102],
      [0.3, 0.078, 0.094, 0.087],
      [0.34, 0.105, 0.082, 0.077],
    ], 52, 32), MAT.body);
    body.add(torso);
    // Camail : rangs de plumes pointues couchées sur le cou, qui retombent vers les épaules
    for (const [x, y, r, L] of [[0.22, 0.03, 0.125, 0.16], [0.27, 0.06, 0.106, 0.14], [0.31, 0.088, 0.09, 0.12]]) {
      for (const a of [-1.75, -1.15, -0.55, 0, 0.55, 1.15, 1.75]) {
        const m = featherMesh(MAT.covert, L, 0.075, 0.12);
        m.position.set(x + 0.02, y + Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
        m.rotation.set(a, 0, 0.18);
        body.add(m);
      }
    }
    anchors.push(anchor(body, -0.05, 0.13, 0, 1), anchor(body, -0.2, 0.08, 0, 1), anchor(body, 0.15, -0.12, 0, 0.9));
    flameAt(body, -0.08, 0.12, 0.03, 1, 0.2);
    flameAt(body, -0.22, 0.07, -0.03, 1, 0.18);

    // Tête de rapace : crâne allongé et plat, joues pleines, arcades saillantes, gros bec crochu
    const headTex = canvasTex(256, 256, (g, W, H) => {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#a8241c');
      grad.addColorStop(0.3, '#e0501c');
      grad.addColorStop(0.55, '#ff9a2c');
      grad.addColorStop(0.8, '#ffcf72');
      grad.addColorStop(1, '#ffe6a6');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // petites plumes fines, plus serrées que sur le corps
      for (let r = 0; r < 22; r++) {
        for (let c = -1; c <= 22; c++) {
          const x = (c + (r % 2) * 0.5) * (W / 22), y = r * (H / 22), w = W / 22;
          g.beginPath();
          g.moveTo(x - w * 0.5, y);
          g.quadraticCurveTo(x, y + w * 1.6, x + w * 0.5, y);
          g.strokeStyle = 'rgba(96,14,16,0.22)';
          g.lineWidth = 1;
          g.stroke();
        }
      }
    });
    MAT.head = new THREE.MeshStandardMaterial({ map: headTex, emissiveMap: headTex, emissive: 0xffffff, emissiveIntensity: 0.38, roughness: 0.7 });
    MAT.cere = new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.4, emissive: 0x6a4a10, emissiveIntensity: 0.35 });
    MAT.eyeRing = new THREE.MeshStandardMaterial({ color: 0x3a0a0c, roughness: 0.35 });
    const HEAD_SPHERE = new THREE.SphereGeometry(1, 32, 24);

    const head = new THREE.Group();
    head.position.set(0.37, 0.122, 0);
    body.add(head);
    const skull = new THREE.Mesh(HEAD_SPHERE, MAT.head);
    skull.scale.set(0.108, 0.072, 0.07);
    head.add(skull);
    const nape = new THREE.Mesh(HEAD_SPHERE, MAT.head);
    nape.scale.set(0.07, 0.07, 0.066);
    nape.position.set(-0.04, -0.01, 0);
    head.add(nape);
    const cheek = new THREE.Mesh(HEAD_SPHERE, MAT.head);
    cheek.scale.set(0.066, 0.046, 0.064);
    cheek.position.set(0.035, -0.032, 0);
    head.add(cheek);
    // Bec crochu, extrudé à partir de son profil
    const beakShape = new THREE.Shape();
    beakShape.moveTo(0, 0.026);
    beakShape.quadraticCurveTo(0.07, 0.032, 0.104, -0.012);
    beakShape.quadraticCurveTo(0.099, -0.03, 0.087, -0.021);
    beakShape.quadraticCurveTo(0.068, -0.004, 0.03, -0.011);
    beakShape.lineTo(0, -0.019);
    beakShape.closePath();
    const beakGeo = new THREE.ExtrudeGeometry(beakShape, { depth: 0.034, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 3, curveSegments: 12 });
    beakGeo.translate(0, 0, -0.017);
    {
      const pos = beakGeo.attributes.position, col = [];
      const a = new THREE.Color('#ffe9a8'), b = new THREE.Color('#f2b13a'), c = new THREE.Color('#4a200c');
      for (let i = 0; i < pos.count; i++) {
        const t = clamp(pos.getX(i) / 0.104, 0, 1);
        const k = t < 0.62 ? a.clone().lerp(b, t / 0.62) : b.clone().lerp(c, (t - 0.62) / 0.38);
        col.push(k.r, k.g, k.b);
      }
      beakGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    const beak = new THREE.Mesh(beakGeo, MAT.beak);
    beak.position.set(0.078, -0.006, 0);
    beak.scale.set(1.3, 1.3, 1.25);
    head.add(beak);
    const cere = new THREE.Mesh(HEAD_SPHERE, MAT.cere);
    cere.scale.set(0.022, 0.02, 0.028);
    cere.position.set(0.084, 0.008, 0);
    head.add(cere);
    const jawShape = new THREE.Shape();
    jawShape.moveTo(0, 0);
    jawShape.quadraticCurveTo(0.05, -0.004, 0.075, -0.012);
    jawShape.quadraticCurveTo(0.05, -0.022, 0, -0.02);
    jawShape.closePath();
    const jawGeo = new THREE.ExtrudeGeometry(jawShape, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 2 });
    jawGeo.translate(0, 0, -0.013);
    {
      const pos = jawGeo.attributes.position, col = [];
      for (let i = 0; i < pos.count; i++) col.push(0.95, 0.62, 0.2);
      jawGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    const jaw = new THREE.Group();
    jaw.position.set(0.08, -0.03, 0);
    jaw.scale.set(1.25, 1.25, 1.2);
    jaw.add(new THREE.Mesh(jawGeo, MAT.beak));
    head.add(jaw);
    // Yeux sous l'arcade, cerclés de sombre, et trait sombre qui file vers l'arrière
    const eyes = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(0.048, 0.01, 0.05 * s);
      const ring = new THREE.Mesh(HEAD_SPHERE, MAT.eyeRing);
      ring.scale.set(0.022, 0.019, 0.012);
      const iris = new THREE.Mesh(HEAD_SPHERE, MAT.iris);
      iris.scale.set(0.017, 0.016, 0.012);
      iris.position.z = 0.004 * s;
      const pupil = new THREE.Mesh(HEAD_SPHERE, MAT.pupil);
      pupil.scale.setScalar(0.009);
      pupil.position.set(0.003, 0, 0.011 * s);
      e.add(ring, iris, pupil);
      head.add(e);
      eyes.push(e);
      const stripe = new THREE.Mesh(HEAD_SPHERE, MAT.eyeRing);
      stripe.scale.set(0.045, 0.007, 0.01);
      stripe.position.set(0.008, 0.006, 0.058 * s);
      stripe.rotation.set(0, -0.35 * s, 0.12);
      head.add(stripe);
      // Arcade sourcilière : en avancée au-dessus de l'œil, inclinée vers le bec
      const brow = new THREE.Mesh(HEAD_SPHERE, MAT.brow);
      brow.scale.set(0.05, 0.014, 0.026);
      brow.position.set(0.052, 0.03, 0.043 * s);
      brow.rotation.set(0, 0.28 * s, -0.22);
      head.add(brow);
    }
    // Aigrette : longues plumes couchées vers l'arrière, comme une crinière qui flotte
    const crest = [];
    for (let i = 0; i < 9; i++) {
      const k = (i - 4) / 4;
      const L = 0.4 - Math.abs(k) * 0.12;
      const m = featherMesh(MAT.crest, L, 0.085, 0.32);
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
      bone(shoulder, 0.3, 0.029);
      bone(elbow, 0.34, 0.024);
      bone(wrist, 0.26, 0.018);
      const feathers = [], tips = [];
      const add = (group, mat, L, w, x, y, z, ext, fold, bend) => {
        const m = featherMesh(mat, L, w, bend);
        m.position.set(x, y, z);
        group.add(m);
        feathers.push({ m, ext, fold });
        return m;
      };
      // Rémiges primaires, sur la main
      for (let i = 0; i < 10; i++) {
        const r = i / 9;
        const L = lerp(0.42, 0.6, r) * (i === 9 ? 0.92 : 1);
        const m = add(wrist, MAT.primary, L, 0.085, 0, 0.0014 * (10 - i), 0.02 + i * 0.026, lerp(0.42, 1.42, r ** 0.9), 1.5, 0.1);
        if (i >= 5) tips.push(anchor(m, -L, 0, 0, 0.8));
        if (i % 2 === 1) flameAt(m, -L * 0.85, 0, 0, 0.85, 0.2);
      }
      // Rémiges secondaires, sur l'avant-bras
      for (let i = 0; i < 12; i++) {
        const r = i / 11;
        const sec = add(elbow, MAT.secondary, 0.34, 0.1, -0.005, 0.016 + 0.0013 * (12 - i), 0.012 + i * 0.026, lerp(0.05, 0.38, r), -1.45, 0.06);
        if (i % 3 === 1) flameAt(sec, -0.3, 0, 0, 0.9, 0.17);
      }
      // Tertiaires, près du corps
      for (let i = 0; i < 4; i++) add(shoulder, MAT.secondary, 0.3, 0.1, -0.01, 0.034 + 0.0013 * i, 0.05 + i * 0.055, -0.12, 0.55, 0.05);
      // Grandes couvertures
      for (let i = 0; i < 9; i++) add(elbow, MAT.covert, 0.18, 0.08, 0.03, 0.05 + 0.001 * i, 0.02 + i * 0.033, lerp(0.05, 0.38, i / 8), -1.45, 0.08);
      for (let i = 0; i < 6; i++) add(wrist, MAT.covert, 0.17, 0.07, 0.025, 0.05 + 0.001 * i, 0.02 + i * 0.04, lerp(0.45, 1.3, i / 5), 1.5, 0.08);
      // Petites couvertures
      for (let i = 0; i < 9; i++) add(elbow, MAT.covert, 0.1, 0.065, 0.06, 0.062 + 0.001 * i, 0.02 + i * 0.033, 0.2, -1.4, 0.1);
      for (let i = 0; i < 5; i++) add(shoulder, MAT.covert, 0.12, 0.07, 0.045, 0.066 + 0.001 * i, 0.04 + i * 0.05, -0.05, 0.5, 0.1);
      tips.push(anchor(wrist, 0, 0, 0.26, 0.9));
      return { root, shoulder, elbow, wrist, feathers, tips };
    }
    const wings = [buildWing(1), buildWing(-1)];
    for (const w of wings) { body.add(w.root); anchors.push(...w.tips); }

    // Queue : rectrices en éventail, et trois longues plumes souples qui ondulent
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
      tailFeathers.push({ m, k });
      anchors.push(anchor(m, -L, 0, 0, 0.75));
      if (i % 3 === 1) flameAt(m, -L * 0.8, 0, 0, 0.8, 0.22);
    }
    const plumes = [];
    for (const j of [-1, 0, 1]) {
      const segs = [];
      let parent = tail;
      const SEG = 4, SL = 0.34 + (j ? 0 : 0.06);
      for (let i = 0; i < SEG; i++) {
        const g = new THREE.Group();
        if (i) g.position.x = -SL;
        else g.position.set(-0.05, 0.012, j * 0.03);
        const geo = new THREE.PlaneGeometry(SL, 0.16, 3, 1);
        geo.rotateX(-Math.PI / 2);
        geo.translate(-SL / 2, 0, 0);
        const uv = geo.attributes.uv;
        for (let v = 0; v < uv.count; v++) uv.setX(v, 1 - (i + 1 - uv.getX(v)) / SEG);
        const m = new THREE.Mesh(geo, MAT.plume);
        m.rotation.x = 1.25 + j * 0.15; // vexille tournée vers le côté, visible de profil
        g.add(m);
        parent.add(g);
        segs.push(g);
        parent = g;
      }
      anchors.push(anchor(segs[SEG - 1], -SL, 0, 0, 0.7));
      flameAt(segs[SEG - 1], -SL * 0.7, 0, 0, 0.75, 0.24);
      plumes.push({ segs, j });
    }

    // Pattes : cuisse emplumée, tarse écailleux, doigts et serres
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.03, -0.075, 0.055 * s);
      body.add(hip);
      const thigh = new THREE.Mesh(BODY_SPHERE, MAT.body);
      thigh.scale.set(0.045, 0.07, 0.034);
      thigh.position.set(-0.015, -0.025, -0.012 * s);
      hip.add(thigh);
      // Culotte de plumes qui retombe sur la cuisse
      for (const [a, L] of [[-0.6, 0.13], [0, 0.15], [0.6, 0.13]]) {
        const f = featherMesh(MAT.covert, L, 0.07, 0.1);
        f.position.set(0.01, 0.01, Math.sin(a) * 0.035);
        f.rotation.order = 'ZYX';
        f.rotation.set(Math.PI / 2 + a * 0.6, 0, Math.PI / 2 - 0.15);
        hip.add(f);
      }
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
    scene.add(new THREE.HemisphereLight(0xfff2dc, 0x6a1c12, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, 1, 0.9);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9a40, 1.4);
    rim.position.set(0.5, 0.25, -1);
    scene.add(rim);

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
    let fireBoost = 1, fireUnit = 40, preHeat = 0, shake = 0;
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

    // Image de densité (demi-résolution) → image du feu (résolution CSS) → plaquée sur l'écran
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
    // Traversée de l'écran : des flammes lèchent les bords à son approche ; à l'impact, flash, onde de choc
    // et mur de feu ; puis l'écran se consume depuis le centre — un trou aux bords calcinés et incandescents.
    const impactMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, k: { value: -1 }, pre: { value: 0 }, aspect: { value: 1 }, shake: { value: new THREE.Vector2() } },
      vertexShader: FULL_VS,
      fragmentShader: FIRE_GLSL + `
        uniform float time; uniform float k; uniform float pre; uniform float aspect; uniform vec2 shake; varying vec2 vUv;
        vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
        // Feu « réel » à partir d'une intensité : langues étirées, translucides au bord, jaunes au cœur
        vec4 burn(float I) {
          float a = smoothstep(0.0, 0.4, I) * 0.95;
          return vec4(fireColor(clamp(I * 1.05, 0.0, 1.0)) * a, a);
        }
        void main() {
          vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5) + shake;
          vec2 qa = vec2(p.x * 7.0, p.y * 2.6);
          float n1 = fbm(qa + vec2(0.0, -time * 1.6));
          float n2 = fbm(qa * 2.1 + vec2(4.0, -time * 3.6));
          float tn = n2 * 0.6 + n1 * 0.4;
          if (k < 0.0) {
            // Avant l'impact : le feu monte du bas de l'écran et lèche les côtés
            float e = min(min(vUv.x, 1.0 - vUv.x) * aspect * 1.6, vUv.y);
            float I = pre * pre * (0.62 - e * 2.6) * (0.35 + 1.3 * tn) - 0.08;
            vec4 c = burn(I);
            if (c.a < 0.003) discard;
            gl_FragColor = c;
            return;
          }
          float r = length(p);
          float n = fbm(p * 2.4 + vec2(0.0, -time * 1.2));
          float rr = r + (n - 0.5) * 0.5 + (n2 - 0.5) * 0.12;
          float Ro = 2.2 * (1.0 - exp(-k * 7.0));                // le mur de feu jaillit du centre
          float Ri = 2.6 * pow(clamp((k - 0.45) / 1.6, 0.0, 1.0), 1.2) - 0.25; // puis le trou s'élargit
          float front = max(0.0, rr - Ri);
          float wall = smoothstep(Ro, Ro - 0.35, rr) * smoothstep(0.0, 0.05, front);
          float I = wall * ((0.3 + 1.1 * tn) * (1.0 + 0.4 * exp(-k * 4.0)) + 0.45 * exp(-front * 7.0) * step(0.0, Ri))
                  - 0.14 - 0.25 * smoothstep(1.4, 2.1, k);
          vec4 c = burn(I);
          float burning = smoothstep(-0.1, 0.05, Ri) * (1.0 - smoothstep(1.8, 2.15, k));
          // Liseré de braises au bord du trou, et bord calciné juste à l'intérieur
          float e = burning * exp(-pow((rr - Ri) / 0.016, 2.0)) * (0.75 + 0.5 * n2);
          float charA = 0.75 * burning * smoothstep(Ri - 0.06, Ri - 0.005, rr) * step(rr, Ri);
          c = over(vec4(vec3(0.12, 0.04, 0.02) * charA, charA), c);
          c = over(vec4(vec3(1.0, 0.72, 0.25) * min(1.0, e), min(1.0, e)), c);
          // Onde de choc et flash
          float R = k * 3.6;
          float ring = 0.8 * exp(-pow((r - R) / (0.02 + 0.06 * k), 2.0)) * (1.0 - smoothstep(0.0, 0.5, k));
          c = over(vec4(vec3(1.0, 0.9, 0.66) * ring, ring), c);
          float fa = 0.9 * exp(-k * 16.0) * (1.0 - 0.5 * smoothstep(0.0, 1.0, r));
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
    const P_HOVER = 0.5, P_AWAY = 1.9, P_TURN = 2.7, P_APPROACH = 1.8;
    const farZ = () => -0.8 * D; // assez loin pour prendre de l'élan, assez près pour rester bien visible
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
        fireBoost = 1 + 1.2 * u; // le feu enfle à mesure qu'il approche
        preHeat = clamp((u - 0.5) / 0.5, 0, 1); // la chaleur gagne les bords de l'écran
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
      const n = 260 * quality;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = rand(0.8, 2.2) * Math.max(W, H), r0 = rand(0, 0.25) * Math.min(W, H);
        spawn(fire, i % 3 ? FLAME : SPARK, Math.cos(a) * r0, Math.sin(a) * r0, D * 0.3, Math.cos(a) * v, Math.sin(a) * v, 0,
          rand(0.35, 0.75), i % 3 ? S * rand(0.5, 1.1) : S * rand(0.05, 0.1), rand(0.85, 1));
      }
      addFlash(new V3(0, 0, D * 0.5), Math.max(W, H) * 0.6, 0.55);
      shake = 28;
      preHeat = 0;
      st.state = 'away';
      st.timer = 1.5;
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
        for (const f of w.feathers) f.m.rotation.y = lerp(f.fold, f.ext, ext);
      }
      // Queue en éventail, longues plumes qui ondulent
      for (const f of tailFeathers) f.m.rotation.y = f.k * 0.32 * st.tailSpread;
      tail.rotation.z = lerp(0.04, 0.12, st.legs) + 0.05 * Math.sin(time * 2);
      const speed = st.vel.length() / S;
      for (const p of plumes) {
        p.segs.forEach((g, i) => {
          g.rotation.z = (i ? 0.16 : 0.05) * Math.sin(time * 2.6 - i * 0.9 + p.j) + (i ? 0.1 * (1 - Math.min(1, speed / 3)) : 0.05);
          g.rotation.y = (i ? 0.08 : p.j * 0.18) * Math.sin(time * 1.9 - i * 0.7 + p.j * 2);
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
      applyPose();
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
        if (impactT > 2.2) impactT = -1;
      }
      if (st.state !== 'pass') { fireBoost = ease(fireBoost, 1, dt, 3); preHeat = 0; }
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
      if (impactT >= 0 || preHeat > 0.01) {
        impactMat.uniforms.k.value = impactT;
        impactMat.uniforms.pre.value = preHeat;
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
        const fr = Math.min(1, renderer.getPixelRatio());
        densRT.setSize(Math.max(1, Math.round(W * 0.5)), Math.max(1, Math.round(H * 0.5)));
        fireRT.setSize(Math.max(1, Math.round(W * fr)), Math.max(1, Math.round(H * fr)));
        fxRT.setSize(Math.max(1, Math.round(W * fr)), Math.max(1, Math.round(H * fr)));
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
