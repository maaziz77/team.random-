// Shared drawing for both stages: the characters (a small animation rig with random outfits
// and accessories) and the circuit hardware (wall panels, levers, floor plates).
// Everything is drawn with plain canvas calls so the server never has to ship sprites for
// people: it only sends each player's `look`, which is a small JSON object.
(function () {
  const INK = "#1d1b26";
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ------------------------------------------------------------------ looks
  // shirts: [main, shade]. Teal is listed several times so it stays the most common colour.
  const SHIRTS = [
    ["#1fae95", "#168a76"], ["#1fae95", "#168a76"], ["#2ec4b6", "#1f9488"], ["#0f8f86", "#0b6d66"],
    ["#ff6f86", "#d94f67"], ["#ffb000", "#cf8d00"], ["#3fa7ff", "#2a7fd0"], ["#9b6bff", "#7a4fd6"],
    ["#ff7a3d", "#d65e27"], ["#43c47a", "#2f9a5c"], ["#f4efe6", "#d3ccbf"], ["#ef5da8", "#c4447f"],
    ["#5b7bff", "#4058cc"], ["#e8d36a", "#c2ad47"],
  ];
  const ACCENTS = ["#fbf6ec", "#ffd23f", "#ff4b5c", "#1d1b26", "#3fa7ff", "#48e28a", "#ff9ec7", "#9b6bff"];
  const PANTS = ["#2b2d4a", "#3b5b8c", "#4a3f63", "#1d1b26", "#6b5a45", "#5c6378", "#2f6f6a"];
  const SHOES = ["#1d1b26", "#fbf6ec", "#ff4b5c", "#ffd23f", "#3fa7ff", "#8b5a3c"];
  const STYLES = ["tee", "tee", "stripes", "raglan", "hoodie", "overalls", "jacket"];
  const HAIR = ["none", "cap", "side", "spiky", "bun", "curly", "bowl", "long", "mohawk"];
  const HAIR_COL = ["#6b4226", "#2a2321", "#c8642b", "#e0b04a", "#9c9a99", "#3b2a20", "#7a4a2a", "#ff8fb1", "#4fb3ff"];
  const HATS = ["beanie", "headband", "headphones", "bow", "flower"];
  const GREY = { shirt: "#8b86a3", shade: "#6d6885", accent: "#b9b4cc", pants: "#5d5873", shoes: "#4a4560", hatCol: "#a9a4bd", neckCol: "#a9a4bd", packCol: "#7b7693" };

  function makeLook(rnd = Math.random) {
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const chance = (p) => rnd() < p;
    const [shirt, shade] = pick(SHIRTS);
    let accent = pick(ACCENTS); if (accent === shirt) accent = INK;
    const L = {
      shirt, shade, accent, style: pick(STYLES),
      pants: pick(PANTS), shorts: chance(0.25), shoes: pick(SHOES),
      hair: pick(HAIR), hairCol: pick(HAIR_COL.slice(0, rnd() < 0.85 ? 7 : 9)),
      hat: chance(0.38) ? pick(HATS) : null, hatCol: pick(ACCENTS.concat(SHIRTS.map((s) => s[0]))),
      glasses: chance(0.16) ? "round" : chance(0.08) ? "shades" : null,
      blush: chance(0.3), freckles: chance(0.12), bandaid: chance(0.08), mustache: chance(0.06),
      neck: chance(0.12) ? "scarf" : chance(0.1) ? "bowtie" : null, neckCol: pick(ACCENTS.concat(["#ff6f86", "#ffb000"])),
      backpack: chance(0.18), packCol: pick(SHIRTS)[0],
      tall: lerp(0.94, 1.08, rnd()), build: lerp(0.92, 1.1, rnd()),
    };
    if (L.hat === "beanie" && ["bun", "mohawk", "spiky", "cap"].includes(L.hair)) L.hair = "side";
    if (L.hat === "headphones" && L.hair === "cap") L.hair = "bowl";
    if (L.style === "hoodie" && L.neck === "scarf") L.neck = null;
    return L;
  }

  // ------------------------------------------------------------------ rig
  // Each person keeps a little animation state (a.rig). Arms, lean and head are damped springs,
  // so poses blend into each other and overshoot a touch instead of snapping.
  function spring(x, v, target, k, zeta, dt) {
    const c = 2 * Math.sqrt(k) * zeta;
    v += (k * (target - x) - c * v) * dt;
    return [x + v * dt, v];
  }
  function pose(a, name, dur) {
    const r = a.rig || rig(a, performance.now() / 1000, {});
    r.pose = name; r.poseT = dur; r.poseD = dur;
  }
  function rig(a, t, o) {
    let r = a.rig;
    if (!r) {
      r = a.rig = {
        t, face: a.face || 1, spd: 0, lean: 0, lv: 0, head: 0, hv: 0,
        th: [0.1, 0.1], tv: [0, 0], be: [0.3, 0.3], bv: [0, 0], tail: 0, tlv: 0,
        land: 0, was: false, blinkIn: 1 + Math.random() * 3, blink: 0, pose: null, poseT: 0, poseD: 1,
      };
    }
    const dt = clamp(t - r.t, 0, 0.05); r.t = t;
    if (o.frozen) return r;
    const moving = !!a.moving;
    r.face += ((a.face || 1) - r.face) * Math.min(1, dt * 12);
    r.spd += ((moving ? 1 : 0) - r.spd) * Math.min(1, dt * 9);
    if (r.was && !moving) r.land = 1;
    r.was = moving; r.land = Math.max(0, r.land - dt * 4);
    if (r.poseT > 0) { r.poseT -= dt; if (r.poseT <= 0) r.pose = null; }
    r.blinkIn -= dt;
    if (r.blinkIn <= 0) { r.blink = 0.13; r.blinkIn = 2 + Math.random() * 3.5; }
    r.blink = Math.max(0, r.blink - dt);

    const ph = (a.walk || 0) * 9, seed = (a.num || 0) * 1.7;
    const leanT = r.spd * 0.13 * r.face + (o.scared && moving ? 0.07 * r.face : 0);
    [r.lean, r.lv] = spring(r.lean, r.lv, leanT, 90, 0.5, dt);
    const nod = Math.sin(ph * 2) * 0.04 * r.spd;
    [r.head, r.hv] = spring(r.head, r.hv, -r.lean * 0.6 + nod, 55, 0.38, dt);
    [r.tail, r.tlv] = spring(r.tail, r.tlv, -r.face * r.spd * 1.1 + Math.sin(t * 3 + seed) * 0.12, 40, 0.3, dt);

    // arm targets: angle th from hanging straight down (positive = forward), elbow bend be
    for (let n = 0; n < 2; n++) {
      const side = n === 0 ? -1 : 1; // 0 = back arm, 1 = front arm
      const legPh = ph + (side > 0 ? 0 : Math.PI);
      let th = lerp(0.14 + Math.sin(t * 1.6 + seed + side) * 0.08, -Math.sin(legPh) * 0.95, r.spd);
      let be = lerp(0.32 + Math.sin(t * 1.6 + seed) * 0.06, 1.2, r.spd);
      if (o.scared) {
        if (moving) { th = 2.5 + Math.sin(t * 16 + side * 2) * 0.35; be = 0.5; }
        else { th = 2.05 + Math.sin(t * 9 + side) * 0.08; be = 2.0; }
      }
      if (o.happy && !moving && !r.pose) { th = 0.1 + Math.sin(t * 3 + side) * 0.05; be = 0.25; }
      if (r.pose) {
        const p = 1 - r.poseT / r.poseD;
        if (r.pose === "pull") { th = p < 0.35 ? 2.85 - (side < 0 ? 0.25 : 0) : lerp(2.85, 0.45, (p - 0.35) / 0.65); be = 0.15; }
        else if (r.pose === "cheer") { th = 2.9 + Math.sin(t * 14 + side * 1.5) * 0.25; be = 0.35; }
        else if (r.pose === "shove") { th = 1.5; be = p < 0.45 ? 0.05 : 0.9; }
        else if (r.pose === "wave") { th = side > 0 ? 2.6 : 0.15; be = side > 0 ? 0.6 + Math.sin(t * 16) * 0.5 : 0.3; }
      }
      [r.th[n], r.tv[n]] = spring(r.th[n], r.tv[n], th, 180, 0.42, dt);
      [r.be[n], r.bv[n]] = spring(r.be[n], r.bv[n], be, 160, 0.5, dt);
    }
    return r;
  }

  // ------------------------------------------------------------------ helpers
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // a limb segment as a coloured sleeve with an ink outline, or a plain ink stick
  function limb(ctx, pts, col, w = 5.4) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    if (col) {
      ctx.lineWidth = w + 3.2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    } else { ctx.lineWidth = 3.2; ctx.strokeStyle = INK; ctx.stroke(); }
  }
  // two-bone IK: knee/elbow between a and b, bending toward `bend` (+1 / -1 in x)
  function joint(ax, ay, bx, by, l1, l2, bend) {
    let dx = bx - ax, dy = by - ay;
    const d = clamp(Math.hypot(dx, dy), 0.01, l1 + l2 - 0.01);
    const c = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const ang = Math.atan2(dy, dx) - Math.acos(c) * bend;
    return [ax + Math.cos(ang) * l1, ay + Math.sin(ang) * l1];
  }

  // ------------------------------------------------------------------ person
  // o: { t, scared, happy, grey, frozen, thaw, shake, lift, shrink, spin, number }
  function drawPerson(ctx, a, o = {}) {
    const look = a.look || (a.look = makeLook());
    const C = o.grey ? Object.assign({}, look, GREY) : look;
    const t = o.t !== undefined ? o.t : performance.now() / 1000;
    const r = rig(a, t, o);
    const s = look.tall, f = clamp(r.face, -1, 1), fs = f >= 0 ? 1 : -1, af = Math.abs(f);
    const ph = (a.walk || 0) * 9, spd = o.frozen ? 0 : r.spd;
    const breath = Math.sin(t * 2.3 + (a.num || 0)) * (1 - spd);

    ctx.save();
    ctx.translate(a.x, a.y - (o.lift || 0));
    if (o.shrink !== undefined) { ctx.scale(o.shrink, o.shrink); ctx.rotate(o.spin || 0); }
    if (o.shake) ctx.translate(Math.sin(t * 60) * o.shake * 3, 0);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    const bob = spd * Math.abs(Math.sin(ph)) * 3.4 + breath * 0.5 + r.land * 2;
    const hipY = -30 * s + bob;
    const legL = 15 * s;

    // ---- legs (behind everything)
    const feet = [];
    for (const k of [-1, 1]) {
      const legPh = ph + (k > 0 ? 0 : Math.PI);
      const hx = k * fs * lerp(5, 3, af);
      const fx = hx + f * Math.sin(legPh) * 12 * spd + (1 - spd) * k * fs * lerp(2, 0.5, af);
      const fy = -Math.max(0, Math.cos(legPh)) * 7 * spd;
      const [kx, ky] = joint(hx, hipY, fx, fy, legL, legL, -fs);
      feet.push({ k, hx, fx, fy, kx, ky });
    }
    for (const L of feet) {
      if (look.shorts) { limb(ctx, [[L.hx, hipY], [L.kx, L.ky]], C.pants, 5.6); limb(ctx, [[L.kx, L.ky], [L.fx, L.fy]]); }
      else limb(ctx, [[L.hx, hipY], [L.kx, L.ky], [L.fx, L.fy]], C.pants, 5.2);
      ctx.beginPath(); ctx.ellipse(L.fx + f * 3, L.fy - 1.5, 5.6, 3.2, 0, 0, TAU);
      ctx.fillStyle = C.shoes; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
    }

    // ---- torso space (pivots at the hips, leans, squashes)
    const bw = 25 * look.build, bh = 28 * s;
    const sq = 1 - 0.045 * spd * Math.cos(ph * 2) + 0.018 * breath - 0.07 * r.land;
    ctx.save();
    ctx.translate(0, hipY + 3);
    ctx.rotate(r.lean);
    ctx.scale(1 + (1 - sq) * 0.6, sq);

    // hips / waistband
    ctx.beginPath(); rr(ctx, -bw / 2 + 1.5, -6, bw - 3, 10, 5);
    ctx.fillStyle = C.pants; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();

    // backpack and hood sit behind the body
    if (look.backpack) {
      ctx.beginPath(); rr(ctx, -f * (bw / 2 + 2) - 8, -bh + 4, 16, bh - 6, 6);
      ctx.fillStyle = C.packCol; ctx.fill(); ctx.lineWidth = 2.8; ctx.strokeStyle = INK; ctx.stroke();
      ctx.beginPath(); rr(ctx, -f * (bw / 2 + 5) - 5, -bh * 0.45, 10, 9, 3); ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fill(); ctx.stroke();
    }

    // shoulders and arm angles
    const shY = -bh + 7;
    const arms = [0, 1].map((n) => {
      const side = n === 0 ? -1 : 1;
      const sx = side * fs * lerp(bw / 2 - 2.5, 4.5, af);
      const th = r.th[n], be = r.be[n];
      // raised arms open out into a V so they read around the big head instead of hiding behind it
      const up = Math.max(0, -Math.cos(th)), up2 = Math.max(0, -Math.cos(th + be));
      const splay = side * fs * (0.22 * (1 - af * 0.6) + 0.95 * up);
      const ex = sx + 10.5 * s * (f * Math.sin(th) * (1 - up * 0.7) + splay), ey = shY + 10.5 * s * Math.cos(th);
      const hx = ex + 11 * s * (f * Math.sin(th + be) * (1 - up2 * 0.7) + splay * 0.7 + side * fs * 0.5 * up2), hy = ey + 11 * s * Math.cos(th + be);
      return { sx, ex, ey, hx, hy };
    });
    const longSleeve = C.style === "hoodie" || C.style === "jacket";
    const sleeveCol = C.style === "raglan" ? C.accent : C.shirt;
    const drawArm = (A) => {
      if (longSleeve) limb(ctx, [[A.sx, shY], [A.ex, A.ey], [A.hx, A.hy]], sleeveCol, 5);
      else { limb(ctx, [[A.sx, shY], [A.ex, A.ey]], sleeveCol, 5.4); limb(ctx, [[A.ex, A.ey], [A.hx, A.hy]]); }
      ctx.beginPath(); ctx.arc(A.hx, A.hy, 3.1, 0, TAU); ctx.fillStyle = "#f8f5ef"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    };
    drawArm(arms[0]);

    // body
    ctx.beginPath(); rr(ctx, -bw / 2, -bh, bw, bh + 2, 11);
    ctx.fillStyle = C.shirt; ctx.fill();
    ctx.save(); ctx.clip();
    const backX = -f * (bw / 2 - 3.5);
    if (C.style === "stripes") { ctx.fillStyle = C.accent; for (let y = -bh + 6; y < 2; y += 7.5) ctx.fillRect(-bw / 2, y, bw, 3.2); }
    if (C.style === "raglan") { ctx.fillStyle = C.accent; ctx.fillRect(-bw / 2, -bh, bw, 8); }
    if (C.style === "jacket") { ctx.fillStyle = C.accent; ctx.fillRect(f * 3 - 4.5, -bh, 9, bh + 4); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(f * 3 - 4.5, -bh); ctx.lineTo(f * 3 - 4.5, 4); ctx.moveTo(f * 3 + 4.5, -bh); ctx.lineTo(f * 3 + 4.5, 4); ctx.stroke(); }
    if (C.style === "overalls") {
      ctx.fillStyle = C.pants; ctx.fillRect(-bw / 2 + 4 + f * 2, -bh * 0.48, bw - 8, bh);
      ctx.strokeStyle = C.pants; ctx.lineWidth = 3.4; ctx.beginPath();
      ctx.moveTo(-bw / 2 + 6 + f * 2, -bh * 0.45); ctx.lineTo(-bw / 2 + 5, -bh); ctx.moveTo(bw / 2 - 6 + f * 2, -bh * 0.45); ctx.lineTo(bw / 2 - 5, -bh); ctx.stroke();
      ctx.fillStyle = "#ffd23f"; for (const k of [-1, 1]) { ctx.beginPath(); ctx.arc(k * (bw / 2 - 7) + f * 2, -bh * 0.44, 1.8, 0, TAU); ctx.fill(); }
    }
    if (C.style === "hoodie") {
      ctx.fillStyle = C.shade; ctx.beginPath(); rr(ctx, -8 + f * 3, -bh * 0.38, 16, 9, 4); ctx.fill();
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(f * 3 - 3, -bh + 2); ctx.lineTo(f * 3 - 3, -bh + 10); ctx.moveTo(f * 3 + 3, -bh + 2); ctx.lineTo(f * 3 + 3, -bh + 10); ctx.stroke();
    }
    // shading on the back side
    ctx.fillStyle = "rgba(0,0,0,0.16)"; ctx.fillRect(backX - 3.5 * af - 1, -bh, 7 * af + 2, bh + 4);
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    if (o.number !== undefined && o.number !== null) {
      ctx.font = `bold ${11.5 * s}px 'Fredoka', sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeText(o.number, f * 1.5, -bh * 0.38);
      ctx.fillStyle = "#ffffff"; ctx.fillText(o.number, f * 1.5, -bh * 0.38);
    }

    // neckwear
    if (look.neck === "bowtie") {
      ctx.beginPath(); const bx = f * 3, by = -bh + 3;
      ctx.moveTo(bx, by); ctx.lineTo(bx - 6, by - 4); ctx.lineTo(bx - 6, by + 4); ctx.closePath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + 6, by - 4); ctx.lineTo(bx + 6, by + 4); ctx.closePath();
      ctx.fillStyle = C.neckCol; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    }

    // ---- head (counter-rotates against the lean and lags behind it)
    ctx.save();
    ctx.translate(0, -bh + 1);
    ctx.rotate(r.head);
    const hy = -13 * s - 1, hrx = 15 * s, hry = 17 * s;
    if (C.style === "hoodie") {
      ctx.beginPath(); ctx.ellipse(-f * 7, hy + 4, hrx * 0.95, hry * 0.9, 0, 0, TAU);
      ctx.fillStyle = C.shade; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    }
    if (look.neck === "scarf") {
      // the loose end trails behind and swings
      ctx.save(); ctx.translate(-f * 6, 2); ctx.rotate(r.tail * 0.9);
      ctx.beginPath(); rr(ctx, -3.5, 0, 7, 18, 3); ctx.fillStyle = C.neckCol; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
      ctx.beginPath(); rr(ctx, -bw / 2 + 2, -3, bw - 4, 7, 3.5); ctx.fillStyle = C.neckCol; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = INK; ctx.stroke();
    }
    if (look.hair === "long") {
      ctx.beginPath(); ctx.ellipse(-f * 4, hy + 4, hrx + 2, hry + 2, 0, 0, TAU);
      ctx.fillStyle = look.hairCol; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(0, hy, hrx, hry, 0, 0, TAU);
    ctx.fillStyle = "#f8f5ef"; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = "#e0dbd2";
    ctx.beginPath(); ctx.ellipse(-f * 5, hy + 3, hrx, hry, 0, 0, TAU); ctx.rect(-40, hy - 40, 80, 80); ctx.fill("evenodd");
    if (look.blush) { ctx.fillStyle = "rgba(255,120,150,0.4)"; for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(f * 3.5 + k * 8, hy + 6, 3.4, 2.2, 0, 0, TAU); ctx.fill(); } }
    if (look.freckles) { ctx.fillStyle = "#c98b5a"; for (const [x, y] of [[-8, 5], [-6, 7], [-10, 7], [6, 5], [8, 7], [10, 5]]) { ctx.beginPath(); ctx.arc(f * 3.5 + x, hy + y, 0.9, 0, TAU); ctx.fill(); } }
    ctx.restore();
    drawHair(ctx, look, f, hy, hrx, hry);
    ctx.beginPath(); ctx.ellipse(0, hy, hrx, hry, 0, 0, TAU);
    ctx.lineWidth = 3.2; ctx.strokeStyle = INK; ctx.stroke();
    drawHat(ctx, C, look, f, hy, hrx, hry, t);
    drawFace(ctx, look, f, hy, r, o);
    ctx.restore(); // head

    drawArm(arms[1]);
    if (look.backpack) {
      ctx.beginPath(); ctx.moveTo(-f * (bw / 2 - 4), shY - 3); ctx.quadraticCurveTo(f * 2, -bh * 0.45, -f * (bw / 2 - 5), -4);
      ctx.lineWidth = 2.6; ctx.strokeStyle = INK; ctx.stroke();
    }
    ctx.restore(); // torso

    if (o.frozen) {
      const top = hipY - bh - 42 * s, hgt = -top + 8;
      ctx.beginPath(); rr(ctx, -30, top, 60, hgt, 12);
      ctx.fillStyle = `rgba(160,220,255,${0.55 - (o.thaw || 0) * 0.3})`; ctx.fill();
      ctx.lineWidth = 3.2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-20, top + 12); ctx.lineTo(-20, top + 34); ctx.moveTo(-12, top + 10); ctx.lineTo(-12, top + 18); ctx.stroke();
      if ((o.thaw || 0) > 0.2) { ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(8, top + 6); ctx.lineTo(2, top + 30); ctx.lineTo(12, top + 44); ctx.lineTo(6, top + 70); ctx.stroke(); }
    }
    ctx.restore();
  }

  function drawFace(ctx, look, f, hy, r, o) {
    const fx = f * 3.5, ey = hy + 1;
    ctx.fillStyle = INK; ctx.strokeStyle = INK;
    const blink = r.blink > 0 && !o.scared && !o.frozen;
    if (o.scared) {
      for (const k of [-1, 1]) { ctx.beginPath(); ctx.arc(fx + k * 5.5, ey, 3.4, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.6; ctx.stroke(); ctx.beginPath(); ctx.arc(fx + k * 5.5 + f * 0.8, ey, 1.4, 0, TAU); ctx.fillStyle = INK; ctx.fill(); }
      ctx.beginPath(); rr(ctx, fx - 6, ey + 6, 12, 6, 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx - 6, ey + 9); ctx.lineTo(fx + 6, ey + 9); for (const x of [-2, 2]) { ctx.moveTo(fx + x, ey + 6); ctx.lineTo(fx + x, ey + 12); } ctx.stroke();
    } else {
      for (const k of [-1, 1]) {
        ctx.beginPath();
        if (blink) { ctx.moveTo(fx + k * 5 - 2.2, ey); ctx.lineTo(fx + k * 5 + 2.2, ey); ctx.lineWidth = 1.7; ctx.stroke(); }
        else { ctx.ellipse(fx + k * 5, ey, 1.9, 2.6, 0, 0, TAU); ctx.fill(); }
      }
      ctx.lineWidth = 1.7; ctx.beginPath();
      if (o.happy) ctx.arc(fx, ey + 6, 4, 0.15 * Math.PI, 0.85 * Math.PI);
      else ctx.arc(fx, ey + 9, 3, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    }
    ctx.lineWidth = 1.7;
    for (const k of [-1, 1]) { ctx.beginPath(); const tilt = o.scared ? -k * 1.5 : 0.5; ctx.moveTo(fx + k * 3, ey - 6 + tilt); ctx.lineTo(fx + k * 8, ey - 6 - tilt); ctx.stroke(); }
    if (look.mustache) {
      ctx.beginPath(); ctx.moveTo(fx, ey + 5.5);
      ctx.quadraticCurveTo(fx - 4, ey + 3, fx - 7, ey + 7); ctx.quadraticCurveTo(fx - 3, ey + 6.5, fx, ey + 5.5);
      ctx.quadraticCurveTo(fx + 4, ey + 3, fx + 7, ey + 7); ctx.quadraticCurveTo(fx + 3, ey + 6.5, fx, ey + 5.5);
      ctx.fillStyle = look.hairCol === "#9c9a99" ? "#6b6680" : look.hairCol; ctx.fill(); ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (look.bandaid) {
      ctx.save(); ctx.translate(fx - f * 9 + 2, ey + 6); ctx.rotate(-0.5);
      ctx.beginPath(); rr(ctx, -4.5, -2, 9, 4, 1.5); ctx.fillStyle = "#f2c38b"; ctx.fill(); ctx.lineWidth = 1.1; ctx.stroke();
      ctx.restore();
    }
    if (look.glasses === "round") {
      ctx.lineWidth = 1.5;
      for (const k of [-1, 1]) { ctx.beginPath(); ctx.arc(fx + k * 5.5, ey, 4.4, 0, TAU); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(fx - 1.1, ey); ctx.lineTo(fx + 1.1, ey); ctx.stroke();
    } else if (look.glasses === "shades") {
      ctx.fillStyle = INK;
      for (const k of [-1, 1]) { ctx.beginPath(); rr(ctx, fx + k * 5.5 - 4.5, ey - 3, 9, 6, 2.5); ctx.fill(); }
      ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(fx - 1.5, ey - 1); ctx.lineTo(fx + 1.5, ey - 1); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.1;
      for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(fx + k * 5.5 - 2.5, ey - 1.5); ctx.lineTo(fx + k * 5.5 - 0.5, ey - 1.5); ctx.stroke(); }
    }
  }

  function drawHair(ctx, look, f, hy, rx, ry) {
    const h = look.hair;
    if (h === "none") return;
    ctx.fillStyle = look.hairCol;
    ctx.beginPath();
    const top = hy - ry;
    if (h === "cap" || h === "bowl") {
      ctx.ellipse(0, hy - 4, rx + 1, ry - 3, 0, Math.PI, 0);
      if (h === "bowl") ctx.lineTo(rx + 1, hy + 1), ctx.lineTo(-rx - 1, hy + 1);
      if (h === "cap") { ctx.moveTo(f * 2, hy - 5); ctx.lineTo(f * (rx + 9), hy - 3); ctx.lineTo(f * (rx + 7), hy - 7); ctx.lineTo(f * 2, hy - 9); }
    } else if (h === "side" || h === "long") {
      ctx.ellipse(0, hy - 5, rx + 1, ry - 5, 0, Math.PI * 1.02, Math.PI * 1.98);
      ctx.quadraticCurveTo(f * 4, top + 10, -f * rx, hy - 2);
    } else if (h === "spiky") {
      ctx.moveTo(-rx, hy - 5);
      for (let i = 0; i <= 6; i++) { const x = -rx + (i / 6) * rx * 2; ctx.lineTo(x, i % 2 ? top - 6 : top + 4); }
      ctx.lineTo(rx, hy - 5);
    } else if (h === "bun") {
      ctx.ellipse(0, hy - 5, rx + 1, ry - 5, 0, Math.PI, 0);
      ctx.moveTo(-f * 3 + 8, top - 2); ctx.arc(-f * 3, top - 2, 8, 0, TAU);
    } else if (h === "curly") {
      for (let i = 0; i < 7; i++) { const ang = Math.PI + (i / 6) * Math.PI; ctx.moveTo(Math.cos(ang) * rx + 6, hy - 4 + Math.sin(ang) * (ry - 2)); ctx.arc(Math.cos(ang) * rx, hy - 4 + Math.sin(ang) * (ry - 2), 6, 0, TAU); }
    } else if (h === "mohawk") {
      ctx.moveTo(-f * 8, top + 5);
      for (let i = 0; i <= 4; i++) { const x = -f * 8 + f * i * 4; ctx.lineTo(x - f * 2, top - 7 - (i % 2) * 3); ctx.lineTo(x, top + 3); }
      ctx.lineTo(f * 8, top + 6); ctx.closePath();
    }
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  }

  function drawHat(ctx, C, look, f, hy, rx, ry, t) {
    const top = hy - ry;
    ctx.lineWidth = 2.6; ctx.strokeStyle = INK; ctx.fillStyle = C.hatCol;
    if (look.hat === "beanie") {
      ctx.beginPath(); ctx.ellipse(0, hy - 5, rx + 1.5, ry - 2, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); rr(ctx, -rx - 2, hy - 8, rx * 2 + 4, 6, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(-f * 2, top - 3, 4.5, 0, TAU); ctx.fillStyle = "#fbf6ec"; ctx.fill(); ctx.stroke();
    } else if (look.hat === "headband") {
      ctx.beginPath(); ctx.ellipse(0, hy - 4, rx + 0.5, ry - 6, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineWidth = 7; ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = C.hatCol; ctx.stroke();
    } else if (look.hat === "headphones") {
      ctx.beginPath(); ctx.ellipse(-f * 3, hy - 2, rx + 2, ry + 1, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.lineWidth = 6; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = C.hatCol; ctx.stroke();
      ctx.beginPath(); rr(ctx, -f * 7 - 4.5, hy - 5, 9, 12, 4); ctx.fillStyle = C.hatCol; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = INK; ctx.stroke();
    } else if (look.hat === "bow") {
      const bx = -f * 8, by = top + 3;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 7, by - 5); ctx.lineTo(bx - 6, by + 5); ctx.closePath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + 7, by - 5); ctx.lineTo(bx + 6, by + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx, by, 2.3, 0, TAU); ctx.fill(); ctx.stroke();
    } else if (look.hat === "flower") {
      const bx = -f * 9, by = top + 6;
      for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + t * 0.0; ctx.beginPath(); ctx.arc(bx + Math.cos(a) * 3.6, by + Math.sin(a) * 3.6, 2.8, 0, TAU); ctx.fill(); ctx.lineWidth = 1.4; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, TAU); ctx.fillStyle = "#ffd23f"; ctx.fill(); ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ circuit hardware
  const LIGHT_ON = "#48e28a", LIGHT_OFF = "#3a3450", LIGHT_READY = "#ffd23f";
  // "someone is ready here": the light blinks yellow (about 2.5 blinks a second)
  const readyBlink = () => Math.sin(performance.now() / 1000 * TAU * 2.5) > -0.2;
  // wall panel: one light per station in the circuit, plus a lever if this is a lever station.
  // p: { n, lit: [bool], mine: index of this station, ready: [bool], color, lever: 0..1 | null, flash: 0..1 }
  // On lever panels the lever has its own slot at the right end, so it never covers a light.
  const hasLever = (p) => p.lever !== null && p.lever !== undefined;
  function panelSize(n, lever) { return { w: Math.max(46, 16 + n * 17) + (lever ? 26 : 0), h: lever ? 44 : 26 }; }
  function lightPos(q, n, lever, h) { return [-(n - 1) * 8.5 + q * 17 - (lever ? 13 : 0), lever ? -1 : -h / 2 + 14]; }
  function drawPanel(ctx, x, y, p) {
    const lever = hasLever(p), { w, h } = panelSize(p.n, lever);
    ctx.save(); ctx.translate(x, y);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath(); rr(ctx, -w / 2, -h / 2, w, h, 7);
    ctx.fillStyle = "#2b2540"; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = p.color; ctx.fillRect(-w / 2, -h / 2, w, 5); ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    for (let q = 0; q < p.n; q++) {
      const [lx, ly] = lightPos(q, p.n, lever, h);
      const on = p.flash > 0 ? (Math.floor(p.flash * 10) % 2 === 0) : p.lit[q];
      ctx.beginPath(); ctx.arc(lx, ly, 5.6, 0, TAU);
      const ready = !on && p.ready && p.ready[q], blink = ready && readyBlink();
      ctx.fillStyle = on ? (p.flash > 0 ? "#eafff1" : LIGHT_ON) : blink ? LIGHT_READY : LIGHT_OFF; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      if (on || blink) { ctx.beginPath(); ctx.arc(lx - 1.8, ly - 1.8, 1.6, 0, TAU); ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fill(); }
      if (q === p.mine) { ctx.beginPath(); ctx.moveTo(lx - 3.5, ly + 9.5); ctx.lineTo(lx + 3.5, ly + 9.5); ctx.lineTo(lx, ly + 6.5); ctx.closePath(); ctx.fillStyle = "#fbf6ec"; ctx.fill(); }
    }
    if (lever) {
      // a divider, then the lever in its own slot: up is "0"; it creeps back up as the pull runs out
      const lx = w / 2 - 13;
      ctx.beginPath(); ctx.moveTo(lx - 12, -h / 2 + 8); ctx.lineTo(lx - 12, h / 2 - 5); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.stroke();
      ctx.beginPath(); rr(ctx, lx - 4, -h / 2 + 7, 8, h - 13, 4); ctx.fillStyle = "#14111f"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      // seen from the front, the handle swings from pointing up (0) to pointing down (pulled);
      // the knob grows a little as it swings toward the viewer through the middle
      const k = clamp(p.lever, 0, 1), ang = lerp(0, Math.PI, k);
      const py = 1, hy2 = py - Math.cos(ang) * 13;
      const knob = 5.5 + Math.sin(ang) * 2;
      ctx.beginPath(); ctx.moveTo(lx, py); ctx.lineTo(lx, hy2);
      ctx.lineWidth = 6.5; ctx.strokeStyle = INK; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = "#cfc8bb"; ctx.stroke();
      ctx.beginPath(); ctx.arc(lx, hy2, knob, 0, TAU); ctx.fillStyle = "#ff4b5c"; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = INK; ctx.stroke();
      ctx.beginPath(); ctx.arc(lx - 1.8, hy2 - 2, 1.8, 0, TAU); ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill();
    }
    ctx.restore();
  }
  // additive glow for lit lights (drawn after the darkness so they read in the dark)
  function drawPanelGlow(ctx, x, y, p) {
    const lever = hasLever(p), { h } = panelSize(p.n, lever);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let q = 0; q < p.n; q++) {
      const on = p.flash > 0 || p.lit[q];
      const blink = !on && p.ready && p.ready[q] && readyBlink();
      const [ox, oy] = lightPos(q, p.n, lever, h), lx = x + ox, ly = y + oy;
      const rad = on ? 26 : blink ? 22 : 10;
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
      g.addColorStop(0, on ? "rgba(120,255,170,0.85)" : blink ? "rgba(255,210,63,0.8)" : "rgba(150,140,190,0.25)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(lx - rad, ly - rad, rad * 2, rad * 2);
      ctx.beginPath(); ctx.arc(lx, ly, 4.2, 0, TAU); ctx.fillStyle = on ? "#b8ffd0" : blink ? "#fff1b0" : "#3a3450"; ctx.fill();
    }
    ctx.restore();
  }
  // floor plate: press 0..1 (how far it is pushed in), live (lit), color
  function drawPlate(ctx, x, y, p) {
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.ellipse(0, 4, 40, 27, 0, 0, TAU); ctx.fillStyle = "#2b2540"; ctx.fill();
    ctx.lineWidth = 3.2; ctx.strokeStyle = INK; ctx.stroke();
    const lift = p.open ? 1 : lerp(7, 2, p.press);
    ctx.beginPath(); ctx.ellipse(0, 4, 32, 21, 0, 0, Math.PI); ctx.ellipse(0, 4 - lift, 32, 21, 0, Math.PI, 0, true); ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 4 - lift, 32, 21, 0, 0, TAU);
    ctx.fillStyle = p.open ? "#9c96ad" : p.live ? LIGHT_ON : p.ready && readyBlink() ? LIGHT_READY : p.color; ctx.fill();
    ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-7, -1 - lift, 14, 6, -0.2, 0, TAU); ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill();
    ctx.restore();
  }

  window.Art = { INK, makeLook, drawPerson, pose, drawPanel, drawPanelGlow, drawPlate, panelSize, rr, LIGHT_ON };
})();
