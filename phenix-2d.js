/*!
 * Phénix 2D : un oiseau de feu dessiné qui se promène sur une page HTML.
 * C'est la version de secours de phenix.js (3D), chargée automatiquement quand WebGL
 * ou three.js ne sont pas disponibles. Elle s'utilise aussi seule, sans dépendance :
 *
 *   <script src="phenix-2d.js" defer></script>
 *
 * Réglages, en attributs de la balise <script> :
 *   data-taille="90"            taille de l'oiseau, en pixels
 *   data-perchoirs="h1, img"    sélecteur CSS des éléments où il peut se poser
 *
 * API : Phenix.renaitre(), Phenix.auCentre(), Phenix.traverser(), Phenix.pause(),
 *       Phenix.reprendre(), Phenix.masquer(), Phenix.afficher(), Phenix.etat()
 */
(() => {
  'use strict';
  // Chargée par phenix.js, elle se branche sur l'API déjà en place ; seule, elle crée la sienne.
  const host = window.Phenix && window.Phenix.__attach ? window.Phenix : null;
  if (window.Phenix && !host) return;

  const script = document.currentScript;
  const opts = (host && host.__options) || (script && script.dataset) || {};
  const PERCHES = opts.perchoirs || 'h1, h2, h3, img, button, [data-phenix-perchoir], .phenix-perchoir';
  const TEXTUAL = 'h1, h2, h3, h4, h5, h6, p, a, span, li, label, strong, em';

  /* ---------- Couleurs ---------- */
  const INK = 'rgba(58, 8, 16, 0.42)';            // séparation très légère entre les plumes
  const INK_SOFT = 'rgba(80, 12, 20, 0.42)';      // barbes, écailles, hachures
  const SHADE = 'rgba(112, 14, 24, 0.36)';        // ombre de chaque plume
  const SHINE = 'rgba(255, 246, 214, 0.42)';      // reflet de chaque plume
  const BARB_DARK = 'rgba(80, 12, 18, 0.26)';     // barbes côté ombre
  const BARB_LIGHT = 'rgba(255, 228, 172, 0.3)';  // barbes côté lumière
  const RACHIS = 'rgba(255, 234, 176, 0.7)';      // tige claire au centre des plumes
  const INK_W = 0.009;        // épaisseur des séparations, en fraction de la taille de l'oiseau
  const FOOT = [0.06, 0.62];  // point d'appui des serres, repère local
  // Feu : température 0 → 1, de la braise rouge sombre au blanc incandescent
  // (pas de blanc pur : le feu doit rester visible sur une page claire)
  const RAMP = [
    [0, [104, 16, 26]],
    [0.25, [190, 34, 26]],
    [0.45, [236, 82, 28]],
    [0.65, [252, 136, 38]],
    [0.82, [255, 186, 64]],
    [1, [255, 226, 120]],
  ];

  const TAU = Math.PI * 2;
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const norm = (x, y) => { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; };
  const rot2 = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
  const lerp2 = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const quadPt = (ax, ay, cx, cy, bx, by, u) => {
    const v = 1 - u;
    return [v * v * ax + 2 * v * u * cx + u * u * bx, v * v * ay + 2 * v * u * cy + u * u * by];
  };
  const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Formes de base ---------- */
  function circle(x, y, r) { const p = new Path2D(); p.arc(x, y, r, 0, TAU); return p; }
  function oval(x, y, rx, ry, rot) { const p = new Path2D(); p.ellipse(x, y, rx, ry, rot, 0, TAU); return p; }

  // Plume en forme de flamme : base arrondie, pointe effilée, petite flammèche sur le côté.
  function tongue(bx, by, dx, dy, len, w, flick, curl) {
    const px = -dy, py = dx;
    const P = (a, b) => [bx + dx * len * a + px * w * b, by + dy * len * a + py * w * b];
    const p = new Path2D();
    let a = P(0, -1), c, q;
    p.moveTo(a[0], a[1]);
    c = P(0.3, -1.3); q = P(0.52, -0.9);
    p.quadraticCurveTo(c[0], c[1], q[0], q[1]);
    if (flick) {
      q = P(0.62, -1.75); p.lineTo(q[0], q[1]);
      q = P(0.64, -0.72); p.lineTo(q[0], q[1]);
    }
    c = P(0.82, -0.5 + curl * 2); q = P(1, curl * 3);
    p.quadraticCurveTo(c[0], c[1], q[0], q[1]);
    c = P(0.6, 1.2); q = P(0, 1);
    p.quadraticCurveTo(c[0], c[1], q[0], q[1]);
    c = P(-0.4, 0); a = P(0, -1);
    p.quadraticCurveTo(c[0], c[1], a[0], a[1]);
    p.closePath();
    return p;
  }

  function smoothTo(p, pts, move) {
    if (move) p.moveTo(pts[0][0], pts[0][1]); else p.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      p.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    const l = pts[pts.length - 1];
    p.lineTo(l[0], l[1]);
  }

  // Ruban à largeur variable le long d'une ligne de points.
  function ribbonW(pts, wf) {
    const n = pts.length, left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const [tx, ty] = norm(b[0] - a[0], b[1] - a[1]);
      const w = wf(i / (n - 1));
      left.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
      right.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    const p = new Path2D();
    smoothTo(p, left, true);
    smoothTo(p, right.reverse(), false);
    p.closePath();
    return p;
  }

  /* ---------- État ---------- */
  let canvas, ctx, hit;
  let W = 0, H = 0, DPR = 1, S = 80;
  let paused = false, hidden = false, raf = 0, last = 0, time = 0;
  let dirty = null, hitPos = '';
  let detail = 2;        // niveau de détail selon la taille : barbes et hachures retirées en petit
  let quality = 1, workEma = 6;
  const fx = [];
  const pointer = { x: -1e5, y: -1e5, moved: -1e5 };
  const bird = {
    x: -400, y: 200, vx: 0, vy: 0, bob: 0, face: 1, tilt: 0, lean: 0,
    yaw: 1, yawTarget: 1, sq: 1, zs: 1, passT: 0, lastCenter: -99, front: false,
    phase: 0, glide: 0, gliding: false, glideT: 0, beats: 6, up: 0, tailSpread: 0.7,
    fold: 0, e: 0, breath: 0,
    blinkT: 0, nextBlink: 2, beak: 0, stretch: 0, nextStretch: 8,
    state: 'fly', target: null, perch: null, lastPerch: null,
    timer: 0, flyTime: 0, lastFlip: -1, startle: 0, pillar: false, burstX: 0, burstY: 0,
  };

  /* ---------- Particules de feu (tableaux typés, retrait par permutation) ---------- */
  const PMAX = 4000;
  const FLAME = 0, SPARK = 1, SMOKE = 2;
  const pX = new Float32Array(PMAX), pY = new Float32Array(PMAX);
  const pVX = new Float32Array(PMAX), pVY = new Float32Array(PMAX);
  const pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX);
  const pSize = new Float32Array(PMAX), pHeat = new Float32Array(PMAX), pSeed = new Float32Array(PMAX);
  const pKind = new Uint8Array(PMAX), pFront = new Uint8Array(PMAX);
  let count = 0;
  const NS = 24;
  let SPR = [], SMOKE_SPR = null;

  function makeSprites() {
    SPR = [];
    for (let i = 0; i < NS; i++) {
      const k = i / (NS - 1);
      let col = RAMP[RAMP.length - 1][1];
      for (let j = 1; j < RAMP.length; j++) {
        if (k <= RAMP[j][0]) {
          const [k0, c0] = RAMP[j - 1], [k1, c1] = RAMP[j], f = (k - k0) / (k1 - k0);
          col = [lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)];
          break;
        }
      }
      // Langue de flamme : bulbe en bas, pointe effilée en haut, cœur plus chaud que le bord
      const hot = [lerp(col[0], 255, 0.5), lerp(col[1], 236, 0.5), lerp(col[2], 150, 0.5)];
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 128;
      const x = c.getContext('2d');
      const drop = (sc, cc, a) => {
        // goutte : pointe en haut, bulbe en bas, opaque au bulbe et transparente à la pointe
        const P = (px, py) => [32 + (px - 32) * sc, 100 + (py - 100) * sc];
        const p = new Path2D();
        let q = P(32, 14); p.moveTo(q[0], q[1]);
        const curve = (a1, a2, b1, b2, c1, c2) => { const u = P(a1, a2), v = P(b1, b2), w = P(c1, c2); p.bezierCurveTo(u[0], u[1], v[0], v[1], w[0], w[1]); };
        curve(38, 40, 52, 64, 52, 90);
        curve(52, 106, 43, 114, 32, 114);
        curve(21, 114, 12, 106, 12, 90);
        curve(12, 64, 26, 40, 32, 14);
        const top = P(32, 14)[1], bottom = P(32, 114)[1];
        const g = x.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, rgba(cc[0], cc[1], cc[2], 0));
        g.addColorStop(0.45, rgba(cc[0], cc[1], cc[2], a * 0.8));
        g.addColorStop(1, rgba(cc[0], cc[1], cc[2], a));
        x.fillStyle = g;
        x.fill(p);
      };
      x.filter = 'blur(4px)'; // ignoré par les navigateurs qui ne le gèrent pas : la flamme reste nette
      drop(1, col, 0.95);
      x.filter = 'blur(3px)';
      drop(0.55, hot, 0.9);
      x.filter = 'none';
      SPR.push(c);
    }
    SMOKE_SPR = document.createElement('canvas');
    SMOKE_SPR.width = SMOKE_SPR.height = 64;
    const x = SMOKE_SPR.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(74,62,64,0.55)');
    g.addColorStop(0.5, 'rgba(74,62,64,0.25)');
    g.addColorStop(1, 'rgba(74,62,64,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  }

  function spawnP(kind, x, y, vx, vy, life, size, heat, front) {
    if (count >= PMAX) return;
    const i = count++;
    pKind[i] = kind; pX[i] = x; pY[i] = y; pVX[i] = vx; pVY[i] = vy;
    pLife[i] = 0; pMax[i] = life; pSize[i] = size; pHeat[i] = heat; pSeed[i] = Math.random() * TAU; pFront[i] = front;
  }
  function moveP(from, to) {
    pKind[to] = pKind[from]; pX[to] = pX[from]; pY[to] = pY[from]; pVX[to] = pVX[from]; pVY[to] = pVY[from];
    pLife[to] = pLife[from]; pMax[to] = pMax[from]; pSize[to] = pSize[from]; pHeat[to] = pHeat[from];
    pSeed[to] = pSeed[from]; pFront[to] = pFront[from];
  }
  function emitN(expected, fn) {
    let n = expected | 0;
    if (Math.random() < expected - n) n++;
    for (let i = 0; i < n; i++) fn();
  }

  function updateParticles(dt) {
    const rise = 1.7 * S;
    const dF = Math.exp(-2.1 * dt), dE = Math.exp(-0.9 * dt), dS = Math.exp(-1.2 * dt);
    for (let i = 0; i < count; i++) {
      pLife[i] += dt;
      if (pLife[i] >= pMax[i]) {
        const j = --count;
        if (i !== j) moveP(j, i);
        i--;
        continue;
      }
      const k = pKind[i];
      if (k === FLAME) {
        pVY[i] -= rise * dt;
        pVX[i] += Math.sin(pY[i] * 0.02 + time * 2.8 + pSeed[i]) * 0.6 * S * dt;
        pVX[i] *= dF; pVY[i] *= dF;
      } else if (k === SPARK) {
        pVY[i] -= 0.45 * S * dt;
        pVX[i] += Math.sin(time * 1.9 + pSeed[i] * 3) * 0.5 * S * dt;
        pVX[i] *= dE; pVY[i] *= dE;
      } else {
        pVY[i] -= 0.35 * S * dt;
        pVX[i] += Math.sin(time * 0.9 + pSeed[i]) * 0.2 * S * dt;
        pVX[i] *= dS; pVY[i] *= dS;
      }
      pX[i] += pVX[i] * dt;
      pY[i] += pVY[i] * dt;
    }
  }

  /* ---------- Perchoirs ---------- */
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
    if (el === hit || el === canvas || !el.isConnected) return false;
    const r = perchRect(el);
    return r.width >= S * 0.8 && r.height > 4 && r.top > S * 1.9 && r.top < H - S * 0.3 && r.right > S && r.left < W - S;
  }
  function candidates() {
    let list;
    try { list = document.querySelectorAll(PERCHES); } catch (err) { return []; }
    const out = [];
    for (const el of list) if (perchable(el)) out.push(el);
    return out;
  }
  function perchPoint(tg) {
    if (!tg.el) return { x: tg.x, y: tg.y };
    const r = perchRect(tg.el);
    const lo = Math.max(r.left + S * 0.3, S * 0.9), hi = Math.min(r.right - S * 0.3, W - S * 0.9);
    return { x: hi > lo ? lerp(lo, hi, tg.fx) : (r.left + r.right) / 2, y: r.top };
  }
  // Position des serres par rapport au centre de l'oiseau, pour une orientation donnée.
  // fs : sens et largeur apparente (face × sq).
  function footOffset(fs, tilt) {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const x = FOOT[0] * fs * S, y = FOOT[1] * S;
    return [x * c - y * s, x * s + y * c];
  }
  function toWorld(lx, ly) {
    const c = Math.cos(bird.tilt), s = Math.sin(bird.tilt), k = S * bird.zs;
    const x = lx * bird.face * bird.sq * k, y = ly * k;
    return [bird.x + x * c - y * s, bird.y + bird.bob + x * s + y * c];
  }

  // Pivot : yaw va de -1 (tourné vers la gauche) à 1 (vers la droite) en passant par 0,
  // où on le voit de face ou de dos ; sa largeur apparente se resserre puis se rouvre.
  function turnToward(dt, rate) {
    const d = bird.yawTarget - bird.yaw, step = rate * dt;
    bird.yaw += Math.abs(d) < step ? d : Math.sign(d) * step;
    if (bird.yaw > 0.001) bird.face = 1;
    else if (bird.yaw < -0.001) bird.face = -1;
    bird.sq = 0.2 + 0.8 * Math.abs(bird.yaw) ** 0.75;
  }
  function faceNow(f) {
    bird.face = bird.yaw = bird.yawTarget = f;
    bird.sq = 1;
  }

  /* ---------- Comportement ---------- */
  function centerTarget(pass) {
    return { x: W / 2, y: H / 2, center: true, pass: pass === undefined ? Math.random() < 0.5 : pass };
  }
  function pickTarget() {
    const list = bird.flyTime > 1.5 ? candidates().filter((el) => el !== bird.lastPerch) : [];
    const r = Math.random();
    if (list.length && r < 0.5) {
      bird.target = { el: list[(Math.random() * list.length) | 0], fx: rand(0.1, 0.9) };
    } else if (!reduce.matches && bird.flyTime > 1.5 && time - bird.lastCenter > 10 && r < 0.78) {
      bird.target = centerTarget();
    } else {
      bird.target = {
        x: rand(S * 1.1, Math.max(S * 1.1, W - S * 1.1)),
        y: rand(S * 1.5, Math.max(S * 1.5, H - S * 1.7)),
      };
    }
  }

  function sparksAt(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0), v = rand(0.3, 1) * speed * S;
      spawnP(SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.6, 1.4), S * rand(0.01, 0.02) + 1, 1, 1);
    }
  }

  function land() {
    bird.state = 'perch';
    bird.perch = bird.target;
    bird.lastPerch = bird.target.el || null;
    bird.vx = 0; bird.vy = 0; bird.glide = 0; bird.gliding = false; bird.up = 0;
    bird.timer = rand(4, 9);
    bird.flyTime = 0;
    bird.nextStretch = rand(3, 7);
    const [fx0, fy0] = toWorld(FOOT[0], FOOT[1]);
    if (!reduce.matches) sparksAt(fx0, fy0, 14, 1.4);
  }

  function takeoff(away) {
    const [fx0, fy0] = toWorld(FOOT[0], FOOT[1]);
    bird.state = 'fly';
    bird.flyTime = 0;
    bird.phase = Math.PI / 2;
    bird.beats = 6;
    bird.gliding = false;
    if (away) {
      const dir = bird.x > pointer.x ? 1 : -1;
      bird.yawTarget = dir;
      bird.target = {
        x: clamp(bird.x + dir * rand(3, 6) * S, S * 1.1, Math.max(S * 1.1, W - S * 1.1)),
        y: clamp(bird.y - rand(1, 3) * S, S * 1.5, Math.max(S * 1.5, H - S * 1.7)),
      };
      bird.vx = dir === bird.face ? dir * 2.4 * S : 0; bird.vy = -3 * S;
    } else {
      pickTarget();
      bird.vx = bird.face * 1.2 * S; bird.vy = -2.6 * S;
    }
    sparksAt(fx0, fy0, 12, 1.2);
  }

  function updateFly(dt) {
    bird.flyTime += dt;
    let tg = bird.target;
    if (!tg || (tg.el && !perchable(tg.el))) { pickTarget(); tg = bird.target; }
    let tx, ty;
    if (tg.el) {
      const p = perchPoint(tg);
      const off = footOffset(bird.face, 0);
      tx = p.x - off[0]; ty = p.y - off[1];
    } else {
      tx = tg.x; ty = tg.y;
    }
    const dx = tx - bird.x, dy = ty - bird.y, dist = Math.hypot(dx, dy) || 1;
    // Changement de direction : il freine, pivote (on le voit un instant de face, ailes levées),
    // prend un peu de hauteur, puis repart dans l'autre sens.
    if (Math.abs(dx) > 0.35 * S) bird.yawTarget = dx > 0 ? 1 : -1;
    turnToward(dt, 2.4);
    const turning = 1 - Math.abs(bird.yaw);
    const want = 3.6 * S * Math.min(1, dist / (tg.el ? 2.2 * S : 1.2 * S));
    let wantX = (dx / dist) * want;
    const wantY = (dy / dist) * want - turning * 0.9 * S;
    if (wantX * bird.face < 0) wantX = 0; // pas de marche arrière : il se retourne d'abord
    wantX *= Math.abs(bird.yaw);
    const k = Math.min(1, dt * 2.4);
    bird.vx += (wantX - bird.vx) * k;
    bird.vy += (wantY - bird.vy) * k;
    if (!(tg.el && dist < 2 * S)) bird.vy += Math.sin(time * 1.7) * 0.6 * S * dt;
    // Il s'écarte du curseur
    const px = bird.x - pointer.x, py = bird.y - pointer.y, pd = Math.hypot(px, py) || 1;
    if (pd < 1.3 * S && time - pointer.moved < 0.5) {
      bird.vx += (px / pd) * 9 * S * dt;
      bird.vy += (py / pd) * 9 * S * dt;
    }
    bird.x += bird.vx * dt;
    bird.y += bird.vy * dt;

    const speed = Math.hypot(bird.vx, bird.vy);
    const climbing = bird.vy < -0.6 * S;
    const landing = !!tg.el && dist < 1.4 * S;

    // Séries de battements, puis court plané ailes tendues ; jamais en montée ni à l'atterrissage
    if (bird.gliding) {
      bird.glideT -= dt;
      if (bird.glideT <= 0 || climbing || landing || turning > 0.1) { bird.gliding = false; bird.beats = 4 + ((Math.random() * 4) | 0); }
    }
    bird.glide += ((bird.gliding ? 1 : 0) - bird.glide) * Math.min(1, dt * 5);
    const freq = bird.flyTime < 0.6 ? 4 : landing ? 3.8 : climbing ? 3.3 : 2.7;
    const before = Math.floor(bird.phase / TAU);
    // Coup vers le bas rapide et puissant, remontée plus lente
    bird.phase += TAU * freq * dt * (Math.cos(bird.phase) < 0 ? 1.3 : 0.8) * (1 - bird.glide);
    if (Math.floor(bird.phase / TAU) !== before) {
      bird.beats--;
      if (bird.beats <= 0 && !climbing && !landing && turning < 0.05 && speed > 1.6 * S && bird.flyTime > 1.2) {
        bird.gliding = true;
        bird.glideT = rand(0.5, 1);
      }
    }
    bird.e = lerp(Math.sin(bird.phase), 0.22 + 0.04 * Math.sin(time * 3), bird.glide);
    bird.e = lerp(bird.e, 0.72, Math.min(1, turning * 1.3)); // ailes levées pendant le pivot
    // À la remontée, l'aile se replie au poignet ; à la descente, elle s'étend en grand
    bird.up = Math.max(0, Math.cos(bird.phase)) ** 0.7 * (1 - bird.glide) * (landing ? 0.4 : 1);
    bird.tailSpread += ((landing ? 1.35 : bird.glide > 0.5 ? 0.95 : 0.6) - bird.tailSpread) * Math.min(1, dt * 4);
    // Les serres sortent juste avant de se poser
    const legs = landing ? clamp(1 - dist / (1.4 * S), 0, 1) * 0.9 : 0;
    bird.fold += (legs - bird.fold) * Math.min(1, dt * 6);
    // Corps presque à l'horizontale en vol rapide, redressé en montée et pour se poser ; il tangue avec le battement
    const lean = (landing ? 0.12 : clamp(1.05 * Math.min(1, Math.abs(bird.vx) / (2.8 * S)) + 0.25 * clamp(bird.vy / (2 * S), -1, 1), 0, 1.2)) * (1 - turning);
    bird.lean += (lean - bird.lean) * Math.min(1, dt * 4);
    bird.tilt = bird.face * (bird.lean + 0.05 * Math.sin(bird.phase) * (1 - bird.glide));
    // Le corps monte à chaque coup d'aile vers le bas, et redescend à la remontée
    bird.bob = Math.sin(bird.phase) * 0.05 * S * (1 - bird.glide);

    if (tg.el ? dist < 0.25 * S : dist < 0.6 * S) {
      if (tg.el) land();
      else if (tg.center) arriveCenter(tg);
      else pickTarget();
    }
  }

  /* ---------- Au centre de l'écran : vol sur place, ou traversée de l'écran ---------- */
  // Vol sur place : corps redressé, ailes en V qui battent amplement, queue en éventail.
  function hoverPose(dt) {
    turnToward(dt, 3);
    bird.lean += (0 - bird.lean) * Math.min(1, dt * 5);
    bird.tilt = bird.face * bird.lean;
    bird.glide = 0;
    bird.gliding = false;
    bird.phase += TAU * 3.1 * dt * (Math.cos(bird.phase) < 0 ? 1.3 : 0.8);
    bird.e = 0.15 + 0.85 * Math.sin(bird.phase);
    bird.up = Math.max(0, Math.cos(bird.phase)) ** 0.7 * 0.5;
    bird.fold += (0 - bird.fold) * Math.min(1, dt * 6);
    bird.tailSpread += (1.25 - bird.tailSpread) * Math.min(1, dt * 4);
    bird.bob = Math.sin(bird.phase) * 0.06 * S * bird.zs;
  }

  function arriveCenter(tg) {
    bird.lastCenter = time;
    bird.vx = 0;
    bird.vy = 0;
    if (tg.pass) startPass();
    else { bird.state = 'hover'; bird.timer = rand(1.4, 2.4); }
  }

  function updateHover(dt) {
    hoverPose(dt);
    bird.vx += ((W / 2 - bird.x) * 6 - bird.vx * 4) * dt;
    bird.vy += ((H / 2 - bird.y) * 6 - bird.vy * 4) * dt;
    bird.x += bird.vx * dt;
    bird.y += bird.vy * dt;
    bird.timer -= dt;
    if (bird.timer <= 0) { bird.state = 'fly'; bird.flyTime = 2; bird.beats = 5; pickTarget(); }
  }

  // Traversée : il s'éloigne dans la profondeur de la page, puis fonce vers nous en grandissant
  // jusqu'à passer à travers l'écran.
  function startPass() {
    bird.state = 'pass';
    bird.passT = 0;
  }

  const APPROACH = 2.2; // durée du piqué vers l'écran, en secondes

  function updatePass(dt) {
    const t = (bird.passT += dt);
    const cx = W / 2, cy = H / 2, far = cy - 0.6 * S;
    let tx = cx, ty = cy;
    if (t < 1.8) {
      hoverPose(dt);
      bird.front = false;
      if (t >= 0.6) {
        const u = (t - 0.6) / 1.2, v = u * u * (3 - 2 * u);
        bird.zs = lerp(1, 0.3, v);
        ty = lerp(cy, far, v);
      } else {
        bird.zs = 1;
      }
    } else if (t < 2.1) {
      // Au loin, il pivote pour nous faire face : la vue de profil se resserre, la vue de face s'ouvre
      hoverPose(dt);
      bird.zs = 0.3;
      ty = far;
      const u = (t - 1.8) / 0.3;
      bird.front = u >= 0.5;
      bird.sq = u < 0.5 ? lerp(1, 0.2, u / 0.5) : lerp(0.2, 1, (u - 0.5) / 0.5);
      if (bird.front) { bird.tilt = 0; bird.bob = 0; }
    } else {
      // Comme un avion : ailes tendues à plat, sans battre, il plane droit sur nous en roulant un peu
      const u = Math.min(1, (t - 2.1) / APPROACH);
      bird.front = true;
      bird.face = 1;
      bird.sq = 1;
      bird.zs = 0.3 * Math.pow(9 / 0.3, u ** 2); // perspective : il grossit de plus en plus vite
      bird.tilt = 0.1 * Math.sin(time * 1.7) + 0.04 * Math.sin(time * 4.3);
      bird.bob = 0;
      tx = cx + Math.sin(time * 1.1) * 0.25 * S * bird.zs * (1 - u);
      ty = lerp(far, cy - 0.15 * H, u ** 1.5);
      if (u >= 1) { passThrough(); return; }
    }
    bird.x += (tx - bird.x) * Math.min(1, dt * 4);
    bird.y += (ty - bird.y) * Math.min(1, dt * 4);
    bird.vx = 0;
    bird.vy = 0;
  }

  // Il vient de passer à travers l'écran : on traverse ses flammes, puis il revient par un bord.
  function passThrough() {
    const cx = W / 2, cy = H / 2;
    const n = 260 * quality;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = rand(3, 9) * S, r0 = rand(0, 0.6) * S;
      spawnP(FLAME, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, Math.cos(a) * v, Math.sin(a) * v,
        rand(0.35, 0.7), S * rand(0.25, 0.6), rand(0.8, 1), 1);
    }
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * TAU, v = rand(4, 10) * S;
      spawnP(SPARK, cx, cy, Math.cos(a) * v, Math.sin(a) * v, rand(0.5, 1.1), S * rand(0.015, 0.03) + 1, 1, 1);
    }
    fx.push({ k: 'flash', x: cx, y: cy, r: Math.max(W, H) * 0.6, life: 0, max: 0.6 });
    bird.state = 'away';
    bird.timer = 0.9;
    bird.zs = 1;
    bird.front = false;
    bird.tilt = 0;
  }

  function reenter() {
    const fromLeft = Math.random() < 0.5;
    bird.state = 'fly';
    bird.zs = 1;
    bird.front = false;
    faceNow(fromLeft ? 1 : -1);
    bird.x = fromLeft ? -1.8 * S : W + 1.8 * S;
    bird.y = rand(0.3, 0.6) * H;
    bird.vx = bird.face * 3 * S;
    bird.vy = 0;
    bird.lean = 0.9;
    bird.flyTime = 2;
    bird.beats = 6;
    bird.target = { x: fromLeft ? W * 0.65 : W * 0.35, y: bird.y };
  }

  // Appel depuis l'API : au centre, avec ou sans traversée.
  function goCenter(pass) {
    if (reduce.matches || hidden || bird.state === 'dead' || bird.state === 'pass' || bird.state === 'away') return;
    paused = false;
    if (bird.state === 'hover') {
      if (pass) startPass(); else bird.timer = 2;
      kick();
      return;
    }
    if (bird.state === 'perch') takeoff(false);
    bird.state = 'fly';
    bird.target = centerTarget(pass);
    kick();
  }

  function updatePerch(dt) {
    const tg = bird.perch;
    if (tg.el) {
      const r = perchRect(tg.el);
      if (!tg.el.isConnected || r.width === 0 || r.top < S * 0.5 || r.top > H - S * 0.1) {
        if (reduce.matches) { relocateStill(); return; }
        takeoff(false);
        return;
      }
    }
    // Il se tourne vers le curseur
    if (time - pointer.moved < 2 && Math.abs(pointer.x - bird.x) > S && time - bird.lastFlip > 0.8) {
      const f = pointer.x > bird.x ? 1 : -1;
      if (f !== bird.yawTarget) { bird.yawTarget = f; bird.lastFlip = time; }
    }
    turnToward(dt, 5);
    bird.lean += (0 - bird.lean) * Math.min(1, dt * 8);
    bird.tilt = bird.face * bird.lean;
    bird.bob = 0;
    bird.up = 0;
    bird.glide = 0;
    bird.tailSpread += (0.7 - bird.tailSpread) * Math.min(1, dt * 4);
    const p = perchPoint(tg);
    const off = footOffset(bird.face * bird.sq, bird.tilt);
    bird.x = p.x - off[0];
    bird.y = p.y - off[1];

    if (reduce.matches) { bird.fold = 1; bird.e = 0.8; return; }

    // Ailes déployées en V, qui ondulent ; de temps en temps, un grand battement lent
    bird.breath += dt * 2.2;
    bird.fold += (1 - bird.fold) * Math.min(1, dt * 7);
    bird.nextStretch -= dt;
    if (bird.nextStretch <= 0) { bird.stretch = 1.2; bird.nextStretch = rand(5, 9); }
    let eWant = 0.78 + 0.08 * Math.sin(time * 1.6);
    if (bird.stretch > 0) {
      bird.stretch -= dt;
      eWant -= 1.5 * Math.sin(Math.PI * clamp(1 - bird.stretch / 1.2, 0, 1));
    }
    bird.e += (eWant - bird.e) * Math.min(1, dt * 8);

    // Le curseur s'approche : il sursaute, puis s'envole
    const pd = Math.hypot(pointer.x - bird.x, pointer.y - (bird.y - 0.1 * S));
    if (bird.startle <= 0 && pd < 1.25 * S && time - pointer.moved < 0.35) {
      // Il sursaute : bec ouvert, ailes levées d'un coup, puis il s'envole
      bird.startle = 0.35;
      bird.beak = 1;
      bird.e = 1;
    }
    if (bird.startle > 0) {
      bird.startle -= dt;
      if (bird.startle <= 0) { takeoff(true); return; }
    }
    bird.timer -= dt;
    if (bird.timer <= 0) takeoff(false);
  }

  // Animations réduites : il reste posé, et change de perchoir sans voler si le sien disparaît.
  function relocateStill() {
    const list = candidates();
    bird.perch = list.length ? { el: list[0], fx: 0.8 } : { x: W - S * 1.2, y: H - S * 0.3 };
    bird.state = 'perch';
    bird.fold = 1;
    bird.e = 0.8;
    bird.lean = 0;
    bird.tilt = 0;
    faceNow(bird.face);
  }

  // Il s'embrase : boule de feu, braises, fumée.
  function burst() {
    if (bird.state === 'dead' || bird.state === 'pass' || bird.state === 'away' || hidden || reduce.matches) return;
    const [cx, cy] = toWorld(0.03, -0.2);
    bird.state = 'dead';
    bird.timer = 1.25;
    bird.pillar = false;
    bird.burstX = cx;
    bird.burstY = cy;
    const n = 650 * quality;
    for (let i = 0; i < n; i++) {
      const p = spawnW.length ? spawnW[(Math.random() * spawnW.length) | 0] : [cx, cy];
      const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1;
      const v = S * (0.8 + 3.2 * Math.random() ** 2);
      spawnP(FLAME, p[0], p[1], (dx / d) * v + rand(-0.4, 0.4) * S, (dy / d) * v - 0.5 * S + rand(-0.4, 0.4) * S,
        rand(0.5, 1.2), S * rand(0.07, 0.16), rand(0.9, 1), Math.random() < 0.6 ? 1 : 0);
    }
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * TAU, v = rand(1.5, 4) * S;
      spawnP(SPARK, cx, cy, Math.cos(a) * v, Math.sin(a) * v - S, rand(1.2, 2.4), S * rand(0.01, 0.022) + 1, 1, 1);
    }
    for (let i = 0; i < 26; i++) {
      spawnP(SMOKE, cx + rand(-0.5, 0.5) * S, cy + rand(-0.4, 0.4) * S, rand(-0.6, 0.6) * S, -rand(0.3, 0.9) * S,
        rand(1.4, 2.4), S * rand(0.25, 0.45), 0, 0);
    }
    fx.push({ k: 'flash', x: cx, y: cy, r: 3 * S, life: 0, max: 0.55 });
  }

  function reborn() {
    const cx = bird.burstX, cy = bird.burstY;
    bird.state = 'fly';
    bird.x = cx; bird.y = cy + 0.2 * S;
    bird.vx = 0; bird.vy = -2.6 * S;
    bird.fold = 0; bird.glide = 0; bird.gliding = false; bird.beats = 6; bird.up = 0;
    bird.lean = 0; bird.tilt = 0; bird.phase = Math.PI / 2; bird.tailSpread = 0.9; bird.zs = 1;
    bird.flyTime = 0;
    pickTarget();
    fx.push({ k: 'flash', x: cx, y: cy, r: 2.2 * S, life: 0, max: 0.45 });
    sparksAt(cx, cy, 40, 2.5);
  }

  /* ---------- Flammes qui sortent du plumage ---------- */
  let spawnW = []; // points du plumage en coordonnées de page : [x, y, chaleur]

  function emit(dt) {
    if (reduce.matches || bird.state === 'dead' || bird.state === 'away' || !spawnW.length) return;
    const flying = bird.state !== 'perch';
    const z = Math.min(bird.zs, 2.5); // plus loin : flammes plus petites ; plus près : plus grandes
    const frontShare = bird.zs > 1.5 ? 0.06 : 0.3; // en gros plan, les flammes restent derrière lui
    emitN((flying ? 1100 : 650) * quality * dt, () => {
      const p = spawnW[(Math.random() * spawnW.length) | 0];
      spawnP(FLAME,
        p[0] + rand(-1, 1) * S * 0.015 * z, p[1] + rand(-1, 1) * S * 0.015 * z,
        bird.vx * 0.12 + rand(-0.15, 0.15) * S * z, bird.vy * 0.12 - rand(0.1, 0.4) * S * z,
        rand(0.25, 0.6), S * rand(0.07, 0.16) * z, clamp(p[2] * rand(0.85, 1.05), 0, 1), Math.random() < frontShare ? 1 : 0);
    });
    emitN((flying ? 22 : 8) * dt, () => {
      const p = spawnW[(Math.random() * spawnW.length) | 0];
      spawnP(SPARK, p[0], p[1], bird.vx * 0.1 + rand(-0.4, 0.4) * S, -rand(0.3, 0.8) * S, rand(0.9, 2), S * 0.012 + 1, 1, 1);
    });
  }

  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life += dt;
      if (f.life >= f.max) { fx.splice(i, 1); continue; }
      if (f.k === 'column') {
        // Colonne de feu d'où il renaît
        emitN(700 * quality * dt, () => spawnP(FLAME,
          f.x + rand(-0.22, 0.22) * S, f.y - rand(0, 0.2) * S, rand(-0.2, 0.2) * S, -rand(1.6, 3.2) * S,
          rand(0.35, 0.7), S * rand(0.08, 0.15), rand(0.9, 1), Math.random() < 0.5 ? 1 : 0));
      }
    }
  }

  function update(dt) {
    if (!reduce.matches) time += dt;
    bird.nextBlink -= dt;
    if (bird.nextBlink <= 0) { bird.blinkT = 0.13; bird.nextBlink = rand(2, 5); }
    if (bird.blinkT > 0) bird.blinkT -= dt;
    bird.beak = Math.max(0, bird.beak - dt * 2.5);
    if (bird.state === 'fly') updateFly(dt);
    else if (bird.state === 'perch') updatePerch(dt);
    else if (bird.state === 'hover') updateHover(dt);
    else if (bird.state === 'pass') updatePass(dt);
    else if (bird.state === 'away') { bird.timer -= dt; if (bird.timer <= 0) reenter(); }
    else {
      bird.timer -= dt;
      if (bird.timer < 0.45 && !bird.pillar) {
        bird.pillar = true;
        fx.push({ k: 'column', x: bird.burstX, y: bird.burstY + 0.9 * S, life: 0, max: 0.6 });
      }
      if (bird.timer <= 0) reborn();
    }
    emit(dt);
    updateFx(dt);
    updateParticles(dt);
  }

  /* ---------- Dessin de l'oiseau (repère local : tourné vers +x, y vers le bas, unité = taille) ---------- */
  let M = null;              // dégradés de l'image en cours
  let G = null;              // contexte du calque où l'oiseau est dessiné
  let UPX = 0, UPY = -1;     // « haut » du monde, vu de l'oiseau
  let spawnXf = null;        // transformation à appliquer aux points de flamme (tête stabilisée)
  const spawnLocal = [];

  function addSpawn(x, y, h) {
    spawnLocal.push(spawnXf ? [...spawnXf(x, y), h] : [x, y, h]);
  }

  // Le plumage est éclairé de l'intérieur : blanc doré au cœur, orange, puis rouge sombre au bout des plumes.
  function materials() {
    const rg = (x, y, r, stops) => {
      const g = G.createRadialGradient(x, y, 0, x, y, r);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    };
    const lg = (x0, y0, x1, y1, stops) => {
      const g = G.createLinearGradient(x0, y0, x1, y1);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    };
    const fl = 0.05 * Math.sin(time * 11) + 0.03 * Math.sin(time * 17.3);
    return {
      core: rg(0.04, -0.28, 1.6 + fl, [[0, '#ffe7a0'], [0.1, '#ffc848'], [0.24, '#ff9a26'], [0.46, '#f0581a'], [0.72, '#c62a1e'], [1, '#741224']]),
      far: rg(0.04, -0.28, 1.45 + fl, [[0, '#ffc25a'], [0.2, '#ff8a24'], [0.45, '#de421b'], [0.72, '#a01f20'], [1, '#540e1e']]),
      tail: rg(-0.08, 0.3, 1.75 + fl, [[0, '#ffd06a'], [0.2, '#ff9a26'], [0.48, '#f2561a'], [0.76, '#c4281e'], [1, '#701222']]),
      leg: lg(0, 0.3, 0, 0.66, [[0, '#ffc04c'], [1, '#c4621c']]),
      beak: lg(0.3, -0.71, 0.4, -0.64, [[0, '#fff2b8'], [0.55, '#ffc23a'], [1, '#9a4416']]),
    };
  }

  // Le long d'une plume : base dans l'ombre de la plume qui la recouvre, bout qui rougeoie.
  function lengthShade(x0, y0, x1, y1) {
    const g = G.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(58,6,14,0.5)');
    g.addColorStop(0.32, 'rgba(58,6,14,0)');
    g.addColorStop(0.72, 'rgba(255,236,170,0)');
    g.addColorStop(1, 'rgba(255,232,160,0.5)');
    return g;
  }

  // Plume détaillée : dégradé de feu, ombre et lumière, tige claire et barbes fines.
  function plume(sh, bx, by, dx, dy, len, w, o) {
    const iw = o.ink || INK_W, curl = o.curl || 0, side = o.side || 1;
    const fill = o.fill || M.core;
    if (o.split) {
      const [fx0, fy0] = rot2(dx, dy, o.split);
      sh.push({ p: tongue(bx + dx * len * 0.58, by + dy * len * 0.58, fx0, fy0, len * 0.45, w * 0.42, 0, curl * 1.4), f: fill, w: iw });
    }
    const p = tongue(bx, by, dx, dy, len, w, o.flick ? 1 : 0, curl);
    sh.push({ p, f: fill });
    const px = -dy, py = dx;
    const tipx = bx + dx * len + px * w * curl * 3, tipy = by + dy * len + py * w * curl * 3;
    const parts = [
      { p, f: lengthShade(bx, by, tipx, tipy) },
      { p: tongue(bx + px * w * 0.55 * side, by + py * w * 0.55 * side, dx, dy, len * 0.95, w * 0.55, 0, curl), f: SHADE },
      { p: tongue(bx - px * w * 0.3 * side, by - py * w * 0.3 * side, dx, dy, len * 0.72, w * 0.3, 0, curl * 0.9), f: SHINE },
    ];
    if (detail > 0 && o.lines !== false && len * S > 12) {
      const mx = bx + dx * len * 0.55, my = by + dy * len * 0.55;
      const ex = lerp(mx, tipx, 0.6), ey = lerp(my, tipy, 0.6);
      const rachis = new Path2D();
      rachis.moveTo(bx, by);
      rachis.quadraticCurveTo(mx, my, ex, ey);
      parts.push({ p: rachis, w: INK_W * 1.1, c: RACHIS });
      if (detail > 1) {
        const dark = new Path2D(), light = new Path2D();
        for (let u = 0.18; u < 0.92; u += 0.055) {
          const [rx, ry] = quadPt(bx, by, mx, my, ex, ey, u);
          const [qx, qy] = quadPt(bx, by, mx, my, ex, ey, Math.min(1, u + 0.13));
          dark.moveTo(rx, ry);
          dark.lineTo(qx + px * w * 0.85 * side, qy + py * w * 0.85 * side);
          light.moveTo(rx, ry);
          light.lineTo(qx - px * w * 0.6 * side, qy - py * w * 0.6 * side);
        }
        parts.push({ p: dark, w: INK_W * 0.6, c: BARB_DARK }, { p: light, w: INK_W * 0.6, c: BARB_LIGHT });
      }
    }
    sh.push({ clip: p, parts });
    sh.push({ p, w: iw });
    const heat = o.heat === undefined ? 0.8 : o.heat;
    addSpawn(tipx, tipy, heat * 0.85);
    addSpawn(bx + dx * len * 0.5, by + dy * len * 0.5, heat);
    return [tipx, tipy];
  }

  // Aile en éventail. k : 0 baissée → 1 levée ; kh : idem pour la main (retard du battement).
  // o = -1 pour l'aile proche (s'ouvre vers l'arrière), +1 pour l'aile lointaine (s'ouvre vers l'avant).
  // up : repli à la remontée ; comp : correction de l'inclinaison du corps ; slot : écartement des grandes rémiges.
  function wing(sh, sx, sy, k, kh, o, scale, far, up, comp, slot) {
    const lo = (o < 0 ? 2.25 : 0.6) - comp, hi = (o < 0 ? 4.28 : -1.31) - comp;
    const thA = lerp(lo, hi, k) - o * 0.15;
    const thH = lerp(lo, hi, clamp(kh, 0, 1)) + o * (0.35 + 0.6 * up);
    const LA = 0.44 * scale * (1 - 0.12 * up), LH = 0.56 * scale * (1 - 0.38 * up);
    const wx = sx + Math.cos(thA) * LA, wy = sy + Math.sin(thA) * LA;
    const tx = wx + Math.cos(thH) * LH, ty = wy + Math.sin(thH) * LH;
    const along = (f) => {
      const d = f * (LA + LH);
      return d < LA ? [sx + Math.cos(thA) * d, sy + Math.sin(thA) * d] : [wx + Math.cos(thH) * (d - LA), wy + Math.sin(thH) * (d - LA)];
    };
    const spread = (far ? 0.85 : 1.1) * (1 - 0.4 * up);
    const dirAt = (u) => { const a = lerp(thH + o * spread, thH - o * 0.05, clamp(u, 0, 1) ** 0.8); return [Math.cos(a), Math.sin(a)]; };
    const [ix, iy] = dirAt(0);
    const ldx = -ix, ldy = -iy; // vers le bord d'attaque
    const fl = (i) => Math.sin(time * 7 + i * 1.3 + o) * 0.06;
    const fill = far ? M.far : M.core;
    const side = -o;
    const keep = detail;
    if (far) detail = Math.max(0, detail - 1);

    // Rémiges primaires, sur la main : elles s'écartent comme des doigts quand l'aile est tendue
    for (let i = 6; i >= 0; i--) {
      const r = i / 6;
      const [bx, by] = along(lerp(0.42, 0.96, r));
      let [dx, dy] = dirAt(lerp(0.55, 1, r));
      if (r > 0.45) [dx, dy] = rot2(dx, dy, (-o * slot * (r - 0.45)) / 0.55);
      const len = lerp(0.58, 0.88, r ** 1.2) * scale * (1 - 0.22 * up);
      plume(sh, bx, by, dx, dy, len, (r > 0.6 ? 0.09 : 0.11) * scale, {
        fill, curl: o * (0.18 + 0.05 * r) + fl(i), side, heat: 0.75,
      });
    }
    // Rémiges secondaires, sur le bras
    for (let i = 6; i >= 0; i--) {
      const r = i / 6;
      const [bx, by] = along(lerp(0.05, 0.42, r));
      const [dx, dy] = dirAt(lerp(0, 0.52, r));
      plume(sh, bx, by, dx, dy, lerp(0.4, 0.56, r) * scale * (1 - 0.1 * up), 0.1 * scale, {
        fill, curl: o * 0.16 + fl(i + 7), side, heat: 0.85,
      });
    }
    // Grandes couvertures
    for (let i = 8; i >= 0; i--) {
      const r = i / 8;
      const [bx, by] = along(lerp(0.03, 0.72, r));
      const [dx, dy] = dirAt(lerp(0, 0.9, r));
      plume(sh, bx + ldx * 0.02, by + ldy * 0.02, dx, dy, lerp(0.22, 0.32, r) * scale, 0.085 * scale, { fill, curl: o * 0.15, side, heat: 0.95 });
    }
    // Petites couvertures, en écailles
    for (let i = 7; i >= 0; i--) {
      const r = i / 7;
      const [bx, by] = along(lerp(0.02, 0.6, r));
      const [dx, dy] = dirAt(lerp(0, 0.75, r));
      plume(sh, bx + ldx * 0.035, by + ldy * 0.035, dx, dy, lerp(0.13, 0.17, r) * scale, 0.075 * scale, { fill, lines: false, side, heat: 1 });
    }
    // Bord d'attaque festonné
    const band = new Path2D(), edge = [], rows = 7, width = 0.07 * scale;
    for (let j = 0; j <= rows; j++) edge.push(along((j / rows) * 0.6));
    band.moveTo(edge[0][0], edge[0][1]);
    for (const q of edge) band.lineTo(q[0], q[1]);
    let prev = null;
    const inner = [];
    for (let j = rows; j >= 0; j--) {
      const taper = 1 - (j / rows) * 0.5;
      const P2 = [edge[j][0] + ix * width * taper, edge[j][1] + iy * width * taper];
      inner.push(P2);
      if (!prev) band.lineTo(P2[0], P2[1]);
      else band.quadraticCurveTo((prev[0] + P2[0]) / 2 + ix * 0.03 * scale, (prev[1] + P2[1]) / 2 + iy * 0.03 * scale, P2[0], P2[1]);
      prev = P2;
    }
    band.closePath();
    sh.push({ p: band, f: fill });
    const bandParts = [{ p: band, f: SHINE }];
    if (detail > 0) {
      const sc = new Path2D();
      for (let j = 0; j < rows; j++) {
        const a = lerp2(edge[j], inner[rows - j], 0.5), b = lerp2(edge[j + 1], inner[rows - j - 1], 0.5);
        sc.moveTo(a[0], a[1]);
        sc.quadraticCurveTo((a[0] + b[0]) / 2 + ix * 0.03 * scale, (a[1] + b[1]) / 2 + iy * 0.03 * scale, b[0], b[1]);
      }
      bandParts.push({ p: sc, w: INK_W * 0.6, c: INK_SOFT });
    }
    sh.push({ clip: band, parts: bandParts });
    sh.push({ p: band, w: INK_W });
    addSpawn(tx, ty, 0.8);
    detail = keep;
  }

  // Patte écailleuse, serres noires, culotte de plumes. k : 0 repliée (en vol) → 1 tendue.
  function leg(sh, far, k, dX, dY, fX, fY) {
    const hx = far ? -0.03 : 0.04, hy = 0.22;
    const ax = lerp(hx + 0.1, hx + 0.02, k) + (far ? -0.02 : 0), ay = lerp(0.42, 0.62, k);
    const kx = hx + 0.015, ky = hy + 0.12;
    const tar = ribbonW([[kx, ky], [lerp(kx, ax, 0.5) + 0.01, lerp(ky, ay, 0.5)], [ax, ay]], (v) => lerp(0.026, 0.019, v));
    sh.push({ p: tar, f: M.leg });
    const tarParts = [{ p: ribbonW([[kx + 0.008, ky], [ax + 0.006, ay]], () => 0.006), f: SHINE }];
    if (far) tarParts.push({ p: tar, f: SHADE });
    if (detail > 0) {
      const sc = new Path2D();
      for (let v = 0.25; v < 0.95; v += 0.15) {
        const x = lerp(kx, ax, v), y = lerp(ky, ay, v);
        sc.moveTo(x - 0.02, y - 0.006);
        sc.quadraticCurveTo(x, y + 0.008, x + 0.02, y - 0.006);
      }
      tarParts.push({ p: sc, w: INK_W * 0.6, c: INK_SOFT });
    }
    sh.push({ clip: tar, parts: tarParts });
    sh.push({ p: tar, w: INK_W });
    const toeK = lerp(0.55, 1, k);
    for (const [a, c] of [[-0.065, 0.006], [0.1, 0.01], [0.08, 0.034]]) {
      const tx = ax + (fX * a + dX * c) * toeK, ty = ay + (fY * a + dY * c) * toeK, s = a > 0 ? 1 : -1;
      sh.push({ p: ribbonW([[ax, ay], [(ax + tx) / 2, (ay + ty) / 2], [tx, ty]], (v) => lerp(0.014, 0.01, v)), f: M.leg, w: INK_W * 0.8 });
      const claw = new Path2D();
      claw.moveTo(tx - dX * 0.012, ty - dY * 0.012);
      claw.quadraticCurveTo(tx + fX * 0.035 * s, ty + fY * 0.035 * s, tx + fX * 0.014 * s + dX * 0.042, ty + fY * 0.014 * s + dY * 0.042);
      claw.lineTo(tx + dX * 0.012, ty + dY * 0.012);
      claw.closePath();
      sh.push({ p: claw, f: '#1d0b0d', w: INK_W * 0.5 });
    }
    for (let i = 4; i >= 0; i--) {
      const r = i / 4, sw = lerp(-0.25, 0.35, r);
      const [dx, dy] = norm(dX - fX * sw, dY - fY * sw);
      plume(sh, hx + lerp(-0.06, 0.07, r), hy - 0.02, dx, dy, lerp(0.17, 0.24, 1 - Math.abs(r - 0.5) * 2), 0.05, {
        fill: far ? M.far : M.core, curl: i % 2 ? 0.2 : -0.2, lines: false, heat: 0.9,
      });
    }
  }

  // Plume de queue : tige fine, large vexille barbée, bout en flamme fourchue.
  function tailPlume(sh, pts, back, j) {
    const vane = (v) => 0.013 + 0.055 * clamp((v - 0.38) / 0.27, 0, 1) * (1 - clamp((v - 0.86) / 0.14, 0, 1));
    const shape = ribbonW(pts, vane);
    const fill = back ? M.far : M.tail;
    sh.push({ p: shape, f: fill });
    const last = pts[pts.length - 1];
    const parts = [
      { p: shape, f: lengthShade(pts[0][0], pts[0][1], last[0], last[1]) },
      { p: ribbonW(pts.map(([x, y]) => [x + 0.012, y]), (v) => (v < 0.42 ? 0 : vane(v) * 0.4)), f: SHINE },
      { p: ribbonW(pts.map(([x, y]) => [x - 0.014, y]), (v) => (v < 0.42 ? 0 : vane(v) * 0.45)), f: SHADE },
    ];
    if (detail > 0) {
      const rachis = new Path2D();
      smoothTo(rachis, pts.slice(2), true);
      parts.push({ p: rachis, w: INK_W * 0.8, c: RACHIS });
      if (detail > 1) {
        const barbs = new Path2D();
        for (let n = 5; n < pts.length - 1; n++) {
          const [x, y] = pts[n], [nx, ny] = pts[n + 1];
          const [tx, ty] = norm(nx - x, ny - y);
          const w = vane(n / (pts.length - 1)) * 1.1;
          for (const s of [1, -1]) {
            barbs.moveTo(x, y);
            barbs.lineTo(x + tx * w * 0.9 - ty * w * s, y + ty * w * 0.9 + tx * w * s);
          }
        }
        parts.push({ p: barbs, w: INK_W * 0.6, c: BARB_DARK });
      }
    }
    sh.push({ clip: shape, parts });
    sh.push({ p: shape, w: INK_W });
    addSpawn(pts[6][0], pts[6][1], 0.85);
    addSpawn(pts[9][0], pts[9][1], 0.8);
    const end = pts[pts.length - 1], pre = pts[pts.length - 2];
    const [ex, ey] = norm(end[0] - pre[0], end[1] - pre[1]);
    const curl = (j % 2 ? 0.45 : -0.45) + Math.sin(time * 4 + j) * 0.1;
    plume(sh, end[0] - ex * 0.02, end[1] - ey * 0.02, ex, ey, 0.22, 0.05, {
      fill, curl, flick: 1, split: -Math.sign(curl) * 0.5, lines: false, heat: 0.7,
    });
  }

  function neckAt(pts, v) {
    const n = pts.length - 1, f = clamp(v, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
    const a = pts[i], b = pts[i + 1];
    const [tx, ty] = norm(b[0] - a[0], b[1] - a[1]);
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), tx, ty];
  }

  // Point situé à la fraction u de la longueur d'une ligne brisée.
  function alongPoly(pts, u) {
    let total = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      seg.push(d);
      total += d;
    }
    let d = clamp(u, 0, 1) * total;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) return lerp2(pts[i], pts[i + 1], seg[i] ? Math.min(1, d / seg[i]) : 0);
      d -= seg[i];
    }
    return pts[pts.length - 1];
  }

  // Vue de face, ailes tendues comme un avion : pour quand il fonce vers l'écran.
  // On le voit légèrement par-dessous : dessous des ailes, poitrail, serres repliées.
  function buildFront(sh) {
    UPX = 0;
    UPY = -1;
    const flex = 0.025 * Math.sin(time * 3.1);

    // Queue en éventail derrière le corps, raccourcie par la perspective
    for (const i of [0, 6, 1, 5, 2, 4, 3]) {
      const [dx, dy] = rot2(0, 1, (i - 3) * 0.2);
      plume(sh, dx * 0.05, 0.15, dx, dy, 0.42 - Math.abs(i - 3) * 0.03, 0.07, {
        fill: M.tail, curl: (i - 3) * 0.06 + Math.sin(time * 4 + i) * 0.05, flick: 1, split: i % 2 ? 0.4 : -0.4, lines: false, heat: 0.75,
      });
    }

    // Ailes à plat, légèrement relevées vers le bout
    for (const s of [-1, 1]) {
      const P = [[0.09 * s, -0.04], [0.55 * s, -0.1], [0.95 * s, -0.13 + flex], [1.3 * s, -0.23 + flex * 2]];
      // Rémiges secondaires : le bord de fuite, vu par-dessous
      for (let i = 8; i >= 0; i--) {
        const u = i / 8;
        const [bx, by] = alongPoly(P.slice(0, 3), u);
        const [dx, dy] = norm(0.18 * s, 1);
        plume(sh, bx, by, dx, dy, lerp(0.22, 0.15, u), 0.08, { fill: M.core, curl: 0.1 * s, side: s, heat: 0.85 });
      }
      // Rémiges primaires : grandes plumes écartées comme des doigts au bout de l'aile
      for (let i = 4; i >= 0; i--) {
        const [bx, by] = alongPoly(P.slice(2), 0.1 + i * 0.13);
        const ang = -0.02 - i * 0.13 + flex;
        const len = 0.3 + 0.03 * (2 - Math.abs(i - 2));
        const tip = plume(sh, bx, by, Math.cos(ang) * s, Math.sin(ang), len, 0.062, { fill: M.core, curl: -0.12 * s, side: s, heat: 0.75 });
        addSpawn(tip[0], tip[1], 1);
        addSpawn(tip[0], tip[1], 1);
      }
      // Couvertures le long du bord d'attaque, festonnées
      const N = 10, top = [], bot = [];
      for (let j = 0; j <= N; j++) {
        const u = j / N, [x, y] = alongPoly(P, u * 0.86);
        top.push([x, y]);
        bot.push([x, y + lerp(0.12, 0.04, u)]);
      }
      const band = new Path2D();
      smoothTo(band, top, true);
      let prev = bot[N];
      band.lineTo(prev[0], prev[1]);
      for (let j = N - 1; j >= 0; j--) {
        const q = bot[j];
        band.quadraticCurveTo((prev[0] + q[0]) / 2, (prev[1] + q[1]) / 2 + 0.028, q[0], q[1]);
        prev = q;
      }
      band.closePath();
      sh.push({ p: band, f: M.core });
      const bandParts = [{ p: ribbonW(top.map(([x, y]) => [x, y + 0.012]), (v) => lerp(0.022, 0.008, v)), f: SHINE }];
      if (detail > 0) {
        const sc = new Path2D();
        for (let j = 0; j < N; j++) {
          const a = lerp2(top[j], bot[j], 0.55), b = lerp2(top[j + 1], bot[j + 1], 0.55);
          sc.moveTo(a[0], a[1]);
          sc.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.02, b[0], b[1]);
        }
        bandParts.push({ p: sc, w: INK_W * 0.6, c: INK_SOFT });
      }
      sh.push({ clip: band, parts: bandParts });
      sh.push({ p: band, w: INK_W });
    }

    // Poitrail
    const body = oval(0, 0.04, 0.14, 0.2, 0);
    sh.push({ p: body, f: M.core });
    const bodyParts = [
      { p: oval(-0.13, 0.06, 0.07, 0.22, 0), f: SHADE },
      { p: oval(0.13, 0.06, 0.07, 0.22, 0), f: SHADE },
      { p: oval(0, -0.02, 0.06, 0.12, 0), f: SHINE },
    ];
    for (const [y, xs] of [[0.2, [-0.06, 0.02]], [0.12, [-0.09, -0.02, 0.05]], [0.04, [-0.1, -0.03, 0.04, 0.1]], [-0.04, [-0.08, -0.01, 0.06]], [-0.11, [-0.04, 0.03]]]) {
      for (const x of xs) {
        const fp = tongue(x + 0.02, y - 0.05, 0, 1, 0.1, 0.035, 0, x > 0 ? 0.12 : -0.12);
        bodyParts.push({ p: fp, f: Math.abs(x) < 0.05 ? 'rgba(255,240,190,0.26)' : 'rgba(150,30,20,0.16)' });
        bodyParts.push({ p: fp, w: INK_W * 0.6, c: INK_SOFT });
      }
    }
    sh.push({ clip: body, parts: bodyParts });
    sh.push({ p: body, w: INK_W * 1.2 });
    addSpawn(0, -0.05, 1);
    addSpawn(-0.1, 0.1, 1);
    addSpawn(0.1, 0.1, 1);

    // Serres repliées sous le corps
    for (const s of [-1, 1]) {
      const ax = 0.055 * s, ay = 0.25;
      sh.push({ p: ribbonW([[0.045 * s, 0.17], [ax, ay]], () => 0.022), f: M.leg, w: INK_W });
      const claws = new Path2D();
      for (const c of [-0.025, 0, 0.025]) {
        claws.moveTo(ax + c - 0.008, ay);
        claws.quadraticCurveTo(ax + c, ay + 0.045, ax + c - 0.012 * s, ay + 0.05);
        claws.lineTo(ax + c + 0.008, ay);
        claws.closePath();
      }
      sh.push({ p: claws, f: '#1d0b0d', w: INK_W * 0.5 });
    }

    // Collerette autour du cou
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.32;
      const [dx, dy] = rot2(0, 1, a);
      plume(sh, Math.sin(a) * 0.06, -0.15, dx, dy, 0.1, 0.04, { curl: (i - 3) * 0.05, lines: false, heat: 1 });
    }

    // Aigrette qui se dresse au-dessus de la tête
    for (const i of [0, 4, 1, 3, 2]) {
      const [dx, dy] = rot2(0, -1, (i - 2) * 0.34 + Math.sin(time * 3 + i) * 0.05);
      plume(sh, dx * 0.03, -0.27, dx, dy, 0.3 - Math.abs(i - 2) * 0.03, 0.04, {
        curl: (i - 2) * 0.12, flick: 1, split: i < 2 ? -0.45 : 0.45, heat: 0.9,
      });
    }

    // Tête de face
    const head = oval(0, -0.215, 0.085, 0.08, 0);
    sh.push({ p: head, f: M.core });
    const headParts = [
      { p: oval(0, -0.265, 0.05, 0.02, 0), f: SHINE },
      { p: oval(-0.075, -0.19, 0.04, 0.05, 0), f: SHADE },
      { p: oval(0.075, -0.19, 0.04, 0.05, 0), f: SHADE },
      { p: tongue(-0.06, -0.225, -1, 0.12, 0.06, 0.012, 0, -0.2), f: 'rgba(190,30,26,0.85)' },
      { p: tongue(0.06, -0.225, 1, 0.12, 0.06, 0.012, 0, 0.2), f: 'rgba(190,30,26,0.85)' },
    ];
    sh.push({ clip: head, parts: headParts });
    sh.push({ p: head, w: INK_W });
    // M gravé sur le front : creux sombre incrusté d'or
    const mark = new Path2D();
    mark.moveTo(-0.022, -0.247);
    mark.lineTo(-0.017, -0.285);
    mark.lineTo(0, -0.262);
    mark.lineTo(0.017, -0.285);
    mark.lineTo(0.022, -0.247);
    sh.push({ p: mark, w: 0.014, c: '#3a0806' });
    sh.push({ p: mark, w: 0.006, c: '#ffd25a' });
    for (const s of [-1, 1]) {
      if (bird.blinkT <= 0) {
        const eye = new Path2D();
        eye.moveTo(0.018 * s, -0.222);
        eye.quadraticCurveTo(0.04 * s, -0.242, 0.066 * s, -0.236);
        eye.quadraticCurveTo(0.044 * s, -0.214, 0.018 * s, -0.222);
        eye.closePath();
        sh.push({ p: eye, f: '#ffcf3a' });
        sh.push({ clip: eye, parts: [
          { p: circle(0.043 * s, -0.229, 0.011), f: '#e0841c' },
          { p: circle(0.043 * s, -0.229, 0.0068), f: '#140608' },
          { p: circle(0.04 * s, -0.233, 0.0035), f: '#ffffff' },
        ] });
        sh.push({ p: eye, w: INK_W * 0.8, c: '#2a080c' });
      } else {
        const lid = new Path2D();
        lid.moveTo(0.018 * s, -0.222);
        lid.quadraticCurveTo(0.042 * s, -0.226, 0.066 * s, -0.236);
        sh.push({ p: lid, w: 0.01, c: '#2a080c' });
      }
      // Arcades en V au-dessus des yeux
      const brow = new Path2D();
      brow.moveTo(0.012 * s, -0.236);
      brow.quadraticCurveTo(0.04 * s, -0.262, 0.074 * s, -0.247);
      brow.quadraticCurveTo(0.045 * s, -0.248, 0.012 * s, -0.236);
      brow.closePath();
      sh.push({ p: brow, f: '#c4401c', w: INK_W * 0.8 });
    }
    // Bec vu de face : cire, narines, bec crochu pointé vers nous
    sh.push({ p: oval(0, -0.214, 0.024, 0.011, 0), f: '#ffe7a0', w: INK_W * 0.8 });
    sh.push({ p: oval(-0.01, -0.214, 0.004, 0.0028, 0), f: '#2a0a0c' });
    sh.push({ p: oval(0.01, -0.214, 0.004, 0.0028, 0), f: '#2a0a0c' });
    const beak = new Path2D();
    beak.moveTo(-0.024, -0.206);
    beak.quadraticCurveTo(-0.027, -0.175, 0, -0.145);
    beak.quadraticCurveTo(0.027, -0.175, 0.024, -0.206);
    beak.closePath();
    sh.push({ p: beak, f: M.beak });
    sh.push({ clip: beak, parts: [
      { p: oval(0, -0.15, 0.02, 0.02, 0), f: 'rgba(90,30,10,0.5)' },
      { p: ribbonW([[0, -0.205], [0, -0.16]], () => 0.004), f: SHINE },
    ] });
    sh.push({ p: beak, w: INK_W });
    return sh;
  }

  function buildBird() {
    const sh = [];
    spawnLocal.length = 0;
    M = materials();
    if (bird.front) return buildFront(sh);
    const { fold, e, face, tilt } = bird;
    const lean = Math.max(0, tilt * face);
    const trail = Math.min(1, Math.hypot(bird.vx, bird.vy) / S / 3.5);
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    UPX = -face * st; UPY = -ct;
    const dX = -UPX, dY = -UPY;         // bas
    const fX = ct, fY = -face * st;     // horizontale vers l'avant
    const k = (e + 1) / 2;
    const kh = k - 0.26 * Math.cos(bird.phase) * (1 - bird.glide) * (1 - fold);
    const up = bird.up, comp = lean * 0.85, slot = 0.22 * (1 - up);


    // Aile lointaine, plus sombre, levée derrière la tête
    wing(sh, 0.03, -0.24, clamp(k * 0.95 + 0.04, 0, 1), kh, 1, 0.82, true, up, comp, slot);

    // Queue : onze plumes en cascade, couche arrière puis couche avant ; elle s'ouvre pour freiner
    const [bdx, bdy] = norm(lerp(-0.5, -0.22, fold), 1);
    for (const j of [1, 9, 3, 7, 5, 0, 10, 2, 8, 4, 6]) {
      const back = j % 2 === 1;
      const [dx, dy] = rot2(bdx, bdy, (j - 5) * 0.085 * bird.tailSpread * (1 - 0.25 * trail));
      const px = -dy, py = dx;
      const len = (back ? 1.05 : 0.95) + 0.6 * (1 - Math.abs(j - 5) / 5) ** 1.2;
      const pts = [];
      for (let n = 0; n <= 11; n++) {
        const v = n / 11;
        const wave = Math.sin(v * 3 - time * 3.2 + j * 0.7) * 0.08 * v;
        pts.push([-0.08 + dx * len * v + px * wave - trail * 0.45 * v * v, 0.33 + dy * len * v + py * wave]);
      }
      tailPlume(sh, pts, back, j);
    }
    // Couvertures de la queue
    for (let i = 6; i >= 0; i--) {
      const r = i / 6;
      const [dx, dy] = rot2(bdx, bdy, lerp(-0.7, 0.6, r));
      plume(sh, -0.08 + lerp(-0.05, 0.05, r), 0.27, dx, dy, lerp(0.3, 0.42, 1 - Math.abs(r - 0.5) * 2), 0.07, {
        fill: M.tail, curl: i % 2 ? 0.25 : -0.25, flick: 1, heat: 0.9,
      });
    }

    leg(sh, true, fold, dX, dY, fX, fY);

    // En vol, la tête reste à l'horizontale pendant que le corps se penche
    const hr = -lean * 0.75, hc = Math.cos(hr), hs = Math.sin(hr), pvx = 0.15, pvy = -0.62;
    const tf = [hc, hs, -hs, hc, pvx - hc * pvx + hs * pvy, pvy - hs * pvx - hc * pvy];
    const headXf = (x, y) => [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]];

    // Cou en S, couvert d'un camail de plumes pointues
    const neckPts = [[0, -0.25], [0.085, -0.36], [0.07, -0.48], [0.11, -0.58], [0.19, -0.645]].map((p, i) => {
      if (i < 3) return p;
      const q = headXf(p[0], p[1]);
      return i === 3 ? lerp2(p, q, 0.5) : q;
    });
    const neckW = (v) => lerp(0.09, 0.055, v);
    const neck = ribbonW(neckPts, neckW);
    sh.push({ p: neck, f: M.core });
    sh.push({ clip: neck, parts: [
      { p: ribbonW(neckPts.map(([x, y]) => [x + 0.04, y]), (v) => lerp(0.035, 0.018, v)), f: SHINE },
      { p: ribbonW(neckPts.map(([x, y]) => [x - 0.05, y]), (v) => lerp(0.04, 0.02, v)), f: SHADE },
    ] });
    sh.push({ p: neck, w: INK_W });
    for (let i = 0; i < 10; i++) {
      const v = 0.04 + (0.9 * i) / 9;
      const [x, y, tx, ty] = neckAt(neckPts, v);
      const w = neckW(v), sway = Math.sin(time * 4 + i * 0.8) * 0.08;
      const [hx, hy] = norm(-0.55 + sway, 0.85);
      plume(sh, x + ty * w * 0.55, y - tx * w * 0.55, hx, hy, 0.13 + 0.07 * (1 - v), 0.048, {
        curl: -0.25 + sway, flick: i % 3 === 0, lines: false, heat: 0.95,
      });
      if (i % 2 === 0) {
        const [gx, gy] = norm(0.3, 1);
        plume(sh, x - ty * w * 0.4, y + tx * w * 0.4, gx, gy, 0.08, 0.03, { curl: 0.15, lines: false, heat: 1 });
      }
    }

    // Corps en goutte, poitrail couvert de petites plumes
    const body = new Path2D();
    body.moveTo(0.06, -0.28);
    body.bezierCurveTo(0.22, -0.18, 0.24, 0.08, 0.12, 0.26);
    body.bezierCurveTo(0.06, 0.36, -0.06, 0.4, -0.12, 0.36);
    body.bezierCurveTo(-0.2, 0.2, -0.2, -0.12, -0.08, -0.28);
    body.bezierCurveTo(-0.04, -0.32, 0.02, -0.31, 0.06, -0.28);
    body.closePath();
    sh.push({ p: body, f: M.core });
    const back = new Path2D();
    back.moveTo(-0.08, -0.3);
    back.bezierCurveTo(-0.22, -0.1, -0.22, 0.2, -0.1, 0.4);
    back.lineTo(-0.02, 0.4);
    back.bezierCurveTo(-0.12, 0.2, -0.12, -0.1, -0.02, -0.3);
    back.closePath();
    const bodyParts = [{ p: back, f: SHADE }, { p: oval(0.11, -0.02, 0.085, 0.2, -0.2), f: SHINE }];
    const rows = [[0.22, [-0.05, 0.03, 0.1]], [0.12, [-0.08, 0, 0.08, 0.15]], [0.02, [-0.07, 0.01, 0.09, 0.17]], [-0.08, [-0.05, 0.03, 0.11, 0.18]], [-0.18, [-0.01, 0.06, 0.13]]];
    for (const [y, xs] of rows) {
      for (const x of xs) {
        const [gx, gy] = norm(0.12, 1);
        const fp = tongue(x, y - 0.05, gx, gy, 0.11, 0.036, 0, x > 0.04 ? 0.15 : -0.15);
        bodyParts.push({ p: fp, f: x > 0.06 ? 'rgba(255,240,190,0.28)' : 'rgba(150,30,20,0.18)' });
        bodyParts.push({ p: fp, w: INK_W * 0.6, c: INK_SOFT });
      }
    }
    sh.push({ clip: body, parts: bodyParts });
    sh.push({ p: body, w: INK_W * 1.2 });
    addSpawn(-0.02, -0.22, 1);
    addSpawn(-0.14, 0.02, 1);
    addSpawn(0.12, 0.08, 1);
    // Franges du ventre
    for (let i = 0; i < 6; i++) {
      const r = i / 5;
      const [dx, dy] = norm(lerp(-0.35, 0.1, r) + Math.sin(time * 3 + i) * 0.05, 1);
      plume(sh, lerp(-0.13, 0.11, r), 0.29 + 0.05 * Math.sin(r * Math.PI), dx, dy, 0.15 + 0.05 * Math.sin(r * Math.PI), 0.05, {
        curl: i % 2 ? 0.25 : -0.25, lines: false, heat: 0.95,
      });
    }

    leg(sh, false, fold, dX, dY, fX, fY);

    // Aile proche
    wing(sh, -0.08, -0.2, k, kh, -1, 1, false, up, comp, slot);

    // Tête, dans un groupe tourné pour rester à l'horizontale
    const hsh = [];
    spawnXf = headXf;
    const CD = [[-0.3, -0.95], [-0.55, -0.82], [-0.78, -0.6], [-0.92, -0.36], [-0.98, -0.1], [-0.92, 0.2]];
    const CL = [0.34, 0.46, 0.52, 0.46, 0.38, 0.3];
    for (let i = 0; i < 6; i++) {
      const sway = Math.sin(time * 3 + i * 0.9) * 0.1;
      let [dx, dy] = norm(lerp(CD[i][0], -1, trail * 0.5), lerp(CD[i][1], 0.05, trail * 0.5));
      [dx, dy] = rot2(dx, dy, sway);
      const curl = (i % 2 ? 0.32 : -0.28) + sway;
      plume(hsh, 0.16, -0.7, dx, dy, CL[i], 0.042, { curl, flick: 1, split: i % 2 ? -0.45 : 0.45, heat: 0.9 });
    }
    for (let i = 0; i < 3; i++) {
      const [dx, dy] = norm(-0.8, -0.55 + i * 0.25);
      plume(hsh, 0.215 - i * 0.03, -0.722 + i * 0.006, dx, dy, 0.1, 0.03, { curl: -0.2, lines: false, heat: 1 });
    }
    const head = new Path2D();
    head.moveTo(0.13, -0.655);
    head.bezierCurveTo(0.13, -0.71, 0.19, -0.735, 0.235, -0.725);
    head.bezierCurveTo(0.265, -0.72, 0.285, -0.705, 0.295, -0.69);
    head.lineTo(0.298, -0.648);
    head.bezierCurveTo(0.27, -0.622, 0.22, -0.603, 0.18, -0.608);
    head.bezierCurveTo(0.15, -0.613, 0.13, -0.63, 0.13, -0.655);
    head.closePath();
    hsh.push({ p: head, f: M.core });
    const headParts = [
      { p: oval(0.235, -0.71, 0.055, 0.018, -0.15), f: SHINE },
      { p: oval(0.16, -0.632, 0.05, 0.04, 0), f: SHADE },
      { p: tongue(0.215, -0.668, -1, 0.15, 0.12, 0.014, 0, 0.25), f: 'rgba(190,30,26,0.85)' },
    ];
    if (detail > 0) {
      const hatch = new Path2D();
      for (let i = 0; i < 4; i++) { hatch.moveTo(0.19 + i * 0.022, -0.6); hatch.lineTo(0.205 + i * 0.022, -0.625); }
      headParts.push({ p: hatch, w: INK_W * 0.6, c: INK_SOFT });
    }
    hsh.push({ clip: head, parts: headParts });
    hsh.push({ p: head, w: INK_W });
    for (let i = 0; i < 3; i++) {
      const [dx, dy] = norm(-1, 0.2 + i * 0.12);
      plume(hsh, 0.205 - i * 0.018, -0.647 + i * 0.01, dx, dy, 0.085 + i * 0.01, 0.022, { curl: -0.2, lines: false, heat: 1 });
    }
    for (let i = 0; i < 2; i++) {
      const [dx, dy] = norm(-0.3 - i * 0.25, 1);
      plume(hsh, 0.24 - i * 0.03, -0.615, dx, dy, 0.08, 0.022, { curl: 0.25, flick: 1, lines: false, heat: 1 });
    }
    // Bec crochu : cire à la base, narine, pointe sombre ; il s'ouvre quand il sursaute
    const open = bird.beak * 0.035;
    const lower = new Path2D();
    lower.moveTo(0.303, -0.655);
    lower.quadraticCurveTo(0.345, -0.652 + open, 0.37, -0.643 + open * 1.3);
    lower.quadraticCurveTo(0.34, -0.632 + open, 0.304, -0.636);
    lower.closePath();
    hsh.push({ p: lower, f: M.beak, w: INK_W });
    const upper = new Path2D();
    upper.moveTo(0.3, -0.706);
    upper.quadraticCurveTo(0.372, -0.716, 0.404, -0.645);
    upper.quadraticCurveTo(0.395, -0.636, 0.386, -0.648);
    upper.quadraticCurveTo(0.36, -0.66, 0.302, -0.654);
    upper.closePath();
    hsh.push({ p: upper, f: M.beak });
    hsh.push({ clip: upper, parts: [
      { p: oval(0.36, -0.652, 0.07, 0.012, 0.15), f: 'rgba(120,40,10,0.3)' },
      { p: oval(0.34, -0.703, 0.04, 0.007, 0.1), f: SHINE },
    ] });
    hsh.push({ p: upper, w: INK_W });
    const cere = new Path2D();
    cere.moveTo(0.284, -0.71);
    cere.quadraticCurveTo(0.304, -0.712, 0.31, -0.694);
    cere.lineTo(0.307, -0.655);
    cere.quadraticCurveTo(0.293, -0.651, 0.283, -0.655);
    cere.closePath();
    hsh.push({ p: cere, f: '#ffe7a0', w: INK_W * 0.8 });
    hsh.push({ p: oval(0.3, -0.686, 0.006, 0.0035, 0.3), f: '#2a0a0c' });
    // Arcade sourcilière, œil, paupières
    const brow = new Path2D();
    brow.moveTo(0.19, -0.698);
    brow.quadraticCurveTo(0.24, -0.726, 0.298, -0.699);
    brow.quadraticCurveTo(0.272, -0.69, 0.252, -0.687);
    brow.quadraticCurveTo(0.22, -0.69, 0.19, -0.698);
    brow.closePath();
    if (bird.blinkT <= 0) {
      const eye = new Path2D();
      eye.moveTo(0.207, -0.672);
      eye.quadraticCurveTo(0.233, -0.692, 0.266, -0.68);
      eye.quadraticCurveTo(0.24, -0.657, 0.207, -0.672);
      eye.closePath();
      hsh.push({ p: eye, f: '#ffcf3a' });
      hsh.push({ clip: eye, parts: [
        { p: circle(0.241, -0.675, 0.0125), f: '#e0841c' },
        { p: circle(0.242, -0.675, 0.0078), f: '#140608' },
        { p: circle(0.238, -0.679, 0.0042), f: '#ffffff' },
        { p: circle(0.246, -0.671, 0.0021), f: '#ffffff' },
      ] });
      hsh.push({ p: eye, w: INK_W * 0.8 });
    }
    const liner = new Path2D();
    liner.moveTo(0.2, -0.669);
    liner.quadraticCurveTo(0.232, bird.blinkT > 0 ? -0.664 : -0.694, 0.27, -0.681);
    liner.moveTo(0.207, -0.672);
    liner.lineTo(0.186, -0.665);
    hsh.push({ p: liner, w: 0.011, c: '#2a080c' });
    hsh.push({ p: brow, f: '#c4401c', w: INK_W * 0.8 });
    spawnXf = null;
    sh.push({ tf, items: hsh });
    return sh;
  }

  /* ---------- Rendu ---------- */
  function mark(x, y, r) {
    if (!dirty) dirty = [x - r, y - r, x + r, y + r];
    else {
      if (x - r < dirty[0]) dirty[0] = x - r;
      if (y - r < dirty[1]) dirty[1] = y - r;
      if (x + r > dirty[2]) dirty[2] = x + r;
      if (y + r > dirty[3]) dirty[3] = y + r;
    }
  }

  function drawShapes(c, list) {
    for (const s of list) {
      if (s.items) {
        c.save();
        c.transform(s.tf[0], s.tf[1], s.tf[2], s.tf[3], s.tf[4], s.tf[5]);
        drawShapes(c, s.items);
        c.restore();
        continue;
      }
      if (s.parts) {
        c.save();
        c.clip(s.clip);
        for (const q of s.parts) {
          if (q.f) { c.fillStyle = q.f; c.fill(q.p); }
          if (q.w) { c.strokeStyle = q.c || INK; c.lineWidth = q.w; c.stroke(q.p); }
        }
        c.restore();
        continue;
      }
      if (s.f) { c.fillStyle = s.f; c.fill(s.p); }
      if (s.w) { c.strokeStyle = s.c || INK; c.lineWidth = s.w; c.stroke(s.p); }
    }
  }

  // Silhouette remplie d'une seule couleur, pour le halo (sans détails).
  function fillSilhouette(c, list) {
    for (const s of list) {
      if (s.items) {
        c.save();
        c.transform(s.tf[0], s.tf[1], s.tf[2], s.tf[3], s.tf[4], s.tf[5]);
        fillSilhouette(c, s.items);
        c.restore();
      } else if (s.f && !s.parts) {
        c.fill(s.p);
      }
    }
  }

  // Petit calque basse résolution : agrandi, il donne une lueur floue à la forme de l'oiseau.
  let gcv = null, gctx = null;
  const GLOW_SPAN = 5.8; // taille couverte par le calque, en tailles d'oiseau
  function glowLayer() {
    const side = Math.max(16, Math.ceil((GLOW_SPAN * S) / 9));
    if (gcv && gcv.width === side) return;
    gcv = document.createElement('canvas');
    gcv.width = gcv.height = side;
    gctx = gcv.getContext('2d');
  }

  function drawBird() {
    if (bird.state === 'dead' || bird.state === 'away') { spawnW = []; return; }
    glowLayer();
    G = ctx;
    const shapes = buildBird();
    const breath = bird.state === 'perch' && !reduce.matches ? Math.sin(bird.breath) * 0.015 : 0;
    const z = bird.zs, cx = bird.x, cy = bird.y + bird.bob, sz = GLOW_SPAN * S * z;

    // Silhouette en basse résolution, d'une seule couleur de lumière chaude
    const gs = gcv.width, k = gs / sz;
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, gs, gs);
    gctx.setTransform(k, 0, 0, k, gs / 2, gs / 2);
    gctx.rotate(bird.tilt);
    gctx.scale(bird.face * bird.sq * S * z, S * z * (1 + breath));
    gctx.fillStyle = '#ff9a3c';
    fillSilhouette(gctx, shapes);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Halo de lumière derrière l'oiseau
    ctx.globalAlpha = 0.3;
    ctx.drawImage(gcv, cx - sz * 0.54, cy - sz * 0.54, sz * 1.08, sz * 1.08);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(gcv, cx - sz / 2, cy - sz / 2, sz, sz);
    ctx.globalAlpha = 1;
    // L'oiseau, dessiné directement
    ctx.translate(cx, cy);
    ctx.rotate(bird.tilt);
    ctx.scale(bird.face * bird.sq * S * z, S * z * (1 + breath));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawShapes(ctx, shapes);
    // Éclat : le plumage incandescent déborde un peu de ses contours
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22;
    ctx.drawImage(gcv, cx - sz / 2, cy - sz / 2, sz, sz);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    spawnW = spawnLocal.map(([x, y, h]) => { const p = toWorld(x, y); p.push(h); return p; });
    mark(cx, cy, sz * 0.57);
  }

  function drawParticles(front) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!front) {
      // Fumée : en mélange normal, pour rester visible sur fond clair
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < count; i++) {
        if (pKind[i] !== SMOKE) continue;
        const a = pLife[i] / pMax[i], size = pSize[i] * (1 + 1.5 * a);
        ctx.globalAlpha = 0.5 * (1 - a) * Math.min(1, a * 5);
        ctx.drawImage(SMOKE_SPR, pX[i] - size, pY[i] - size, size * 2, size * 2);
        mark(pX[i], pY[i], size);
      }
    }
    // Feu : mélange normal, pour que les flammes restent saturées sur une page claire comme sombre
    ctx.globalCompositeOperation = 'source-over';
    const lastS = NS - 1;
    for (let i = 0; i < count; i++) {
      if (pFront[i] !== front || pKind[i] === SMOKE) continue;
      const a = pLife[i] / pMax[i];
      let temp, size, alpha;
      if (pKind[i] === FLAME) {
        temp = pHeat[i] * (1 - a) ** 0.85;
        size = pSize[i] * (1 - 0.55 * a);
        alpha = 0.9 * (1 - a);
      } else {
        temp = pHeat[i] * (1 - 0.4 * a);
        size = pSize[i];
        alpha = (1 - a) * (0.55 + 0.45 * Math.sin(time * 10 + pSeed[i] * 7));
      }
      if (alpha < 0.015 || size < 0.4) continue;
      let si = (temp * lastS + 0.5) | 0;
      if (si < 0) si = 0; else if (si > lastS) si = lastS;
      ctx.globalAlpha = alpha > 1 ? 1 : alpha;
      if (pKind[i] === FLAME) ctx.drawImage(SPR[si], pX[i] - size * 0.5, pY[i] - size * 2.1, size, size * 2.9);
      else ctx.drawImage(SPR[si], pX[i] - size, pY[i] - size * 1.5, size * 2, size * 2);
      mark(pX[i], pY[i] - size, size * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFx() {
    for (const f of fx) {
      const a = f.life / f.max;
      if (f.k === 'flash') {
        const k = 1 - a;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        const r = f.r * (0.7 + 0.5 * a);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `rgba(255,240,205,${0.8 * k})`);
        g.addColorStop(0.3, `rgba(255,150,60,${0.4 * k})`);
        g.addColorStop(1, 'rgba(220,60,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        mark(f.x, f.y, r);
      }
    }
  }

  function placeHitbox() {
    let next = 'none';
    if ((bird.state === 'fly' || bird.state === 'perch' || bird.state === 'hover') && !hidden && !reduce.matches) {
      const [cx, cy] = toWorld(0.05, -0.25);
      next = `translate(${(cx - S * 0.48).toFixed(1)}px, ${(cy - S * 0.62).toFixed(1)}px)`;
    }
    if (next === hitPos) return;
    hitPos = next;
    if (next === 'none') hit.style.display = 'none';
    else { hit.style.display = 'block'; hit.style.transform = next; }
  }

  function draw() {
    if (dirty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const x0 = Math.max(0, Math.floor(dirty[0] * DPR) - 2), y0 = Math.max(0, Math.floor(dirty[1] * DPR) - 2);
      ctx.clearRect(x0, y0, Math.ceil(dirty[2] * DPR) + 2 - x0, Math.ceil(dirty[3] * DPR) + 2 - y0);
      dirty = null;
    }
    if (!hidden) {
      drawParticles(0);
      drawBird();
      drawParticles(1);
      drawFx();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    placeHitbox();
  }

  /* ---------- Boucle ---------- */
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    const t0 = performance.now();
    if (!paused) update(dt);
    draw();
    // Qualité adaptative : moins de flammes si une image coûte trop cher
    workEma = workEma * 0.92 + (performance.now() - t0) * 0.08;
    if (workEma > 12) quality = Math.max(0.35, quality - 0.02);
    else if (workEma < 7) quality = Math.min(1, quality + 0.005);
    if (!paused && !hidden) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && !hidden) { last = 0; raf = requestAnimationFrame(frame); }
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const wanted = parseFloat(opts.taille);
    S = wanted > 0 ? clamp(wanted, 30, 300) : clamp(Math.min(W, H) * 0.1, 46, 96);
    detail = S >= 62 ? 2 : S >= 44 ? 1 : 0;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    hit.style.width = `${(S * 0.96).toFixed(1)}px`;
    hit.style.height = `${(S * 1.24).toFixed(1)}px`;
    hitPos = '';
    dirty = null;
    if (bird.state === 'fly' && bird.target && !bird.target.el) pickTarget();
    kick();
  }

  function init() {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;';
    ctx = canvas.getContext('2d');
    hit = document.createElement('div');
    hit.setAttribute('aria-hidden', 'true');
    hit.title = 'Un clic : il renaît de ses cendres';
    hit.style.cssText = 'position:fixed;left:0;top:0;display:none;z-index:2147483001;border-radius:45%;cursor:pointer;background:transparent;-webkit-tap-highlight-color:transparent;';
    hit.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); burst(); kick(); });
    document.body.appendChild(canvas);
    document.body.appendChild(hit);
    makeSprites();

    const track = (ev) => { pointer.x = ev.clientX; pointer.y = ev.clientY; pointer.moved = time; };
    document.addEventListener('pointermove', track, { passive: true });
    document.addEventListener('pointerdown', track, { passive: true });
    window.addEventListener('resize', resize);
    resize();

    // Premier état : posé sur un titre visible, sinon il arrive par le bord de l'écran.
    const list = candidates();
    const first = list.find((el) => el.matches('h1')) || list[0];
    if (first) {
      bird.perch = bird.target = { el: first, fx: 0.85 };
      const p = perchPoint(bird.perch);
      faceNow(p.x > W / 2 ? -1 : 1);
      bird.state = 'perch';
      bird.fold = 1;
      bird.e = 0.8;
      bird.lastPerch = first;
      bird.timer = 3.5;
      const off = footOffset(bird.face, 0);
      bird.x = p.x - off[0];
      bird.y = p.y - off[1];
    } else if (reduce.matches) {
      relocateStill();
    } else {
      bird.x = -1.5 * S; bird.y = H * 0.4; bird.vx = 2.5 * S; faceNow(1);
      pickTarget();
    }
    kick();
  }

  const api = {
    renaitre() { paused = false; burst(); kick(); },
    pause() { paused = true; },
    reprendre() { paused = false; kick(); },
    masquer() { hidden = true; canvas.style.display = 'none'; hit.style.display = 'none'; hitPos = 'none'; },
    afficher() { hidden = false; canvas.style.display = ''; dirty = null; ctx.clearRect(0, 0, canvas.width, canvas.height); kick(); },
    auCentre() { goCenter(false); },
    traverser() { goCenter(true); },
    etat() { return { perch: 'posé', fly: 'en vol', hover: 'au centre', pass: 'traverse l’écran', away: 'traverse l’écran', dead: 'en cendres' }[bird.state]; },
  };

  if (!host) window.Phenix = api;
  const boot = () => { init(); if (host) host.__attach(api); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
