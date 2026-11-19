// Comic-style UI pieces shared by both stages: how-to-play cards with tiny animated scenes,
// team cards that show each member's actual look, and the in-game tip card.
// Scenes reuse the character rig from art.js, so the cards always match the game.
(function () {
  const INK = Art.INK;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const img = (k) => (typeof IMG !== "undefined" && IMG[k]) || null;
  const actor = (num, x, y, face = 1) => ({ num, x, y, face, walk: Math.random() * 3, moving: false, look: Art.makeLook() });
  const pad = (n) => String(n).padStart(2, "0");

  // ---------------------------------------------------------------- scene helpers
  function floor(ctx, w, h, col = "#2a2350", line = 0.72) {
    ctx.fillStyle = "#16122e"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = col; ctx.fillRect(0, h * line, w, h);
  }
  function wall(ctx, w, y, col = "#5a4a8a", top = "#7a68b0") {
    ctx.fillStyle = col; ctx.fillRect(0, y - 34, w, 34);
    ctx.fillStyle = top; ctx.fillRect(0, y - 52, w, 18);
    ctx.lineWidth = 3; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(0, y - 52); ctx.lineTo(w, y - 52); ctx.moveTo(0, y - 34); ctx.lineTo(w, y - 34); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  function shadowBlob(ctx, x, y) { ctx.fillStyle = "rgba(10,5,25,0.35)"; ctx.beginPath(); ctx.ellipse(x, y, 15, 5, 0, 0, TAU); ctx.fill(); }
  function person(ctx, a, t, o = {}) { shadowBlob(ctx, a.x, a.y); Art.drawPerson(ctx, a, Object.assign({ t, number: pad(a.num) }, o)); }
  function burst(ctx, x, y, text, col = "#ffd23f", size = 26, rot = -0.12) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.font = `${size}px 'Luckiest Guy', sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = size * 0.32; ctx.strokeStyle = INK;
    ctx.fillStyle = "#ff4b5c"; ctx.strokeText(text, 3, 3); ctx.fillText(text, 3, 3);
    ctx.strokeText(text, 0, 0); ctx.fillStyle = col; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function walkTo(a, tx, dt, speed = 70) {
    const d = tx - a.x;
    if (Math.abs(d) < 2) { a.moving = false; return true; }
    a.face = Math.sign(d); a.moving = true; a.walk += dt; a.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    return false;
  }

  // ---------------------------------------------------------------- scenes
  // every scene: { init(w, h) -> state, draw(ctx, st, t, dt, w, h) }
  const SCENES = {
    // lobby 1: keep moving while the music plays
    mingle: {
      init: (w, h) => ({ a: [0, 1, 2, 3].map((k) => Object.assign(actor(3 + k * 7, k * 80, h - 22, 1))) }),
      draw(ctx, st, t, dt, w, h) {
        floor(ctx, w, h, "#2c2456", 0.55);
        ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 2;
        for (let x = -40 + ((t * 40) % 40); x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, h * 0.55); ctx.lineTo(x - 30, h); ctx.stroke(); }
        st.a.forEach((a, k) => {
          a.x = ((t * 52 + k * (w + 80) / 4) % (w + 80)) - 40; a.y = h - 20 - (k % 2) * 16;
          a.face = 1; a.moving = true; a.walk += dt;
        });
        [...st.a].sort((p, q) => p.y - q.y).forEach((a) => person(ctx, a, t, { happy: true }));
        for (let k = 0; k < 4; k++) {
          const p = ((t * 0.5 + k / 4) % 1), x = 30 + k * (w - 60) / 3 + Math.sin(t * 3 + k) * 8, y = h * 0.5 - p * h * 0.4;
          ctx.globalAlpha = Math.sin(p * Math.PI);
          ctx.font = "22px 'Luckiest Guy', sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 5; ctx.strokeStyle = INK;
          ctx.strokeText(k % 2 ? "♫" : "♪", x, y); ctx.fillStyle = "#ffd23f"; ctx.fillText(k % 2 ? "♫" : "♪", x, y);
        }
        ctx.globalAlpha = 1;
      },
    },
    // lobby 2: walk into a cell to join that team
    number: {
      init: (w, h) => ({ a: [actor(4, w * 0.62, h - 18, -1), actor(11, w * 0.74, h - 30, -1), actor(19, w * 0.86, h - 16, -1), actor(23, w * 0.2, h - 18, 1)] }),
      draw(ctx, st, t, dt, w, h) {
        floor(ctx, w, h, "#3a2f66", 0.42);
        // the cell: a coloured box with an open door on its left side
        ctx.fillStyle = "#ffb000"; ctx.fillRect(w * 0.52, h * 0.3, w * 0.46, h * 0.12);
        ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeRect(w * 0.52, h * 0.3, w * 0.46, h * 0.12);
        const loop = t % 4;
        const late = st.a[3];
        late.x = lerp(w * 0.12, w * 0.5, ease(clamp(loop / 2.2, 0, 1)));
        late.moving = loop < 2.2; late.face = 1; if (late.moving) late.walk += dt;
        const inside = loop > 2.2;
        st.a.slice(0, 3).forEach((a) => person(ctx, a, t, { happy: true }));
        person(ctx, late, t, { happy: inside });
        burst(ctx, w * 0.75, h * 0.2, inside ? "4/4" : "3/4", inside ? "#48e28a" : "#fbf6ec", 34, -0.1 + Math.sin(t * 4) * 0.03);
      },
    },
    // lobby 3: go AFK and the Watcher drags you into a cell
    locked: {
      init: (w, h) => ({ a: actor(15, w * 0.3, h - 20, 1) }),
      draw(ctx, st, t, dt, w, h) {
        floor(ctx, w, h, "#1d1838", 0.5);
        const a = st.a, loop = t % 4;
        // the Watcher swoops in from the right, grabs them, and flies off with them
        const grab = 1.6;
        const wx = loop < grab ? lerp(w + 80, w * 0.3 + 30, ease(loop / grab)) : lerp(w * 0.3 + 30, w + 120, ease(clamp((loop - grab - 0.3) / 1.6, 0, 1)));
        const held = loop >= grab;
        a.x = held ? wx - 30 : w * 0.3; a.face = 1; a.moving = false;
        const im = img("watcher_chase") || img("watcher") || img("shadow_hunt");
        const by = h - 6 + Math.sin(t * 3) * 3;
        if (im) { const s = 64 / im.height * 1.5; ctx.drawImage(im, wx - im.width * s / 2, by - im.height * s, im.width * s, im.height * s); }
        else { ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(wx, h - 50, 30, 46, 0, 0, TAU); ctx.fill(); }
        person(ctx, a, t, held ? { scared: true, lift: 26, shake: 0.6 } : {});
        if (!held) {
          ctx.font = "18px 'Luckiest Guy', sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = INK;
          const zy = h - 96 - (t * 20 % 20);
          ctx.strokeText("z z", a.x + 22, zy); ctx.fillStyle = "#fbf6ec"; ctx.fillText("z z", a.x + 22, zy);
        }
        burst(ctx, w * 0.24, h * 0.24, held ? "GOTCHA" : "0:20", held ? "#ff4b5c" : "#fbf6ec", 26, -0.15);
      },
    },
    // maze 1: find your lever and pull it
    lever: {
      init: (w, h) => ({ a: actor(7, 20, h - 14, 1), power: 0 }),
      draw(ctx, st, t, dt, w, h) {
        floor(ctx, w, h, "#3d3466", 0.62);
        wall(ctx, w, h * 0.62);
        const loop = t % 5, a = st.a, px = w * 0.62;
        if (loop < 0.05) { a.x = 20; st.power = 0; }
        if (loop < 1.8) walkTo(a, px - 34, dt, 85);
        else { a.moving = false; a.face = 1; }
        if (loop > 1.8 && st.power <= 0 && !st.done) { st.power = 1; st.done = true; Art.pose(a, "pull", 0.45); }
        if (loop < 1) st.done = false;
        st.power = Math.max(0, st.power - dt / 3);
        Art.drawPanel(ctx, px, h * 0.62 - 26, { n: 2, lit: [st.power > 0, false], mine: 0, color: "#ffd23f", lever: st.power, flash: 0 });
        person(ctx, a, t, { happy: st.power > 0 });
        if (st.power <= 0 && loop < 1.8) {
          const y = h * 0.62 - 70 + Math.sin(t * 5) * 4;
          ctx.beginPath(); ctx.moveTo(px - 9, y - 10); ctx.lineTo(px + 9, y - 10); ctx.lineTo(px, y + 2); ctx.closePath();
          ctx.fillStyle = "#ffd23f"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
        }
      },
    },
    // maze 2: every light green at once opens the gate
    together: {
      init: (w, h) => ({ a: [actor(3, w * 0.22, h - 14, 1), actor(12, w * 0.62, h - 14, 1)], p: [0, 0], spark: 0 }),
      draw(ctx, st, t, dt, w, h) {
        floor(ctx, w, h, "#3d3466", 0.62);
        wall(ctx, w, h * 0.62);
        const loop = t % 5;
        if (loop < 0.05) { st.p = [0, 0]; st.spark = 0; st.fired = [false, false]; }
        st.fired = st.fired || [false, false];
        [0.8, 1.15].forEach((at, k) => {
          if (loop > at && !st.fired[k]) { st.fired[k] = true; st.p[k] = 1; Art.pose(st.a[k], "pull", 0.45); }
        });
        if (st.p[0] > 0 && st.p[1] > 0 && !st.spark) st.spark = 0.001;
        if (st.spark) st.spark = Math.min(1.6, st.spark + dt);
        else st.p = st.p.map((v) => Math.max(0, v - dt / 3));
        const lit = st.p.map((v) => v > 0 || st.spark > 0);
        const xs = [w * 0.22, w * 0.62];
        xs.forEach((x, k) => Art.drawPanel(ctx, x, h * 0.62 - 26, { n: 2, lit, mine: k, color: "#3fa7ff", lever: st.spark ? 1 : st.p[k], flash: st.spark > 0 && st.spark < 0.8 ? st.spark : 0 }));
        // the gate on the right sinks once the circuit closes
        const gk = clamp((st.spark - 0.8) / 0.5, 0, 1), gx = w - 26;
        ctx.save(); ctx.beginPath(); ctx.rect(gx, h * 0.62 - 52, 22, h); ctx.clip();
        ctx.fillStyle = "#3fa7ff"; ctx.fillRect(gx, h * 0.62 - 52 + gk * 60, 22, h);
        ctx.fillStyle = INK; for (let y = h * 0.62 - 60 + gk * 60; y < h; y += 22) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + 22, y + 11); ctx.lineTo(gx + 22, y + 19); ctx.lineTo(gx, y + 8); ctx.fill(); }
        ctx.restore();
        st.a.forEach((a) => { a.face = 1; person(ctx, a, t, { happy: st.spark > 0 }); });
        if (st.spark > 0.8) burst(ctx, w * 0.5, h * 0.25, "OPEN!", "#48e28a", 30);
      },
    },
    // maze plate tip
    plate: {
      init: (w, h) => ({ a: actor(9, 30, h - 10, 1), power: 0, armed: true }),
      draw(ctx, st, t, dt, w, h) {
        floor(ctx, w, h, "#3d3466", 0.5);
        wall(ctx, w, h * 0.5);
        const loop = t % 5, a = st.a, px = w * 0.55, py = h * 0.5 + 42;
        a.y = h - 12 - clamp((a.x - 60) / (px - 60), 0, 1) * (h - 12 - py - 6);
        if (loop < 0.05) { a.x = 30; }
        if (loop < 2) walkTo(a, px, dt, 75);
        else if (loop > 2.8) walkTo(a, w + 40, dt, 75);
        const on = Math.abs(a.x - px) < 18;
        if (on && st.armed) { st.power = 1; st.armed = false; }
        if (!on) st.armed = true;
        st.power = Math.max(0, st.power - dt / 3);
        Art.drawPanel(ctx, px, h * 0.5 - 16, { n: 2, lit: [st.power > 0, false], mine: 0, color: "#ff6f86", lever: null, flash: 0 });
        Art.drawPlate(ctx, px, py, { color: "#ff6f86", press: on ? 1 : 0, live: st.power > 0 });
        person(ctx, a, t, { happy: st.power > 0 });
      },
    },
    // maze 3: the shadow freezes you, teammates thaw you
    shadow: {
      init: (w, h) => ({ f: actor(5, w * 0.45, h - 16, 1), m: actor(14, w * 0.8, h - 16, -1), thaw: 0 }),
      draw(ctx, st, t, dt, w, h) {
        floor(ctx, w, h, "#2a2350", 0.5);
        const loop = t % 5, f = st.f, m = st.m;
        if (loop < 0.05) { m.x = w * 0.85; st.thaw = 0; }
        const im = img("watcher_calm") || img("shadow");
        const sx = w * 0.15 + Math.sin(t * 1.5) * 6;
        if (im) { const s = 112 / im.height; ctx.fillStyle = "rgba(15,8,30,0.6)"; ctx.beginPath(); ctx.ellipse(sx, h - 6, 34, 9, 0, 0, TAU); ctx.fill(); ctx.drawImage(im, sx - im.width * s / 2, h - 2 - im.height * s + Math.sin(t * 2.2) * 3, im.width * s, im.height * s); }
        if (loop > 0.5) walkTo(m, f.x + 34, dt, 70);
        const near = Math.abs(m.x - (f.x + 34)) < 4;
        if (near) st.thaw = Math.min(1, st.thaw + dt / 2);
        if (st.thaw > 0.01) { ctx.beginPath(); ctx.ellipse(f.x, f.y + 2, 34, 13, 0, -Math.PI / 2, -Math.PI / 2 + st.thaw * TAU); ctx.lineWidth = 5; ctx.strokeStyle = "#7fd8ff"; ctx.stroke(); }
        const thawed = st.thaw >= 1;
        if (thawed && !st.cheered) { st.cheered = true; Art.pose(f, "cheer", 1); }
        if (!thawed) st.cheered = false;
        person(ctx, f, t, { frozen: !thawed, thaw: st.thaw, happy: thawed });
        person(ctx, m, t, {});
      },
    },
  };

  // ---------------------------------------------------------------- canvases
  const live = new Set();
  function sceneCanvas(name) {
    const c = document.createElement("canvas");
    c.className = "scene";
    const sc = SCENES[name];
    live.add({ c, sc, st: null, w: 0, h: 0 });
    return c;
  }
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    for (const v of live) {
      if (!v.c.isConnected) { live.delete(v); continue; }
      if (!v.c.offsetParent) continue; // hidden
      const r = v.c.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (!r.width || !r.height) continue;
      if (v.w !== r.width || v.h !== r.height) {
        v.w = r.width; v.h = r.height; v.c.width = Math.round(r.width * dpr); v.c.height = Math.round(r.height * dpr);
        v.st = null;
      }
      const ctx = v.c.getContext("2d");
      const z = v.w / 240; // scenes are authored for a 240-wide card
      ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
      if (!v.st) v.st = v.sc.init(240, v.h / z);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      v.sc.draw(ctx, v.st, t, dt, 240, v.h / z);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // how-to cards: [{ scene, title, text, color }]
  function howto(el, cards) {
    el.innerHTML = "";
    cards.forEach((cd, k) => {
      const card = document.createElement("div");
      card.className = "hcard";
      card.style.setProperty("--rib", cd.color || "#ff4b5c");
      card.style.setProperty("--tilt", `${[-2.2, 1.6, -1.2, 2][k % 4]}deg`);
      card.innerHTML = `<div class="hnum">${k + 1}</div><div class="ribbon">${cd.title}</div>`;
      card.appendChild(sceneCanvas(cd.scene));
      const p = document.createElement("p"); p.innerHTML = cd.text; card.appendChild(p);
      el.appendChild(card);
    });
  }

  // team cards with each member drawn in their own look
  function teamCards(el, teams) {
    el.innerHTML = "";
    teams.forEach((tm, k) => {
      const card = document.createElement("div");
      card.className = "tcard";
      card.style.setProperty("--tc", tm.color);
      card.style.setProperty("--tilt", `${[-2, 1.5, -1, 2, -1.5][k % 5]}deg`);
      // names come from users, so they go in as text, never as HTML
      const rib = document.createElement("div"); rib.className = "ribbon"; rib.textContent = tm.name;
      card.appendChild(rib);
      const c = document.createElement("canvas"); c.className = "crew";
      const n = tm.members.length;
      const actors = tm.members.map((m, q) => ({ num: m.num, x: 0, y: 0, face: q < n / 2 ? 1 : -1, walk: 0, moving: false, look: m.look || Art.makeLook(), me: m.isPlayer }));
      live.add({
        c, sc: { init: () => ({}), draw(ctx, st, t, dt, w, h) {
          actors.forEach((a, q) => {
            const S = 1.3, cx = (w / (n + 1)) * (q + 1), cy = h - 8;
            if (Math.random() < dt * 0.15) Art.pose(a, "wave", 0.9);
            ctx.save(); ctx.translate(cx, cy); ctx.scale(S, S);
            a.x = 0; a.y = 0;
            ctx.fillStyle = "rgba(10,5,25,0.18)"; ctx.beginPath(); ctx.ellipse(0, 0, 14, 4, 0, 0, TAU); ctx.fill();
            Art.drawPerson(ctx, a, { t, happy: true, number: pad(a.num) });
            if (a.me) { const y = -96 + Math.sin(t * 4) * 3; ctx.beginPath(); ctx.moveTo(-9, y - 10); ctx.lineTo(9, y - 10); ctx.lineTo(0, y + 3); ctx.closePath(); ctx.fillStyle = "#ffd23f"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke(); }
            ctx.restore();
          });
        } }, st: null, w: 0, h: 0,
      });
      card.appendChild(c);
      const nums = document.createElement("div"); nums.className = "tnums";
      for (const m of tm.members) {
        const sp = document.createElement("span"); sp.className = `tnum${m.isPlayer ? " me" : ""}`;
        sp.textContent = m.name ? m.name : pad(m.num);
        nums.appendChild(sp);
      }
      card.appendChild(nums);
      el.appendChild(card);
    });
  }

  // in-game tip card (shown once per key): ribbon, scene, one line, dismiss
  const seen = new Set();
  let tipTimer = 0;
  function tip(key, title, text, scene, color = "#ff4b5c") {
    if (seen.has(key)) return;
    seen.add(key);
    let el = document.getElementById("tip");
    if (!el) { el = document.createElement("div"); el.id = "tip"; document.body.appendChild(el); el.addEventListener("click", hideTip); }
    el.className = "show";
    el.style.setProperty("--rib", color);
    el.innerHTML = `<div class="ribbon">${title}</div>`;
    el.appendChild(sceneCanvas(scene));
    const p = document.createElement("p"); p.innerHTML = text; el.appendChild(p);
    const k = document.createElement("div"); k.className = "close"; k.innerHTML = "<kbd>TAB</kbd> got it"; el.appendChild(k);
    clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 7000);
  }
  function hideTip() { const el = document.getElementById("tip"); if (el) el.className = ""; }
  addEventListener("keydown", (e) => { if (e.code === "Tab") { e.preventDefault(); hideTip(); } });

  window.Ui = { howto, teamCards, tip, hideTip };
})();
