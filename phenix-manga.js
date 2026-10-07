/*!
 * Phénix manga : un oiseau de feu dessiné à l'encre qui se promène sur une page HTML.
 * Sans dépendance. Ajoutez juste avant </body> :
 *
 *   <script src="phenix-manga.js" defer></script>
 *
 * Réglages, en attributs de la balise <script> :
 *   data-taille="90"            longueur du corps, en pixels
 *   data-perchoirs="h1, img"    sélecteur CSS des éléments où il peut se poser
 *
 * API : Phenix.renaitre(), Phenix.pause(), Phenix.reprendre(),
 *       Phenix.masquer(), Phenix.afficher(), Phenix.etat()
 */
(() => {
  'use strict';
  if (window.Phenix) return;

  const script = document.currentScript;
  const opts = (script && script.dataset) || {};
  const PERCHES = opts.perchoirs || 'h1, h2, h3, img, button, [data-phenix-perchoir], .phenix-perchoir';
  const TEXTUAL = 'h1, h2, h3, h4, h5, h6, p, a, span, li, label, strong, em';

  /* ---------- Encre et aplats ---------- */
  const INK = '#1c1118';
  const HALO = '#fffdf6';
  const CREAM = '#fff4b8';
  const GOLD = '#ffc42e';
  const ORANGE = '#ff7a1c';
  const RED = '#e8342a';
  const CRIMSON = '#a51d35';
  const EMBER = '#6b1628';
  const AMBER = '#ffa21f';
  const VERMILION = '#f4561e';
  const SMOKE = '#fff8ec';
  const SFX_FONT = '"Dela Gothic One", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif';
  const INK_W = 0.024;  // épaisseur du trait, en fraction de la taille de l'oiseau
  const HALO_W = 0.05;  // liseré clair autour de la silhouette, pour rester lisible sur tous les fonds
  const FOOT = [0.06, 0.62]; // point d'appui des serres, repère local

  const TAU = Math.PI * 2;
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const norm = (x, y) => { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; };
  const lerp2 = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const quadPt = (ax, ay, cx, cy, bx, by, u) => {
    const v = 1 - u;
    return [v * v * ax + 2 * v * u * cx + u * u * bx, v * v * ay + 2 * v * u * cy + u * u * by];
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Formes de base ---------- */
  function circle(x, y, r) { const p = new Path2D(); p.arc(x, y, r, 0, TAU); return p; }
  function oval(x, y, rx, ry, rot) { const p = new Path2D(); p.ellipse(x, y, rx, ry, rot, 0, TAU); return p; }

  // Plume en amande, de la base (bx, by) vers la pointe, dans la direction (dx, dy).
  function leaf(bx, by, dx, dy, len, w) {
    const px = -dy, py = dx;
    const ex = bx + dx * len, ey = by + dy * len;
    const mx = bx + dx * len * 0.55, my = by + dy * len * 0.55;
    const p = new Path2D();
    p.moveTo(bx - px * w * 0.5, by - py * w * 0.5);
    p.quadraticCurveTo(mx - px * w * 0.8, my - py * w * 0.8, ex, ey);
    p.quadraticCurveTo(mx + px * w * 0.8, my + py * w * 0.8, bx + px * w * 0.5, by + py * w * 0.5);
    p.closePath();
    return p;
  }

  // Langue de flamme manga : base arrondie, pointe effilée, petite flammèche sur le côté.
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

  // Formes unitaires des effets, calculées une fois.
  const WISP = [tongue(0, 0.4, 0, -1, 1, 0.36, 0, 0), tongue(0, 0.4, 0, -1, 1, 0.36, 1, 0)];
  const WISP_CORE = tongue(0, 0.34, 0, -1, 0.6, 0.16, 0, 0);
  const STAR4 = (() => {
    const p = new Path2D();
    p.moveTo(0, -1);
    p.quadraticCurveTo(0.12, -0.12, 1, 0);
    p.quadraticCurveTo(0.12, 0.12, 0, 1);
    p.quadraticCurveTo(-0.12, 0.12, -1, 0);
    p.quadraticCurveTo(-0.12, -0.12, 0, -1);
    p.closePath();
    return p;
  })();
  const CLOUD = (() => {
    const p = new Path2D(), n = 7;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, x = Math.cos(a) * 0.8, y = Math.sin(a) * 0.7;
      if (i === 0) { p.moveTo(x, y); continue; }
      const m = ((i - 0.5) / n) * TAU;
      p.quadraticCurveTo(Math.cos(m) * 1.25, Math.sin(m) * 1.1, x, y);
    }
    p.closePath();
    return p;
  })();
  const BANG = (() => {
    const p = new Path2D();
    p.moveTo(-0.17, -1); p.lineTo(0.17, -1); p.lineTo(0.07, 0.28); p.lineTo(-0.07, 0.28); p.closePath();
    p.moveTo(0.15, 0.6); p.arc(0, 0.6, 0.15, 0, TAU);
    return p;
  })();

  /* ---------- État ---------- */
  let canvas, ctx, hit, tone = null;
  let W = 0, H = 0, DPR = 1, S = 80;
  let paused = false, hidden = false, raf = 0, last = 0, time = 0;
  let dirty = null, hitPos = '';
  let detail = 2; // niveau de détail selon la taille : barbes et hachures en dessous d'un seuil
  const fx = [];
  const anchorsLocal = { flight: [], crest: [] };
  const anchors = { flight: [], crest: [] };
  const pointer = { x: -1e5, y: -1e5, moved: -1e5 };
  const bird = {
    x: -400, y: 200, vx: 0, vy: 0, bob: 0, face: 1, tilt: 0,
    phase: 0, glide: 0, fold: 0, e: 0, breath: 0,
    blinkT: 0, nextBlink: 2, beak: 0, stretch: 0, nextStretch: 8,
    state: 'fly', target: null, perch: null, lastPerch: null,
    timer: 0, flyTime: 0, lastFlip: -1, startle: 0, pillar: false,
  };

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
    return { x: hi > lo ? lerp(lo, hi, tg.fx) : (r.left + r.right) / 2, y: r.top, top: r.top };
  }
  // Position des pattes par rapport au centre de l'oiseau, pour une orientation donnée.
  function footOffset(face, tilt) {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const x = FOOT[0] * face * S, y = FOOT[1] * S;
    return [x * c - y * s, x * s + y * c];
  }
  function toWorld(lx, ly) {
    const c = Math.cos(bird.tilt), s = Math.sin(bird.tilt);
    const x = lx * bird.face * S, y = ly * S;
    return [bird.x + x * c - y * s, bird.y + bird.bob + x * s + y * c];
  }

  /* ---------- Comportement ---------- */
  function pickTarget() {
    const list = bird.flyTime > 1.5 ? candidates().filter((el) => el !== bird.lastPerch) : [];
    if (list.length && Math.random() < 0.65) {
      bird.target = { el: list[(Math.random() * list.length) | 0], fx: rand(0.1, 0.9) };
    } else {
      bird.target = {
        x: rand(S * 1.1, Math.max(S * 1.1, W - S * 1.1)),
        y: rand(S * 1.5, Math.max(S * 1.5, H - S * 1.7)),
      };
    }
  }

  function land() {
    bird.state = 'perch';
    bird.perch = bird.target;
    bird.lastPerch = bird.target.el || null;
    bird.vx = 0; bird.vy = 0; bird.glide = 0;
    bird.timer = rand(4, 9);
    bird.flyTime = 0;
    bird.nextStretch = rand(3, 7);
    const [fx0, fy0] = toWorld(FOOT[0], FOOT[1]);
    addPuff(fx0 - S * 0.25, fy0, 0.09 * S, -0.5 * S, -0.1 * S);
    addPuff(fx0 + S * 0.25, fy0, 0.09 * S, 0.5 * S, -0.1 * S);
  }

  function takeoff(away) {
    const [fx0, fy0] = toWorld(FOOT[0], FOOT[1]);
    bird.state = 'fly';
    bird.flyTime = 0;
    bird.phase = Math.PI / 2;
    if (away) {
      const dir = bird.x > pointer.x ? 1 : -1;
      bird.face = dir;
      bird.target = {
        x: clamp(bird.x + dir * rand(3, 6) * S, S * 1.1, Math.max(S * 1.1, W - S * 1.1)),
        y: clamp(bird.y - rand(1, 3) * S, S * 1.5, Math.max(S * 1.5, H - S * 1.7)),
      };
      bird.vx = dir * 2.4 * S; bird.vy = -3 * S;
    } else {
      pickTarget();
      bird.vx = bird.face * 1.2 * S; bird.vy = -2.6 * S;
    }
    addPuff(fx0, fy0, 0.1 * S, 0, 0.2 * S);
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
    const want = 3.6 * S * Math.min(1, dist / (tg.el ? 2.2 * S : 1.2 * S));
    const k = Math.min(1, dt * 2.4);
    bird.vx += ((dx / dist) * want - bird.vx) * k;
    bird.vy += ((dy / dist) * want - bird.vy) * k;
    if (!(tg.el && dist < 2 * S)) bird.vy += Math.sin(time * 1.7) * 0.6 * S * dt;
    // Il s'écarte du curseur
    const px = bird.x - pointer.x, py = bird.y - pointer.y, pd = Math.hypot(px, py) || 1;
    if (pd < 1.3 * S && time - pointer.moved < 0.5) {
      bird.vx += (px / pd) * 9 * S * dt;
      bird.vy += (py / pd) * 9 * S * dt;
    }
    bird.x += bird.vx * dt;
    bird.y += bird.vy * dt;

    if (Math.abs(bird.vx) > 0.4 * S) bird.face = bird.vx > 0 ? 1 : -1;
    const near = tg.el && dist < 1.6 * S;
    // Il se penche en avant quand il file, se redresse en montée et à l'approche
    const lean = near ? 0 : 0.75 * Math.min(1, Math.abs(bird.vx) / (3 * S)) + 0.2 * clamp(bird.vy / (2 * S), -1, 1);
    bird.tilt += (bird.face * Math.max(0, lean) - bird.tilt) * Math.min(1, dt * 5);

    // Il bat des ailes tout le temps qu'il vole : coup vers le bas rapide et puissant, remontée plus lente.
    // Plus vite en montée, un peu moins en descente. Il ne tient ses ailes levées qu'au moment de se poser.
    const flare = tg.el && dist < 0.6 * S;
    bird.glide += ((flare ? 1 : 0) - bird.glide) * Math.min(1, dt * 6);
    const freq = bird.vy < -0.8 * S ? 3.3 : bird.vy > 1.2 * S ? 2.4 : 2.8;
    const down = Math.cos(bird.phase) < 0;
    bird.phase += TAU * freq * dt * (down ? 1.3 : 0.8) * (1 - 0.7 * bird.glide);
    bird.e = lerp(Math.sin(bird.phase), 0.75, bird.glide);
    bird.fold += (0 - bird.fold) * Math.min(1, dt * 6);
    // Le corps monte à chaque coup d'aile vers le bas, et redescend à la remontée
    bird.bob = Math.sin(bird.phase) * 0.05 * S * (1 - bird.glide);

    if (tg.el ? dist < 0.25 * S : dist < 0.6 * S) {
      if (tg.el) land(); else pickTarget();
    }
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
      if (f !== bird.face) { bird.face = f; bird.lastFlip = time; }
    }
    bird.tilt += (0 - bird.tilt) * Math.min(1, dt * 8);
    bird.bob = 0;
    const p = perchPoint(tg);
    const off = footOffset(bird.face, bird.tilt);
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
      bird.startle = 0.35;
      bird.beak = 1;
      fx.push({ k: 'bang', life: 0, max: 0.7 });
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
    bird.perch = list.length
      ? { el: list[0], fx: 0.8 }
      : { x: W - S * 1.2, y: H - S * 0.3 };
    bird.state = 'perch';
    bird.fold = 1;
    bird.e = 0.8;
    bird.tilt = 0;
  }

  function burst() {
    if (bird.state === 'dead' || hidden || reduce.matches) return;
    const [cx, cy] = toWorld(0.03, -0.2);
    bird.state = 'dead';
    bird.timer = 1.15;
    bird.pillar = false;
    bird.burstX = cx;
    bird.burstY = cy;
    const seed = [];
    for (let i = 0; i < 16; i++) seed.push(rand(0.75, 1.25));
    fx.push({ k: 'star', x: cx, y: cy, life: 0, max: 0.5, seed });
    const lines = [];
    for (let i = 0; i < 30; i++) lines.push([Math.random() * TAU, rand(0.85, 1.25)]);
    fx.push({ k: 'focus', x: cx, y: cy, life: 0, max: 0.42, lines });
    for (let i = 0; i < 9; i++) {
      addPuff(cx + rand(-0.4, 0.4) * S, cy + rand(-0.3, 0.3) * S, rand(0.14, 0.26) * S, rand(-1, 1) * S, rand(-1.2, 0.2) * S, rand(0.8, 1.3));
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU, v = rand(2, 5) * S;
      fx.push({ k: 'wisp', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rand(0.5, 0.9), size: rand(0.1, 0.18) * S, flick: i & 1, seed: Math.random() * TAU });
    }
    fx.push({ k: 'sfx', text: 'ボワッ!!', x: cx + bird.face * 0.45 * S, y: cy - 1.0 * S, rot: rand(-0.25, -0.1), size: 0.5 * S, fill: RED, life: 0, max: 0.95 });
  }

  function reborn() {
    const cx = bird.burstX, cy = bird.burstY;
    bird.state = 'fly';
    bird.x = cx; bird.y = cy + 0.2 * S;
    bird.vx = 0; bird.vy = -2.6 * S;
    bird.fold = 0; bird.glide = 0; bird.tilt = 0; bird.phase = Math.PI / 2;
    bird.flyTime = 0;
    pickTarget();
    for (let i = 0; i < 8; i++) addSpark(cx + rand(-1, 1) * S, cy + rand(-1, 0.6) * S, rand(0.08, 0.15) * S);
    fx.push({ k: 'sfx', text: 'キラッ', x: cx - bird.face * 0.8 * S, y: cy - 1.1 * S, rot: rand(0.08, 0.2), size: 0.3 * S, fill: GOLD, life: 0, max: 0.8 });
  }

  /* ---------- Effets ---------- */
  function addPuff(x, y, r, vx, vy, max) {
    fx.push({ k: 'puff', x, y, r, vx, vy, life: 0, max: max || 0.6 });
  }
  function addSpark(x, y, size) {
    fx.push({ k: 'spark', x, y, size, rot: Math.random() * 0.6, life: 0, max: rand(0.5, 0.9) });
  }
  function addWisp(x, y) {
    fx.push({
      k: 'wisp', x, y,
      vx: -bird.vx * 0.05 + rand(-0.25, 0.25) * S, vy: rand(-0.6, -0.2) * S,
      life: 0, max: rand(0.45, 0.9), size: rand(0.07, 0.13) * S, flick: Math.random() < 0.5 ? 1 : 0, seed: Math.random() * TAU,
    });
  }
  function emitN(expected, fn) {
    let n = expected | 0;
    if (Math.random() < expected - n) n++;
    for (let i = 0; i < n; i++) fn();
  }

  function emit(dt) {
    if (reduce.matches || bird.state === 'dead' || fx.length > 220) return;
    const flying = bird.state === 'fly';
    const pts = flying ? anchors.flight : anchors.crest;
    if (pts.length) emitN((flying ? 28 : 6) * dt, () => { const p = pts[(Math.random() * pts.length) | 0]; addWisp(p[0], p[1]); });
    if (flying) emitN(3 * dt, () => addSpark(bird.x + rand(-1, 1) * S, bird.y + rand(-0.8, 0.6) * S, rand(0.07, 0.12) * S));
  }

  function updateFx(dt) {
    const dragW = Math.exp(-1.5 * dt), dragP = Math.exp(-2.2 * dt);
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life += dt;
      if (f.life >= f.max) { fx.splice(i, 1); continue; }
      if (f.k === 'wisp') {
        f.vy -= 1.0 * S * dt;
        f.vx *= dragW; f.vy *= dragW;
        f.x += f.vx * dt; f.y += f.vy * dt;
      } else if (f.k === 'puff') {
        f.vx *= dragP; f.vy *= dragP;
        f.x += f.vx * dt; f.y += f.vy * dt;
      } else if (f.k === 'spark') {
        f.y -= 0.2 * S * dt;
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
    else {
      bird.timer -= dt;
      if (bird.timer < 0.3 && !bird.pillar) {
        bird.pillar = true;
        fx.push({ k: 'pillar', x: bird.burstX, y: bird.burstY + 0.9 * S, life: 0, max: 0.65 });
      }
      if (bird.timer <= 0) reborn();
    }
    emit(dt);
    updateFx(dt);
  }

  /* ---------- Dessin de l'oiseau (repère local : tourné vers +x, y vers le bas, unité = taille) ---------- */
  const rot2 = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
  let UPX = 0, UPY = -1; // « haut » du monde, vu de l'oiseau

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

  // Plume-flamme détaillée : aplat, ombre, reflet, rachis et barbes, puis contour encré.
  function plume(sh, bx, by, dx, dy, len, w, o) {
    const iw = o.ink || INK_W * 0.75;
    const curl = o.curl || 0, side = o.side || 1;
    const halo = o.halo !== false;
    if (o.split) {
      const [fx, fy] = rot2(dx, dy, o.split);
      const p2 = tongue(bx + dx * len * 0.58, by + dy * len * 0.58, fx, fy, len * 0.45, w * 0.42, 0, curl * 1.4);
      sh.push({ p: p2, f: o.dark || o.fill, w: iw, halo, tone: o.tone });
    }
    const p = tongue(bx, by, dx, dy, len, w, o.flick ? 1 : 0, curl);
    sh.push({ p, f: o.fill, halo, hw: iw, tone: o.tone });
    const px = -dy, py = dx, parts = [];
    if (o.dark) parts.push({ p: tongue(bx + px * w * 0.55 * side, by + py * w * 0.55 * side, dx, dy, len * 0.95, w * 0.55, 0, curl), f: o.dark, tone: o.tone });
    if (o.light) parts.push({ p: tongue(bx - px * w * 0.3 * side, by - py * w * 0.3 * side, dx, dy, len * 0.72, w * 0.32, 0, curl * 0.9), f: o.light });
    if (detail > 0 && o.barbs !== false && len * S > 12) {
      const tipx = bx + dx * len + px * w * curl * 3, tipy = by + dy * len + py * w * curl * 3;
      const mx = bx + dx * len * 0.55, my = by + dy * len * 0.55;
      const ex = lerp(mx, tipx, 0.6), ey = lerp(my, tipy, 0.6);
      const lines = new Path2D();
      lines.moveTo(bx, by);
      lines.quadraticCurveTo(mx, my, ex, ey);
      if (detail > 1) {
        for (let u = 0.28; u < 0.86; u += 0.11) {
          const [rx, ry] = quadPt(bx, by, mx, my, ex, ey, u);
          const [qx, qy] = quadPt(bx, by, mx, my, ex, ey, Math.min(1, u + 0.14));
          lines.moveTo(rx, ry);
          lines.lineTo(qx + px * w * 0.8 * side, qy + py * w * 0.8 * side);
          lines.moveTo(rx, ry);
          lines.lineTo(qx - px * w * 0.55 * side, qy - py * w * 0.55 * side);
        }
      }
      parts.push({ p: lines, w: INK_W * 0.38 });
    }
    if (parts.length) sh.push({ clip: p, parts });
    sh.push({ p, f: null, w: iw });
  }

  // Aile en éventail. k : 0 baissée → 1 levée ; kh : idem pour la main (retard du battement).
  // o = -1 pour l'aile proche (s'ouvre vers l'arrière), +1 pour l'aile lointaine (s'ouvre vers l'avant).
  function wing(sh, sx, sy, k, kh, o, scale, far, out) {
    const lo = o < 0 ? 2.25 : 0.6, hi = o < 0 ? 4.28 : -1.31;
    const thA = lerp(lo, hi, k) - o * 0.15;
    const thH = lerp(lo, hi, clamp(kh, 0, 1)) + o * 0.35;
    const LA = 0.44 * scale, LH = 0.56 * scale;
    const wx = sx + Math.cos(thA) * LA, wy = sy + Math.sin(thA) * LA;
    const tx = wx + Math.cos(thH) * LH, ty = wy + Math.sin(thH) * LH;
    const along = (f) => {
      const d = f * (LA + LH);
      return d < LA ? [sx + Math.cos(thA) * d, sy + Math.sin(thA) * d] : [wx + Math.cos(thH) * (d - LA), wy + Math.sin(thH) * (d - LA)];
    };
    const spread = far ? 0.85 : 1.1;
    const dirAt = (u) => { const a = lerp(thH + o * spread, thH - o * 0.05, clamp(u, 0, 1) ** 0.8); return [Math.cos(a), Math.sin(a)]; };
    const [ix, iy] = dirAt(0);
    const ldx = -ix, ldy = -iy; // vers le bord d'attaque
    const fl = (i) => Math.sin(time * 7 + i * 1.3 + o) * 0.08;
    const P = far
      ? { pri: [CRIMSON, EMBER, RED], sec: [CRIMSON, EMBER, VERMILION], gc: [RED, CRIMSON, ORANGE], mc: [VERMILION, RED, GOLD], band: VERMILION }
      : { pri: [RED, CRIMSON, ORANGE], sec: [VERMILION, RED, GOLD], gc: [ORANGE, VERMILION, GOLD], mc: [AMBER, ORANGE, CREAM], band: ORANGE };
    const side = -o;
    const keep = detail;
    if (far) detail = Math.max(0, detail - 1);

    // Rémiges primaires, sur la main, fourchues au bout
    for (let i = 6; i >= 0; i--) {
      const r = i / 6;
      const [bx, by] = along(lerp(0.42, 0.96, r));
      const [dx, dy] = dirAt(lerp(0.55, 1, r));
      const len = lerp(0.58, 0.88, r ** 1.2) * scale;
      plume(sh, bx, by, dx, dy, len, 0.11 * scale, { fill: P.pri[0], dark: P.pri[1], light: P.pri[2], curl: o * (0.3 + 0.08 * r) + fl(i), flick: far ? 0 : 1, split: !far && r > 0.4 ? o * 0.5 : 0, tone: far, side });
      if (!far && i >= 5) out.push([bx + dx * len, by + dy * len]);
    }
    // Rémiges secondaires, sur le bras
    for (let i = 6; i >= 0; i--) {
      const r = i / 6;
      const [bx, by] = along(lerp(0.05, 0.42, r));
      const [dx, dy] = dirAt(lerp(0, 0.52, r));
      plume(sh, bx, by, dx, dy, lerp(0.4, 0.56, r) * scale, 0.1 * scale, { fill: P.sec[0], dark: P.sec[1], light: P.sec[2], curl: o * 0.24 + fl(i + 7), flick: far ? 0 : i % 2, tone: far, side });
    }
    // Flammèches qui montent du bord d'attaque
    for (let i = 0; i < 4; i++) {
      const [bx, by] = along(0.12 + i * 0.17);
      const [dx, dy] = norm(UPX + ldx * 0.8, UPY + ldy * 0.8);
      const f = Math.sin(time * 9 + i * 1.9 + o) * 0.5 + 0.5;
      plume(sh, bx, by, dx, dy, (0.09 + 0.06 * f) * scale, 0.035 * scale, { fill: far ? RED : ORANGE, light: GOLD, curl: 0.3 * (f - 0.5), flick: 1, barbs: false, tone: far });
    }
    // Grandes couvertures
    for (let i = 8; i >= 0; i--) {
      const r = i / 8;
      const [bx, by] = along(lerp(0.03, 0.72, r));
      const [dx, dy] = dirAt(lerp(0, 0.9, r));
      plume(sh, bx + ldx * 0.02, by + ldy * 0.02, dx, dy, lerp(0.22, 0.32, r) * scale, 0.085 * scale, { fill: P.gc[0], dark: P.gc[1], light: P.gc[2], curl: o * 0.18, tone: far, side });
    }
    // Petites couvertures, en écailles
    for (let i = 7; i >= 0; i--) {
      const r = i / 7;
      const [bx, by] = along(lerp(0.02, 0.6, r));
      const [dx, dy] = dirAt(lerp(0, 0.75, r));
      plume(sh, bx + ldx * 0.035, by + ldy * 0.035, dx, dy, lerp(0.13, 0.17, r) * scale, 0.075 * scale, { fill: P.mc[0], dark: P.mc[1], light: P.mc[2], barbs: false, tone: far, side });
    }
    // Bord festonné de l'aile
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
    sh.push({ p: band, f: P.band, halo: true, tone: far });
    if (detail > 0) {
      const sc = new Path2D();
      for (let j = 0; j < rows; j++) {
        const a = lerp2(edge[j], inner[rows - j], 0.5), b = lerp2(edge[j + 1], inner[rows - j - 1], 0.5);
        sc.moveTo(a[0], a[1]);
        sc.quadraticCurveTo((a[0] + b[0]) / 2 + ix * 0.03 * scale, (a[1] + b[1]) / 2 + iy * 0.03 * scale, b[0], b[1]);
      }
      sh.push({ clip: band, parts: [{ p: sc, w: INK_W * 0.45 }] });
    }
    sh.push({ p: band, f: null, w: INK_W * 0.9 });
    // Pointe de l'aile en feu
    const f = Math.sin(time * 10 + o) * 0.5 + Math.sin(time * 6.3) * 0.5;
    const len = (0.22 + 0.06 * f) * scale;
    const hdx = Math.cos(thH), hdy = Math.sin(thH);
    plume(sh, tx, ty, hdx, hdy, len, 0.05 * scale, { fill: far ? RED : ORANGE, light: GOLD, curl: o * 0.3 + 0.15 * f, flick: 1, split: -o * 0.6, barbs: false, tone: far });
    out.push([tx + hdx * len, ty + hdy * len]);
    detail = keep;
  }

  // Patte écailleuse, serres noires, culotte de plumes. k : 0 repliée (en vol) → 1 tendue.
  function leg(sh, far, k, dX, dY, fX, fY) {
    const hx = far ? -0.03 : 0.04, hy = 0.22;
    const ax = lerp(hx + 0.1, hx + 0.02, k) + (far ? -0.02 : 0), ay = lerp(0.42, 0.62, k);
    const kx = hx + 0.015, ky = hy + 0.12;
    const col = far ? AMBER : GOLD;
    const tar = ribbonW([[kx, ky], [lerp(kx, ax, 0.5) + 0.01, lerp(ky, ay, 0.5)], [ax, ay]], (v) => lerp(0.026, 0.019, v));
    sh.push({ p: tar, f: col, halo: true, tone: far });
    if (detail > 0) {
      const sc = new Path2D();
      for (let v = 0.25; v < 0.95; v += 0.15) {
        const x = lerp(kx, ax, v), y = lerp(ky, ay, v);
        sc.moveTo(x - 0.02, y - 0.006);
        sc.quadraticCurveTo(x, y + 0.008, x + 0.02, y - 0.006);
      }
      sh.push({ clip: tar, parts: [{ p: sc, w: INK_W * 0.4 }] });
    }
    sh.push({ p: tar, f: null, w: INK_W * 0.8 });
    const toeK = lerp(0.55, 1, k);
    for (const [a, c] of [[-0.065, 0.006], [0.1, 0.01], [0.08, 0.034]]) {
      const tx = ax + (fX * a + dX * c) * toeK, ty = ay + (fY * a + dY * c) * toeK, s = a > 0 ? 1 : -1;
      sh.push({ p: ribbonW([[ax, ay], [(ax + tx) / 2, (ay + ty) / 2], [tx, ty]], (v) => lerp(0.014, 0.01, v)), f: col, w: INK_W * 0.7, halo: true });
      const claw = new Path2D();
      claw.moveTo(tx - dX * 0.012, ty - dY * 0.012);
      claw.quadraticCurveTo(tx + fX * 0.035 * s, ty + fY * 0.035 * s, tx + fX * 0.014 * s + dX * 0.042, ty + fY * 0.014 * s + dY * 0.042);
      claw.lineTo(tx + dX * 0.012, ty + dY * 0.012);
      claw.closePath();
      sh.push({ p: claw, f: INK, w: INK_W * 0.5, halo: true });
    }
    for (let i = 4; i >= 0; i--) {
      const r = i / 4, sw = lerp(-0.25, 0.35, r);
      const [dx, dy] = norm(dX - fX * sw, dY - fY * sw);
      plume(sh, hx + lerp(-0.06, 0.07, r), hy - 0.02, dx, dy, lerp(0.17, 0.24, 1 - Math.abs(r - 0.5) * 2), 0.05, {
        fill: far ? CRIMSON : i % 2 ? ORANGE : AMBER, dark: far ? EMBER : VERMILION, light: far ? RED : GOLD,
        curl: i % 2 ? 0.25 : -0.25, flick: i % 2, barbs: false, tone: far,
      });
    }
  }

  // Plume de queue : tige fine, large vexille barbée, bout en flamme fourchue.
  function tailPlume(sh, pts, back, j) {
    const vane = (v) => 0.013 + 0.055 * clamp((v - 0.38) / 0.27, 0, 1) * (1 - clamp((v - 0.86) / 0.14, 0, 1));
    const shape = ribbonW(pts, vane);
    sh.push({ p: shape, f: back ? CRIMSON : j % 4 ? RED : VERMILION, halo: true, tone: back, hw: INK_W * 0.75 });
    const parts = [{ p: ribbonW(pts.map(([x, y]) => [x + 0.008, y]), (v) => (v < 0.42 ? 0 : vane(v) * 0.42)), f: back ? RED : GOLD }];
    if (detail > 0) {
      const lines = new Path2D();
      smoothTo(lines, pts.slice(2), true);
      if (detail > 1) {
        for (let n = 5; n < pts.length - 1; n++) {
          const [x, y] = pts[n], [nx, ny] = pts[n + 1];
          const [tx, ty] = norm(nx - x, ny - y);
          const w = vane(n / (pts.length - 1)) * 1.1;
          for (const s of [1, -1]) {
            lines.moveTo(x, y);
            lines.lineTo(x + tx * w * 0.9 - ty * w * s, y + ty * w * 0.9 + tx * w * s);
          }
        }
      }
      parts.push({ p: lines, w: INK_W * 0.38 });
    }
    sh.push({ clip: shape, parts });
    sh.push({ p: shape, f: null, w: INK_W * 0.75 });
    const end = pts[pts.length - 1], pre = pts[pts.length - 2];
    const [ex, ey] = norm(end[0] - pre[0], end[1] - pre[1]);
    const curl = (j % 2 ? 0.55 : -0.55) + Math.sin(time * 4 + j) * 0.12;
    plume(sh, end[0] - ex * 0.02, end[1] - ey * 0.02, ex, ey, 0.22, 0.05, {
      fill: back ? CRIMSON : RED, dark: back ? EMBER : CRIMSON, light: GOLD, curl, flick: 1, split: -Math.sign(curl) * 0.55, barbs: false, tone: back,
    });
    return [end[0] + ex * 0.22, end[1] + ey * 0.22];
  }

  function neckAt(pts, v) {
    const n = pts.length - 1, f = clamp(v, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
    const a = pts[i], b = pts[i + 1];
    const [tx, ty] = norm(b[0] - a[0], b[1] - a[1]);
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), tx, ty];
  }

  function buildBird() {
    const sh = [], flight = [], crest = [];
    const { fold, e, face, tilt } = bird;
    const trail = Math.min(1, Math.hypot(bird.vx, bird.vy) / S / 3.5);
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    UPX = -face * st; UPY = -ct;
    const dX = -UPX, dY = -UPY;         // bas
    const fX = ct, fY = -face * st;     // horizontale vers l'avant
    const k = (e + 1) / 2;
    const kh = k - 0.26 * Math.cos(bird.phase) * (1 - bird.glide) * (1 - fold);

    // Aile lointaine, plus sombre et tramée, levée derrière la tête
    wing(sh, 0.03, -0.24, clamp(k * 0.95 + 0.04, 0, 1), kh, 1, 0.82, true, flight);

    // Queue : onze plumes en cascade, couche arrière puis couche avant
    const [bdx, bdy] = norm(lerp(-0.5, -0.22, fold), 1);
    for (const j of [1, 9, 3, 7, 5, 0, 10, 2, 8, 4, 6]) {
      const back = j % 2 === 1;
      const [dx, dy] = rot2(bdx, bdy, (j - 5) * 0.085 * (1 - 0.25 * trail));
      const px = -dy, py = dx;
      const len = (back ? 1.05 : 0.95) + 0.6 * (1 - Math.abs(j - 5) / 5) ** 1.2;
      const pts = [];
      for (let n = 0; n <= 11; n++) {
        const v = n / 11;
        const wave = Math.sin(v * 3 - time * 3.2 + j * 0.7) * 0.09 * v;
        pts.push([-0.08 + dx * len * v + px * wave - trail * 0.45 * v * v, 0.33 + dy * len * v + py * wave]);
      }
      flight.push(tailPlume(sh, pts, back, j));
    }
    // Couvertures de la queue
    for (let i = 6; i >= 0; i--) {
      const r = i / 6;
      const [dx, dy] = rot2(bdx, bdy, lerp(-0.7, 0.6, r));
      plume(sh, -0.08 + lerp(-0.05, 0.05, r), 0.27, dx, dy, lerp(0.3, 0.42, 1 - Math.abs(r - 0.5) * 2), 0.07, {
        fill: i % 2 ? VERMILION : ORANGE, dark: RED, light: GOLD, curl: i % 2 ? 0.3 : -0.3, flick: 1,
      });
    }

    leg(sh, true, fold, dX, dY, fX, fY);

    // Cou en S, couvert d'un camail de plumes pointues
    const neckPts = [[0, -0.25], [0.085, -0.36], [0.07, -0.48], [0.11, -0.58], [0.19, -0.645]];
    const neckW = (v) => lerp(0.09, 0.055, v);
    const neck = ribbonW(neckPts, neckW);
    sh.push({ p: neck, f: ORANGE, halo: true });
    sh.push({ clip: neck, parts: [{ p: ribbonW(neckPts.map(([x, y]) => [x + 0.04, y]), (v) => lerp(0.035, 0.018, v)), f: GOLD }] });
    sh.push({ p: neck, f: null, w: INK_W });
    for (let i = 0; i < 10; i++) {
      const v = 0.04 + (0.9 * i) / 9;
      const [x, y, tx, ty] = neckAt(neckPts, v);
      const w = neckW(v), sway = Math.sin(time * 4 + i * 0.8) * 0.08;
      const [hx, hy] = norm(-0.55 + sway, 0.85);
      plume(sh, x + ty * w * 0.55, y - tx * w * 0.55, hx, hy, 0.13 + 0.07 * (1 - v), 0.048, {
        fill: i % 2 ? GOLD : AMBER, dark: ORANGE, light: CREAM, curl: -0.3 + sway, flick: i % 3 === 0, barbs: false,
      });
      if (i % 2 === 0) {
        const [gx, gy] = norm(0.3, 1);
        plume(sh, x - ty * w * 0.4, y + tx * w * 0.4, gx, gy, 0.08, 0.03, { fill: GOLD, light: CREAM, curl: 0.2, barbs: false });
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
    sh.push({ p: body, f: ORANGE, halo: true });
    const back = new Path2D();
    back.moveTo(-0.08, -0.3);
    back.bezierCurveTo(-0.22, -0.1, -0.22, 0.2, -0.1, 0.4);
    back.lineTo(-0.02, 0.4);
    back.bezierCurveTo(-0.12, 0.2, -0.12, -0.1, -0.02, -0.3);
    back.closePath();
    const bodyParts = [{ p: back, f: RED, tone: true }, { p: oval(0.11, -0.01, 0.085, 0.19, -0.2), f: GOLD }];
    if (detail > 0) {
      const hatch = new Path2D();
      for (let i = 0; i < 7; i++) {
        const y = -0.2 + i * 0.075;
        hatch.moveTo(-0.2, y + 0.04);
        hatch.lineTo(-0.1, y - 0.02);
      }
      bodyParts.push({ p: hatch, w: INK_W * 0.4 });
    }
    const rows = [[0.22, [-0.05, 0.03, 0.1]], [0.12, [-0.08, 0, 0.08, 0.15]], [0.02, [-0.07, 0.01, 0.09, 0.17]], [-0.08, [-0.05, 0.03, 0.11, 0.18]], [-0.18, [-0.01, 0.06, 0.13]]];
    for (const [y, xs] of rows) {
      for (const x of xs) {
        const lit = x > 0.06;
        const [gx, gy] = norm(0.12, 1);
        const fp = tongue(x, y - 0.05, gx, gy, 0.11, 0.036, 0, x > 0.04 ? 0.15 : -0.15);
        bodyParts.push({ p: fp, f: lit ? GOLD : AMBER });
        if (lit) bodyParts.push({ p: tongue(x - 0.008, y - 0.045, gx, gy, 0.07, 0.014, 0, 0.1), f: CREAM });
        bodyParts.push({ p: fp, w: INK_W * 0.5 });
      }
    }
    sh.push({ clip: body, parts: bodyParts });
    sh.push({ p: body, f: null, w: INK_W * 1.1 });
    // Franges du ventre
    for (let i = 0; i < 6; i++) {
      const r = i / 5;
      const [dx, dy] = norm(lerp(-0.35, 0.1, r) + Math.sin(time * 3 + i) * 0.05, 1);
      plume(sh, lerp(-0.13, 0.11, r), 0.29 + 0.05 * Math.sin(r * Math.PI), dx, dy, 0.15 + 0.05 * Math.sin(r * Math.PI), 0.05, {
        fill: i % 2 ? ORANGE : AMBER, dark: VERMILION, light: GOLD, curl: i % 2 ? 0.3 : -0.3, flick: 1, barbs: false,
      });
    }

    leg(sh, false, fold, dX, dY, fX, fY);

    // Flammes aux épaules
    for (let i = 0; i < 3; i++) {
      const f = Math.sin(time * 8 + i * 2) * 0.5 + 0.5;
      plume(sh, -0.09 + i * 0.06, -0.26 - (i === 1 ? 0.02 : 0), UPX, UPY, 0.1 + 0.06 * f, 0.035, { fill: ORANGE, light: GOLD, curl: 0.3 * (f - 0.5), flick: 1, barbs: false });
    }

    // Aile proche, levée vers l'arrière
    wing(sh, -0.08, -0.2, k, kh, -1, 1, false, flight);

    // Aigrette : six longues plumes fourchues, et le duvet du crâne
    const CD = [[-0.3, -0.95], [-0.55, -0.82], [-0.78, -0.6], [-0.92, -0.36], [-0.98, -0.1], [-0.92, 0.2]];
    const CL = [0.34, 0.46, 0.52, 0.46, 0.38, 0.3];
    for (let i = 0; i < 6; i++) {
      const sway = Math.sin(time * 3 + i * 0.9) * 0.1;
      let [dx, dy] = norm(lerp(CD[i][0], -1, trail * 0.5), lerp(CD[i][1], 0.05, trail * 0.5));
      [dx, dy] = rot2(dx, dy, sway);
      const curl = (i % 2 ? 0.4 : -0.35) + sway;
      plume(sh, 0.16, -0.7, dx, dy, CL[i], 0.042, { fill: i % 2 ? RED : VERMILION, dark: CRIMSON, light: GOLD, curl, flick: 1, split: i % 2 ? -0.5 : 0.5 });
      crest.push([0.16 + dx * CL[i], -0.7 + dy * CL[i]]);
    }
    for (let i = 0; i < 3; i++) {
      const [dx, dy] = norm(-0.8, -0.55 + i * 0.25);
      plume(sh, 0.215 - i * 0.03, -0.722 + i * 0.006, dx, dy, 0.1, 0.03, { fill: GOLD, light: CREAM, curl: -0.2, barbs: false });
    }

    // Tête d'aigle, de profil
    const head = new Path2D();
    head.moveTo(0.13, -0.655);
    head.bezierCurveTo(0.13, -0.71, 0.19, -0.735, 0.235, -0.725);
    head.bezierCurveTo(0.265, -0.72, 0.285, -0.705, 0.295, -0.69);
    head.lineTo(0.298, -0.648);
    head.bezierCurveTo(0.27, -0.622, 0.22, -0.603, 0.18, -0.608);
    head.bezierCurveTo(0.15, -0.613, 0.13, -0.63, 0.13, -0.655);
    head.closePath();
    sh.push({ p: head, f: ORANGE, halo: true });
    const headParts = [
      { p: oval(0.235, -0.708, 0.055, 0.018, -0.15), f: GOLD },
      { p: oval(0.16, -0.632, 0.05, 0.04, 0), f: RED, tone: true },
      { p: tongue(0.215, -0.668, -1, 0.15, 0.12, 0.014, 0, 0.25), f: RED },
    ];
    if (detail > 0) {
      const hatch = new Path2D();
      for (let i = 0; i < 4; i++) { hatch.moveTo(0.19 + i * 0.022, -0.6); hatch.lineTo(0.205 + i * 0.022, -0.625); }
      headParts.push({ p: hatch, w: INK_W * 0.4 });
    }
    sh.push({ clip: head, parts: headParts });
    sh.push({ p: head, f: null, w: INK_W });
    // Plumes de joue, rabattues vers l'arrière
    for (let i = 0; i < 3; i++) {
      const [dx, dy] = norm(-1, 0.2 + i * 0.12);
      plume(sh, 0.205 - i * 0.018, -0.647 + i * 0.01, dx, dy, 0.085 + i * 0.01, 0.022, { fill: GOLD, light: CREAM, curl: -0.25, barbs: false });
    }
    // Barbe de flammes sous le bec
    for (let i = 0; i < 2; i++) {
      const [dx, dy] = norm(-0.3 - i * 0.25, 1);
      plume(sh, 0.24 - i * 0.03, -0.615, dx, dy, 0.08, 0.022, { fill: ORANGE, light: GOLD, curl: 0.3, flick: 1, barbs: false });
    }

    // Bec crochu : cire à la base, narine, pointe sombre ; il s'ouvre quand il sursaute
    const open = bird.beak * 0.035;
    const lower = new Path2D();
    lower.moveTo(0.303, -0.655);
    lower.quadraticCurveTo(0.345, -0.652 + open, 0.37, -0.643 + open * 1.3);
    lower.quadraticCurveTo(0.34, -0.632 + open, 0.304, -0.636);
    lower.closePath();
    sh.push({ p: lower, f: AMBER, w: INK_W * 0.8, halo: true });
    const upper = new Path2D();
    upper.moveTo(0.3, -0.706);
    upper.quadraticCurveTo(0.372, -0.716, 0.404, -0.645);
    upper.quadraticCurveTo(0.395, -0.636, 0.386, -0.648);
    upper.quadraticCurveTo(0.36, -0.66, 0.302, -0.654);
    upper.closePath();
    sh.push({ p: upper, f: GOLD, halo: true });
    sh.push({ clip: upper, parts: [
      { p: oval(0.36, -0.652, 0.07, 0.012, 0.15), f: AMBER },
      { p: circle(0.4, -0.648, 0.022), f: ORANGE },
      { p: oval(0.34, -0.703, 0.04, 0.007, 0.1), f: CREAM },
    ] });
    sh.push({ p: upper, f: null, w: INK_W * 0.8 });
    const cere = new Path2D();
    cere.moveTo(0.284, -0.71);
    cere.quadraticCurveTo(0.304, -0.712, 0.31, -0.694);
    cere.lineTo(0.307, -0.655);
    cere.quadraticCurveTo(0.293, -0.651, 0.283, -0.655);
    cere.closePath();
    sh.push({ p: cere, f: CREAM, w: INK_W * 0.6 });
    sh.push({ p: oval(0.3, -0.686, 0.006, 0.0035, 0.3), f: INK });

    // Arcade sourcilière, œil, paupières
    const brow = new Path2D();
    brow.moveTo(0.19, -0.698);
    brow.quadraticCurveTo(0.24, -0.726, 0.298, -0.699);
    brow.quadraticCurveTo(0.272, -0.69, 0.252, -0.687);
    brow.quadraticCurveTo(0.22, -0.69, 0.19, -0.698);
    brow.closePath();
    const blink = bird.blinkT > 0;
    if (!blink) {
      const eye = new Path2D();
      eye.moveTo(0.207, -0.672);
      eye.quadraticCurveTo(0.233, -0.692, 0.266, -0.68);
      eye.quadraticCurveTo(0.24, -0.657, 0.207, -0.672);
      eye.closePath();
      sh.push({ p: eye, f: GOLD });
      sh.push({ clip: eye, parts: [
        { p: circle(0.241, -0.675, 0.0125), f: ORANGE },
        { p: circle(0.242, -0.675, 0.0078), f: INK },
        { p: circle(0.238, -0.679, 0.0042), f: HALO },
        { p: circle(0.246, -0.671, 0.0021), f: HALO },
      ] });
      sh.push({ p: eye, f: null, w: INK_W * 0.55 });
      const lid = new Path2D();
      lid.moveTo(0.214, -0.667);
      lid.quadraticCurveTo(0.24, -0.659, 0.262, -0.672);
      sh.push({ p: lid, f: null, w: 0.006 });
    }
    const liner = new Path2D();
    liner.moveTo(0.2, -0.669);
    liner.quadraticCurveTo(0.232, blink ? -0.664 : -0.694, 0.27, -0.681);
    liner.moveTo(0.207, -0.672);
    liner.lineTo(0.186, -0.665);
    sh.push({ p: liner, f: null, w: 0.016 });
    sh.push({ p: brow, f: VERMILION, w: INK_W * 0.6 });

    anchorsLocal.flight = flight;
    anchorsLocal.crest = crest.concat(flight.slice(0, 3));
    return sh;
  }

  /* ---------- Rendu ---------- */
  function mark(x, y, r) {
    if (!dirty) dirty = [x - r, y - r, x + r, y + r];
    else {
      dirty[0] = Math.min(dirty[0], x - r); dirty[1] = Math.min(dirty[1], y - r);
      dirty[2] = Math.max(dirty[2], x + r); dirty[3] = Math.max(dirty[3], y + r);
    }
  }

  // Forme encrée en deux passes : liseré clair, puis aplat et trait.
  function inked(p, fill, lw, unit) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = HALO;
    ctx.lineWidth = lw + (HALO_W * S) / unit;
    ctx.stroke(p);
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.stroke(p);
  }
  function place(x, y, unit, rot) {
    ctx.setTransform(DPR * unit, 0, 0, DPR * unit, DPR * x, DPR * y);
    if (rot) ctx.rotate(rot);
  }

  function drawBackFx() {
    const inkPx = INK_W * S;
    for (const f of fx) {
      const a = f.life / f.max;
      if (f.k === 'wisp') {
        const size = f.size * (1 - a) ** 0.6;
        if (size < 1) continue;
        place(f.x, f.y, size, Math.sin(time * 7 + f.seed) * 0.25);
        inked(WISP[f.flick], a < 0.35 ? GOLD : a < 0.7 ? ORANGE : RED, inkPx / size, size);
        if (a < 0.6) { ctx.fillStyle = CREAM; ctx.fill(WISP_CORE); }
        mark(f.x, f.y, size * 1.6);
      } else if (f.k === 'puff') {
        const r = f.r * (a < 0.75 ? 1 + a * 0.6 : (1.45 * (1 - a)) / 0.25);
        if (r < 1) continue;
        place(f.x, f.y, r, f.life * 0.6);
        inked(CLOUD, SMOKE, inkPx / r, r);
        mark(f.x, f.y, r * 1.5);
      } else if (f.k === 'spark') {
        const s = f.size * Math.sin(Math.PI * a);
        if (s < 1) continue;
        place(f.x, f.y, s, f.rot + a);
        inked(STAR4, a < 0.5 ? CREAM : GOLD, (inkPx * 0.8) / s, s);
        mark(f.x, f.y, s * 1.4);
      } else if (f.k === 'pillar') {
        const grow = a < 0.6 ? a / 0.6 : 1 - (a - 0.6) / 0.4;
        const len = 2.3 * S * grow;
        if (len < 2) continue;
        place(f.x, f.y, len);
        const fl = Math.sin(time * 14) * 0.15;
        inked(tongue(0, 0, 0, -1, 1, 0.24, 1, fl), ORANGE, inkPx / len, len);
        ctx.fillStyle = GOLD; ctx.fill(tongue(0, -0.02, 0, -1, 0.75, 0.13, 0, fl));
        ctx.fillStyle = CREAM; ctx.fill(tongue(0, -0.04, 0, -1, 0.45, 0.06, 0, fl));
        mark(f.x, f.y - len / 2, len);
      }
    }
  }

  function drawFrontFx() {
    const inkPx = INK_W * S;
    for (const f of fx) {
      const a = f.life / f.max;
      if (f.k === 'star') {
        const R = S * (0.5 + 1.3 * (1 - (1 - a) ** 3)) * (a > 0.7 ? 1 - (a - 0.7) / 0.3 : 1);
        if (R < 2) continue;
        const p = new Path2D(), q = new Path2D(), n = f.seed.length;
        for (let i = 0; i < n * 2; i++) {
          const ang = (i / (n * 2)) * TAU;
          const r = i % 2 ? 0.52 : f.seed[i >> 1];
          const pt = [Math.cos(ang) * r, Math.sin(ang) * r];
          if (i) { p.lineTo(pt[0], pt[1]); q.lineTo(pt[0] * 0.6, pt[1] * 0.6); }
          else { p.moveTo(pt[0], pt[1]); q.moveTo(pt[0] * 0.6, pt[1] * 0.6); }
        }
        p.closePath(); q.closePath();
        place(f.x, f.y, R);
        inked(p, GOLD, inkPx / R, R);
        ctx.fillStyle = CREAM; ctx.fill(q);
        mark(f.x, f.y, R * 1.4);
      } else if (f.k === 'focus') {
        // Lignes de concentration (集中線)
        place(f.x, f.y, S);
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.85 * (1 - a);
        const r0 = 1.1 + a * 0.5;
        for (const [ang, k] of f.lines) {
          const c = Math.cos(ang), s = Math.sin(ang), w = 0.035;
          ctx.beginPath();
          ctx.moveTo(c * r0 * k, s * r0 * k);
          ctx.lineTo(c * 2.8 - s * w, s * 2.8 + c * w);
          ctx.lineTo(c * 2.8 + s * w, s * 2.8 - c * w);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        mark(f.x, f.y, S * 2.9);
      } else if (f.k === 'sfx') {
        const pop = a < 0.15 ? 0.4 + (a / 0.15) * 0.75 : a < 0.25 ? 1.15 - ((a - 0.15) / 0.1) * 0.15 : a > 0.8 ? 1 - (a - 0.8) / 0.2 : 1;
        if (pop <= 0.02) continue;
        place(f.x, f.y, 1, f.rot);
        ctx.scale(pop, pop);
        ctx.font = `${Math.round(f.size)}px ${SFX_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = HALO; ctx.lineWidth = f.size * 0.34; ctx.strokeText(f.text, 0, 0);
        ctx.strokeStyle = INK; ctx.lineWidth = f.size * 0.16; ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = f.fill; ctx.fillText(f.text, 0, 0);
        mark(f.x, f.y, f.size * 3);
      } else if (f.k === 'bang') {
        // Point d'exclamation au-dessus de la tête
        if (bird.state === 'dead') continue;
        const [hx, hy] = toWorld(0.42, -0.98);
        const pop = a < 0.2 ? 0.5 + (a / 0.2) * 0.6 : a > 0.8 ? 1.1 * (1 - (a - 0.8) / 0.2) : 1.1;
        const u = 0.26 * S * pop;
        if (u < 1) continue;
        place(hx, hy, u, bird.face * 0.18);
        inked(BANG, GOLD, inkPx / u, u);
        ctx.strokeStyle = INK; ctx.lineWidth = (inkPx * 1.2) / u;
        ctx.beginPath();
        for (const ang of [-2.4, -1.57, -0.74]) {
          const c = Math.cos(ang), s = Math.sin(ang);
          ctx.moveTo(c * 1.3, s * 1.3 - 0.3); ctx.lineTo(c * 1.8, s * 1.8 - 0.3);
        }
        ctx.stroke();
        mark(hx, hy, u * 2.2);
      }
    }
  }

  function drawSpeedLines() {
    const v = Math.hypot(bird.vx, bird.vy);
    if (bird.state !== 'fly' || v < 2.4 * S || reduce.matches) return;
    const [dx, dy] = norm(bird.vx, bird.vy), px = -dy, py = dx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.5 * Math.min(1, (v - 2.4 * S) / S);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Les traits changent toutes les trois images, comme en animation
    const seed = Math.floor(time * 20);
    for (let i = 0; i < 7; i++) {
      const r1 = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453, h1 = r1 - Math.floor(r1);
      const r2 = Math.sin(seed * 39.346 + i * 11.135) * 24634.6345, h2 = r2 - Math.floor(r2);
      const off = (h1 - 0.5) * 1.1 * S, start = (0.55 + 0.4 * h2) * S, len = (0.5 + 0.8 * h1) * S;
      const x0 = bird.x - dx * start + px * off, y0 = bird.y - dy * start + py * off;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 - dx * len, y0 - dy * len);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    mark(bird.x, bird.y, S * 2.7);
  }

  function drawBird() {
    if (bird.state === 'dead') { anchors.flight = []; anchors.crest = []; return; }
    const shapes = buildBird();
    const breath = bird.state === 'perch' && !reduce.matches ? Math.sin(bird.breath) * 0.015 : 0;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.translate(bird.x, bird.y + bird.bob);
    ctx.rotate(bird.tilt);
    ctx.scale(bird.face * S, S * (1 + breath));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Passe 1 : liseré clair autour de toute la silhouette
    ctx.strokeStyle = HALO;
    ctx.fillStyle = HALO;
    for (const s of shapes) {
      if (!s.halo) continue;
      ctx.lineWidth = (s.hw || s.w || INK_W) + HALO_W;
      ctx.stroke(s.p);
      if (s.f) ctx.fill(s.p);
    }
    // Passe 2 : aplats, trames, traits
    for (const s of shapes) {
      if (s.parts) {
        ctx.save();
        ctx.clip(s.clip);
        for (const q of s.parts) {
          if (q.f) { ctx.fillStyle = q.f; ctx.fill(q.p); }
          if (q.tone && tone) { ctx.fillStyle = tone; ctx.fill(q.p); }
          if (q.w) { ctx.strokeStyle = INK; ctx.lineWidth = q.w; ctx.stroke(q.p); }
        }
        ctx.restore();
        continue;
      }
      if (s.clip) { ctx.save(); ctx.clip(s.clip); }
      if (s.f) { ctx.fillStyle = s.f; ctx.fill(s.p); }
      if (s.tone && tone) { ctx.fillStyle = tone; ctx.fill(s.p); }
      if (s.w) { ctx.strokeStyle = INK; ctx.lineWidth = s.w; ctx.stroke(s.p); }
      if (s.line) { ctx.strokeStyle = s.line; ctx.lineWidth = s.w * 0.45; ctx.stroke(s.p); }
      if (s.clip) ctx.restore();
    }
    anchors.flight = anchorsLocal.flight.map(([x, y]) => toWorld(x, y));
    anchors.crest = anchorsLocal.crest.map(([x, y]) => toWorld(x, y));
    mark(bird.x, bird.y + S * 0.2, S * 2.7);
  }

  function placeHitbox() {
    let next = 'none';
    if (bird.state !== 'dead' && !hidden && !reduce.matches) {
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
      drawBackFx();
      drawSpeedLines();
      drawBird();
      drawFrontFx();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    placeHitbox();
  }

  /* ---------- Boucle ---------- */
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    if (!paused) update(dt);
    draw();
    if (!paused && !hidden) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && !hidden) { last = 0; raf = requestAnimationFrame(frame); }
  }

  function makeTone() {
    const n = Math.max(4, Math.round(5 * DPR));
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(28,17,24,0.5)';
    x.beginPath();
    x.arc(n / 2, n / 2, n * 0.22, 0, TAU);
    x.fill();
    const pat = ctx.createPattern(c, 'repeat');
    try {
      pat.setTransform(new DOMMatrix().scale(1 / (S * DPR)));
      return pat;
    } catch (err) {
      return null;
    }
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
    tone = makeTone();
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
      bird.face = p.x > W / 2 ? -1 : 1;
      bird.state = 'perch';
      bird.fold = 1;
      bird.e = 0.8;
      bird.tilt = 0;
      bird.lastPerch = first;
      bird.timer = 3.5;
      const off = footOffset(bird.face, bird.tilt);
      bird.x = p.x - off[0];
      bird.y = p.y - off[1];
    } else if (reduce.matches) {
      relocateStill();
    } else {
      bird.x = -1.5 * S; bird.y = H * 0.4; bird.vx = 2.5 * S; bird.face = 1;
      pickTarget();
    }
    kick();
  }

  window.Phenix = {
    renaitre() { paused = false; burst(); kick(); },
    pause() { paused = true; },
    reprendre() { paused = false; kick(); },
    masquer() { hidden = true; canvas.style.display = 'none'; hit.style.display = 'none'; hitPos = 'none'; },
    afficher() { hidden = false; canvas.style.display = ''; dirty = null; ctx.clearRect(0, 0, canvas.width, canvas.height); kick(); },
    etat() { return bird.state === 'perch' ? 'posé' : bird.state === 'fly' ? 'en vol' : 'en cendres'; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
