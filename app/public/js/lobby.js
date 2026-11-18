"use strict";
/*
  The lobby, in the browser. The server runs it (app/src/lobby.js): it moves everyone, runs the
  timer, the cells and the Watcher, and sends the result about 30 times a second. This file only
  sends your keys and draws what the server says, smoothing positions between updates.
*/

const ASSETS = window.ASSETS || {};
// glowing eye positions on the Watcher sprite (px from the image's bottom-centre)
// the Watcher is a photo: calm while the music plays, red-eyed and smirking during the chase.
// Eye positions are measured on the chase sprite (px from the image's bottom-centre).
window.EYES = [{ x: -52, y: -327 }, { x: 64, y: -325 }];
const WATCHER_S = 0.56;
function watcherImage() {
  const chase = watcher.mode === "drag";
  return IMG[chase ? "watcher_chase" : "watcher_calm"] || IMG.watcher || IMG.shadow;
}

// the song: part one plays while people pick cells, part two (the ticking rush, from SWITCH)
// plays while the Watcher drags in the stragglers.
// Decoded with Web Audio so we can start anywhere in it and know exactly where we are.
const SWITCH = 53.95;
// the clock ticks in the climax (measured from the track); the doors slam on SLAM
const TICKS = [54.79, 56.05, 57.10, 58.10, 59.17, 60.16, 61.20, 62.13, 63.18, 64.18, 65.25, 66.24, 67.29, 68.25, 69.29];
const SLAM = 62.13;
const Song = {
  buf: null, src: null, gain: null, startAt: 0, offset: 0, playing: false,
  async load() {
    try {
      Sfx.init();
      const r = await fetch("/static/assets/audio/mingle.mp3");
      this.buf = await Sfx.a.decodeAudioData(await r.arrayBuffer());
    } catch (e) { this.buf = null; }
  },
  // play from t; with a loop [a, b], keep repeating that stretch
  play(t, loop) {
    const a = Sfx.a; if (!a || !this.buf) return;
    this.stop();
    a.resume();
    this.gain = a.createGain(); this.gain.gain.value = 0.85;
    this.src = a.createBufferSource(); this.src.buffer = this.buf;
    if (loop) { this.src.loop = true; this.src.loopStart = loop[0]; this.src.loopEnd = loop[1]; }
    this.loop = loop || null;
    this.src.connect(this.gain).connect(a.destination);
    this.src.start(0, t);
    this.startAt = a.currentTime; this.offset = t; this.playing = true;
    const me = this.src; me.onended = () => { if (this.src === me) this.playing = false; };
  },
  time() {
    if (!this.playing) return 0;
    let t = Sfx.a.currentTime - this.startAt + this.offset;
    if (this.loop && t > this.loop[1]) t = this.loop[0] + ((t - this.loop[0]) % (this.loop[1] - this.loop[0]));
    return t;
  },
  fade(d) {
    if (!this.src) return;
    const a = Sfx.a, g = this.gain, s = this.src;
    g.gain.setValueAtTime(g.gain.value, a.currentTime);
    g.gain.linearRampToValueAtTime(0, a.currentTime + d);
    setTimeout(() => { try { s.stop(); } catch {} }, d * 1000 + 60);
    this.playing = false; this.src = null;
  },
  stop() { if (this.src) { try { this.src.stop(); } catch {} } this.src = null; this.playing = false; },
};
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);
const ROOMS = 10;
const R = 560;            // hall radius
const WALL = 36;          // ring wall thickness
const DEPTH = 250;        // room depth
const RWALL = 26;         // walls between rooms
const DOOR_HALF = 52;     // half width of each doorway
const CAROUSEL_R = 340;
const PED_R = 78;         // pedestal in the middle
const SW = (Math.PI * 2) / ROOMS;
const BODY_R = 13;        // collision radius of a person
const INK = "#1d1b26";
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = randi(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

// room look: floor colour, wall colour, pattern
const ROOM_STYLES = [
  { floor: "#ffd9a8", alt: "#f6c98f", wall: "#ffd23f", pat: "wood" },
  { floor: "#bfe9ff", alt: "#a6dcf7", wall: "#3fa7ff", pat: "check" },
  { floor: "#ffc2c7", alt: "#f7aab2", wall: "#ff6f86", pat: "carpet" },
  { floor: "#c9f2d6", alt: "#b1e6c3", wall: "#43c47a", pat: "check" },
  { floor: "#e6d4ff", alt: "#d5bdfb", wall: "#9b6bff", pat: "wood" },
  { floor: "#fff1b8", alt: "#f9e597", wall: "#ffb000", pat: "carpet" },
  { floor: "#b9f0ea", alt: "#9fe3dc", wall: "#1fae95", pat: "check" },
  { floor: "#ffd2b8", alt: "#f7bc9c", wall: "#ff7a3d", pat: "wood" },
  { floor: "#d6e4ff", alt: "#c1d5fb", wall: "#5b7bff", pat: "carpet" },
  { floor: "#f3e1cf", alt: "#e8d0b8", wall: "#c98b5a", pat: "check" },
];
// ---------------------------------------------------------------- images
const IMG = {};
function loadImages() {
  return Promise.all(Object.keys(ASSETS).map((k) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[k] = im; res(); };
    im.onerror = res;
    im.src = ASSETS[k].src;
  })));
}

// ---------------------------------------------------------------- audio
const Sfx = {
  a: null, musicT: 0, step: 0, drone: null,
  init() { if (!this.a) try { this.a = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.a = null; } },
  tone(f, dur, gain, type = "triangle", f1) {
    const a = this.a; if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, a.currentTime);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, a.currentTime + dur);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  },
  noise(dur, freq, gain, type = "lowpass") {
    const a = this.a; if (!a) return;
    const n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = a.createBufferSource(); s.buffer = b;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = a.createGain(); g.gain.value = gain;
    s.connect(f).connect(g).connect(a.destination); s.start();
  },
  // a little music-box loop while the floor turns
  music(dt) {
    if (!this.a) return;
    this.musicT -= dt;
    if (this.musicT > 0) return;
    this.musicT = 0.26;
    const scale = [523, 587, 659, 784, 880, 1047];
    const tune = [0, 2, 4, 2, 3, 1, 0, -1, 4, 3, 2, 0, 1, 2, 3, -1];
    const n = tune[this.step++ % tune.length];
    if (n >= 0) { this.tone(scale[n], 0.5, 0.07, "triangle"); this.tone(scale[n] / 2, 0.3, 0.03, "sine"); }
  },
  call() { this.tone(110, 1.4, 0.4, "sawtooth", 55); this.tone(165, 1.2, 0.2, "square", 80); },
  buzz() { this.noise(0.09, 3200, 0.12, "highpass"); this.tone(120, 0.09, 0.06, "square"); },
  slam() { this.noise(0.4, 300, 0.7); this.tone(70, 0.3, 0.5, "sine", 40); },
  shove() { this.noise(0.12, 900, 0.25, "bandpass"); },
  caught() { this.tone(700, 0.6, 0.15, "sawtooth", 120); this.noise(0.6, 500, 0.3); },
  heartbeat() { this.tone(60, 0.18, 0.5, "sine", 40); setTimeout(() => this.tone(55, 0.16, 0.35, "sine", 38), 170); },
  safe() { [0, 90, 180].forEach((d, i) => setTimeout(() => this.tone(660 + i * 220, 0.25, 0.1, "triangle"), d)); },
};

// ---------------------------------------------------------------- geometry
function polar(x, y) { return [Math.hypot(x, y), Math.atan2(y, x)]; }
function sectorOf(theta) { return ((Math.round(theta / SW) % ROOMS) + ROOMS) % ROOMS; }
function sectorPhi(theta, s) { return wrap(theta - s * SW); }
function fromPolar(r, th) { return [Math.cos(th) * r, Math.sin(th) * r]; }
const ZONE_R = R - BODY_R - 2;
function cellOf(x, y) { const [r, th] = polar(x, y); return r > ZONE_R ? sectorOf(th) : -1; }
const cellOfA = (a) => cellOf(a.x, a.y);
function roomOf(a) {
  const [r, th] = polar(a.x, a.y);
  return r > R + WALL * 0.5 ? sectorOf(th) : -1;
}
function doorPoint(s, r) { return fromPolar(r, s * SW); }
// ---------------------------------------------------------------- render
let renderScale = Math.min(devicePixelRatio || 1, 2);
const perf = { n: 0, t: 0 };
function adaptQuality(dt) {
  perf.n++; perf.t += dt;
  if (perf.t < 1.5) return;
  const fps = perf.n / perf.t; perf.n = 0; perf.t = 0;
  if (fps < 48 && renderScale > 0.75) renderScale = Math.max(0.75, renderScale >= 1.5 ? 1 : renderScale - 0.25);
}
function baseZoom() { return clamp(Math.min(innerHeight / 900, innerWidth / 1300), 0.45, 1.6); }

let arena = null; // pre-rendered static floor + walls
function buildArena() {
  const size = (R + WALL + DEPTH + 80) * 2;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  g.translate(size / 2, size / 2);
  const outer = R + WALL + DEPTH;

  // room floors
  for (let s = 0; s < ROOMS; s++) {
    const st = ROOM_STYLES[s];
    const a0 = s * SW - SW / 2, a1 = s * SW + SW / 2;
    g.save();
    g.beginPath(); g.arc(0, 0, outer, a0, a1); g.arc(0, 0, R + WALL - 2, a1, a0, true); g.closePath();
    g.fillStyle = st.floor; g.fill();
    g.clip();
    g.strokeStyle = st.alt; g.fillStyle = st.alt;
    if (st.pat === "wood") {
      g.lineWidth = 3;
      for (let r = R + WALL; r < outer; r += 22) { g.beginPath(); g.arc(0, 0, r, a0, a1); g.stroke(); }
      for (let r = R + WALL; r < outer; r += 22) for (let k = 0; k < 4; k++) { const a = a0 + (k + (r / 22) % 2 * 0.5) * (SW / 4); g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a) * (r + 22), Math.sin(a) * (r + 22)); g.stroke(); }
    } else if (st.pat === "check") {
      const n = 7;
      for (let i = 0; i < 12; i++) for (let k = 0; k < n; k++) {
        if ((i + k) % 2) continue;
        const r0 = R + WALL + i * 22, b0 = a0 + (k / n) * SW, b1 = a0 + ((k + 1) / n) * SW;
        g.beginPath(); g.arc(0, 0, r0 + 22, b0, b1); g.arc(0, 0, r0, b1, b0, true); g.closePath(); g.fill();
      }
    } else {
      // carpet: a rounded rug in the middle of the room
      const mr = R + WALL + DEPTH * 0.55;
      const [x, y] = fromPolar(mr, s * SW);
      g.beginPath(); g.ellipse(x, y, 70, 46, s * SW, 0, Math.PI * 2); g.fill();
      g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
      g.beginPath(); g.ellipse(x, y, 50, 30, s * SW, 0, Math.PI * 2); g.strokeStyle = st.wall; g.lineWidth = 5; g.stroke();
    }
    // soft shading towards the outer wall
    const grd = g.createRadialGradient(0, 0, R + WALL, 0, 0, outer);
    grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(40,20,60,0.22)");
    g.fillStyle = grd; g.fillRect(-outer, -outer, outer * 2, outer * 2);
    g.restore();
  }

  // hall floor: teal and cream checks
  g.save();
  g.beginPath(); g.arc(0, 0, R + 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#e9f6f1"; g.fillRect(-R, -R, R * 2, R * 2);
  g.fillStyle = "#3cc2a8";
  const cs = 56;
  for (let x = -R; x < R; x += cs) for (let y = -R; y < R; y += cs) if (((x + y) / cs) % 2 === 0) g.fillRect(x, y, cs, cs);
  const vg = g.createRadialGradient(0, 0, CAROUSEL_R, 0, 0, R);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(20,10,50,0.28)");
  g.fillStyle = vg; g.fillRect(-R, -R, R * 2, R * 2);
  g.restore();

  // walls: drop shadow, then the wall tops
  const wallPath = () => {
    g.beginPath();
    // ring wall with door gaps
    for (let s = 0; s < ROOMS; s++) {
      const gapIn = DOOR_HALF / R, gapOut = DOOR_HALF / (R + WALL);
      const a0 = s * SW + gapIn, a1 = (s + 1) * SW - gapIn;
      g.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
      g.arc(0, 0, R, a0, a1);
      g.lineTo(Math.cos((s + 1) * SW - gapOut) * (R + WALL), Math.sin((s + 1) * SW - gapOut) * (R + WALL));
      g.arc(0, 0, R + WALL, (s + 1) * SW - gapOut, s * SW + gapOut, true);
      g.closePath();
    }
    // radial walls between rooms
    for (let s = 0; s < ROOMS; s++) {
      const a = s * SW + SW / 2;
      const nx = -Math.sin(a), ny = Math.cos(a), h = RWALL / 2;
      const p = (r, sgn) => [Math.cos(a) * r + nx * h * sgn, Math.sin(a) * r + ny * h * sgn];
      const [x0, y0] = p(R + WALL - 2, 1), [x1, y1] = p(outer, 1), [x2, y2] = p(outer, -1), [x3, y3] = p(R + WALL - 2, -1);
      g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath();
    }
    // outer wall
    g.moveTo(outer + 30, 0); g.arc(0, 0, outer + 30, 0, Math.PI * 2, false);
    g.moveTo(outer, 0); g.arc(0, 0, outer, 0, Math.PI * 2, true);
  };
  g.save(); g.translate(0, 14); wallPath(); g.fillStyle = "rgba(25,15,45,0.45)"; g.fill("evenodd"); g.restore();
  wallPath();
  g.fillStyle = "#fbf6ec"; g.fill("evenodd");
  g.lineWidth = 5; g.strokeStyle = INK; g.lineJoin = "round"; g.stroke();
  // coloured trim on the room side of each wall segment
  for (let s = 0; s < ROOMS; s++) {
    const st = ROOM_STYLES[s];
    g.beginPath();
    const gapOut = DOOR_HALF / (R + WALL);
    g.arc(0, 0, R + WALL + 6, s * SW - SW / 2 + 0.02, s * SW - gapOut);
    g.moveTo(Math.cos(s * SW + gapOut) * (R + WALL + 6), Math.sin(s * SW + gapOut) * (R + WALL + 6));
    g.arc(0, 0, R + WALL + 6, s * SW + gapOut, s * SW + SW / 2 - 0.02);
    g.lineWidth = 8; g.strokeStyle = st.wall; g.stroke();
  }
  return c;
}

const ROOM_PROPS = [];
function placeProps() {
  ROOM_PROPS.length = 0;
  const keys = Object.keys(IMG).filter((k) => ASSETS[k].kind === "prop" && k !== "rug");
  if (!keys.length) return;
  for (let s = 0; s < ROOMS; s++) {
    const n = 2;
    const used = new Set();
    for (let i = 0; i < n; i++) {
      let k; do { k = pick(keys); } while (used.has(k) && used.size < keys.length);
      used.add(k);
      const side = i === 0 ? -1 : 1;
      const r = R + WALL + DEPTH - 42;
      const maxPhi = SW / 2 - (RWALL / 2 + 40) / r;
      const [x, y] = fromPolar(r, s * SW + side * maxPhi * 0.7);
      ROOM_PROPS.push({ key: k, x, y, s: 0.5 });
    }
  }
}

function render() {
  const vw = innerWidth, vh = innerHeight;
  if (vw < 2 || vh < 2) return;
  const dpr = renderScale;
  if (canvas.width !== Math.floor(vw * dpr) || canvas.height !== Math.floor(vh * dpr)) { canvas.width = Math.floor(vw * dpr); canvas.height = Math.floor(vh * dpr); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#1b1640"); bg.addColorStop(1, "#0d0a1f");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!arena) return;

  const z = cam.zoom, sh = cam.shake ? rand(-cam.shake, cam.shake) * 0.5 : 0;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (vw / 2 - cam.x * z + sh), dpr * (vh / 2 - cam.y * z + sh));
  ctx.imageSmoothingQuality = renderScale > 1 ? "high" : "medium";
  ctx.drawImage(arena, -arena.width / 2, -arena.height / 2);

  drawCarousel();
  drawDoors();
  drawRoomBadges();

  // shadows under people
  ctx.fillStyle = "rgba(20,10,40,0.28)";
  for (const a of people) if (a.alive) { ctx.beginPath(); ctx.ellipse(a.x, a.y, 15, 6, 0, 0, Math.PI * 2); ctx.fill(); }

  const list = [];
  for (const p of ROOM_PROPS) list.push({ y: p.y, d: () => drawProp(p) });
  for (const a of people) if (a.alive) list.push({ y: a.y, d: () => drawPerson(a) });
  list.push({ y: watcher.y + 20, d: drawWatcher });
  list.sort((p, q) => p.y - q.y);
  for (const it of list) it.d();

  for (const p of particles) {
    const t = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = t;
    ctx.fillStyle = p.c === "smoke" ? "#160c2a" : p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (p.c === "smoke" ? 1.4 - t * 0.4 : 1), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLight(vw, vh, z);
}

function drawCarousel() {
  ctx.save();
  ctx.rotate(carouselAngle);
  const n = 16;
  for (let i = 0; i < n; i++) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, CAROUSEL_R, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? "#ffd23f" : "#fbf6ec"; ctx.fill();
  }
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(29,27,38,0.25)";
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * PED_R, Math.sin(a) * PED_R); ctx.lineTo(Math.cos(a) * CAROUSEL_R, Math.sin(a) * CAROUSEL_R); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(0, 0, CAROUSEL_R - 26, 0, Math.PI * 2); ctx.strokeStyle = "#ff6f86"; ctx.lineWidth = 8; ctx.stroke();
  // little lights around the rim
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, on = phase === "mad" ? Math.floor(time * 10) % 2 === 0 : phase === "seal" ? false : (Math.floor(time * 6) + i) % 3 === 0;
    ctx.beginPath(); ctx.arc(Math.cos(a) * (CAROUSEL_R - 10), Math.sin(a) * (CAROUSEL_R - 10), 5, 0, Math.PI * 2);
    ctx.fillStyle = on ? (phase === "mad" ? "#ff4b5c" : "#fff4b0") : "#c9b98a"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, CAROUSEL_R, 0, Math.PI * 2); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
  // pedestal (does not turn)
  ctx.beginPath(); ctx.ellipse(0, 10, PED_R + 6, PED_R * 0.9, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(20,10,40,0.35)"; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, PED_R, 0, Math.PI * 2); ctx.fillStyle = "#2b2148"; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, PED_R - 14, 0, Math.PI * 2); ctx.strokeStyle = "#5b4b8a"; ctx.lineWidth = 4; ctx.stroke();
}

function drawDoors() {
  for (let s = 0; s < ROOMS; s++) {
    const d = doors[s], st = ROOM_STYLES[s];
    const a = s * SW;
    ctx.save();
    ctx.rotate(a);
    // in this frame the doorway runs along y at x = R..R+WALL
    const half = DOOR_HALF, slide = d.open * half;
    // a full cell's doors turn green; a cell the Watcher just dropped someone into flashes red
    const col = d.state === "closed" ? "#5d5873" : d.flash > 0 && Math.floor(d.flash * 10) % 2 === 0 ? "#ff4b5c" : live(s) && occ[s] >= cap ? "#48e28a" : st.wall;
    for (const sgn of [-1, 1]) {
      const y0 = sgn < 0 ? -half - slide : slide;
      ctx.fillStyle = col;
      ctx.fillRect(R + 6, y0, WALL - 12, half);
      ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.strokeRect(R + 6, y0, WALL - 12, half);
      ctx.beginPath(); ctx.arc(R + WALL / 2, y0 + (sgn < 0 ? half - 8 : 8), 3, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    }
    ctx.restore();
  }
}

function drawRoomBadges() {
  if (phase === "title" || phase === "wait" || phase === "connecting") return;
  for (let s = 0; s < ROOMS; s++) {
    const [x, y] = fromPolar(R + WALL + DEPTH * 0.5, s * SW);
    if (!live(s)) {
      // cells this lobby doesn't need: a dim "closed" plate
      ctx.save(); ctx.globalAlpha = 0.75;
      ctx.font = "34px 'Luckiest Guy', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 8; ctx.lineJoin = "round"; ctx.strokeStyle = INK; ctx.strokeText("CLOSED", x, y);
      ctx.fillStyle = "#8b86a3"; ctx.fillText("CLOSED", x, y);
      ctx.restore();
      continue;
    }
    // head count: white while there's room, green when full
    const c = occ[s], full = c >= cap;
    const text = `${c}/${cap}`;
    ctx.save();
    ctx.font = "64px 'Luckiest Guy', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 34;
    ctx.globalAlpha = c ? 0.92 : 0.6;
    ctx.beginPath(); roundRect(x - w / 2, y - 40, w, 74, 22);
    ctx.fillStyle = "rgba(29,27,38,0.55)"; ctx.fill();
    ctx.lineWidth = 11; ctx.strokeStyle = INK; ctx.lineJoin = "round";
    ctx.strokeText(text, x, y + 2); ctx.fillStyle = full ? "#48e28a" : "#ffffff"; ctx.fillText(text, x, y + 2);
    ctx.font = "22px 'Luckiest Guy', sans-serif";
    ctx.lineWidth = 6; ctx.strokeText(full ? "FULL" : `CELL ${s + 1}`, x, y + 52);
    ctx.fillStyle = full ? "#48e28a" : ROOM_STYLES[s].wall; ctx.fillText(full ? "FULL" : `CELL ${s + 1}`, x, y + 52);
    ctx.restore();
  }
}

function drawProp(p) {
  const im = IMG[p.key]; if (!im) return;
  const w = im.width * p.s, h = im.height * p.s;
  ctx.drawImage(im, p.x - w / 2, p.y - h + 4, w, h);
}

// stick figure in the reference style: egg head, capsule shirt, stick limbs
// people are drawn by the shared rig in art.js
function drawPerson(a) {
  // carried by the Watcher: held up off the floor, legs kicking
  const lift = a.carried ? 62 + Math.sin(time * 9) * 4 : 0;
  const out = cellOfA(a) < 0;
  const scared = a.carried || (phase === "mad" && out);
  Art.drawPerson(ctx, a, {
    t: time, scared, happy: !out && phase !== "title", lift, shake: a.carried ? 0.6 : 0,
    number: String(a.num).padStart(2, "0"),
  });
  // everyone's username floats above them (yours in yellow)
  drawNameTag(a, lift);
  // the player gets a marker
  if (a.isPlayer) {
    const y = a.y - 132 - lift + Math.sin(time * 4) * 3;
    ctx.save(); ctx.translate(a.x, y);
    ctx.beginPath(); ctx.moveTo(-11, -12); ctx.lineTo(11, -12); ctx.lineTo(0, 4); ctx.closePath();
    ctx.fillStyle = "#ffd23f"; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawWatcher() {
  const im = watcherImage();
  const hunting = watcher.mode === "drag";
  const bob = Math.sin(watcher.t * 2) * 6;
  const s = (im === IMG.shadow ? 0.36 : WATCHER_S) * watcher.scale;
  ctx.save();
  ctx.translate(watcher.x, watcher.y + bob);
  // smoke pool
  ctx.fillStyle = "rgba(15,8,30,0.55)";
  ctx.beginPath(); ctx.ellipse(0, 20, 70 * watcher.scale, 22, 0, 0, Math.PI * 2); ctx.fill();
  if (im) {
    const w = im.width * s, h = im.height * s;
    const sx = 1 + Math.sin(watcher.t * 3) * 0.03, sy = 1 + Math.cos(watcher.t * 2.5) * 0.03 + (hunting ? 0.06 : 0);
    ctx.scale(sx, sy);
    ctx.drawImage(im, -w / 2, -h + 30, w, h);
  } else {
    ctx.fillStyle = "#120a22";
    ctx.beginPath(); ctx.ellipse(0, -90, 50, 110, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// lighting: colourful party lights while people pick cells, dim and pulsing red while the
// Watcher is mad
const light = document.createElement("canvas");
function drawLight(vw, vh, z) {
  const sc = 0.33, lw = Math.ceil(vw * sc), lh = Math.ceil(vh * sc);
  if (light.width !== lw || light.height !== lh) { light.width = lw; light.height = lh; }
  const g = light.getContext("2d");
  const L = lightLevel;
  const callPulse = phase === "mad" || phase === "allin" ? 0.5 + 0.5 * Math.sin(time * 6) : 0;
  const amb = [lerp(28, 255, L), lerp(22, lerp(245, 205, callPulse), L), lerp(60, lerp(235, 205, callPulse), L)];
  g.globalCompositeOperation = "source-over";
  g.fillStyle = `rgb(${amb.map(Math.round).join(",")})`; g.fillRect(0, 0, lw, lh);
  g.globalCompositeOperation = "lighter";
  const S = (x, y) => [((x - cam.x) * z + vw / 2) * sc, ((y - cam.y) * z + vh / 2) * sc];
  const glow = (x, y, r, rgb, k) => {
    const [sx, sy] = S(x, y), rr = r * z * sc;
    if (sx < -rr || sy < -rr || sx > lw + rr || sy > lh + rr || k <= 0.01) return;
    const grd = g.createRadialGradient(sx, sy, 0, sx, sy, rr);
    grd.addColorStop(0, `rgba(${rgb},${k})`); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  };
  if (phase !== "mad" && phase !== "seal") {
    // sweeping coloured spotlights
    const cols = ["255,120,160", "120,200,255", "255,220,120", "150,255,190"];
    for (let i = 0; i < 4; i++) {
      const a = time * 0.6 + i * Math.PI / 2;
      glow(Math.cos(a) * 260, Math.sin(a) * 260, 300, cols[i], 0.18);
    }
  }
  const dark = 1 - L;
  if (dark > 0.05) {
    for (const a of people) if (a.alive) glow(a.x, a.y - 40, a.isPlayer ? 230 : 95, "200,190,255", (a.isPlayer ? 0.75 : 0.35) * dark);
    // the Watcher's cold glow
    glow(watcher.x, watcher.y - 80, 200, watcher.mode === "drag" ? "255,60,60" : "120,220,255", 0.4 * dark);
  }
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  // vignette baked in
  g.globalCompositeOperation = "multiply";
  const vg = g.createRadialGradient(lw / 2, lh / 2, Math.min(lw, lh) * 0.3, lw / 2, lh / 2, Math.max(lw, lh) * 0.72);
  vg.addColorStop(0, "#ffffff"); vg.addColorStop(1, "#5a4a8a");
  g.fillStyle = vg; g.fillRect(0, 0, lw, lh);
  ctx.drawImage(light, 0, 0, vw, vh);
  ctx.restore();
  // eyes always glow on top
  const [ex, ey] = [(watcher.x - cam.x) * z + vw / 2, (watcher.y - cam.y) * z + vh / 2];
  if (IMG.watcher_chase && window.EYES && watcher.mode === "drag") {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const s = WATCHER_S * watcher.scale, bob = Math.sin(watcher.t * 2) * 6;
    for (const e of window.EYES) {
      const x = ex + e.x * s * z, y = ey + (e.y * s + 30 + bob) * z;
      const r = 26 * z * watcher.scale;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      const pulse = 0.75 + Math.sin(time * 9) * 0.25;
      grd.addColorStop(0, `rgba(255,40,40,${(0.55 + dark * 0.45) * pulse})`); grd.addColorStop(0.4, `rgba(255,0,0,${0.25 * pulse})`); grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }
  if (flashRed > 0) { ctx.fillStyle = `rgba(255,40,60,${flashRed})`; ctx.fillRect(0, 0, vw, vh); }
}

function drawNameTag(a, lift) {
  const y = a.y - 104 - lift;
  ctx.save();
  ctx.font = "700 15px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(a.name).width + 14;
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); roundRect(a.x - w / 2, y - 10, w, 20, 8); ctx.fillStyle = a.isPlayer ? "#ffd23f" : a.bot ? "rgba(31,174,149,0.85)" : "rgba(29,27,38,0.78)"; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = a.isPlayer ? INK : "#fbf6ec"; ctx.fillText(a.name, a.x, y + 1);
  ctx.restore();
}


// ---------------------------------------------------------------- state (all of it from the server)
const ALLIN_T = 8.2, GATHER = 20; // ALLIN_T = SLAM - SWITCH, so the doors shut on the song's big beat
const doors = Array.from({ length: ROOMS }, () => ({ open: 0, state: "closed", flash: 0, inPlay: false }));
const live = (s) => doors[s].inPlay;
let occ = new Array(ROOMS).fill(0), cap = 4, teamCount = 0;
let people = [], player = null;
const byName = new Map();   // username → drawn person
const roster = new Map();   // username → { num, look, on }
const watcher = { x: 0, y: 0, tx: 0, ty: 0, mode: "home", t: 0, scale: 1, scaleT: 1, carry: null };
let phase = "connecting", phaseT = 0, time = 0, gatherLeft = GATHER;
let carouselAngle = 0, carouselSpeed = 0.42, serverAngle = 0, lightLevel = 1, flashRed = 0;
let particles = [];
const cam = { x: 0, y: 0, zoom: 1, target: 1, shake: 0 };
let me = null, code = "", host = null, audioReady = false, songFor = null, minutes = 5;

function personFor(name) {
  let a = byName.get(name);
  if (!a) {
    const r = roster.get(name);
    a = { name, num: r ? r.num : 0, look: r ? r.look : Art.makeLook(), x: 0, y: 0, tx: 0, ty: 0, face: 1, carried: false, stun: false,
      moving: false, walk: Math.random() * 10, alive: true, isPlayer: name === me, fresh: true, bot: !!(r && r.bot) };
    byName.set(name, a);
  }
  return a;
}
function puff(x, y, c, n = 5) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-80, 80), vy: rand(-80, 40), life: rand(0.3, 0.6), max: 0.6, c, s: rand(4, 9) });
}
const near = (x, y, d = 700) => !player || Math.hypot(x - player.x, y - player.y) < d;

// ---------------------------------------------------------------- messages
Net.on("hello", (m) => {
  me = m.you; code = m.code; host = m.host;
  if (m.stage !== "lobby") { location.replace(`/maze?code=${m.code}`); return; }
  history.replaceState(null, "", `/play?code=${m.code}`);
  $("code").textContent = m.code;
  $("me").textContent = me;
  for (const a of byName.values()) a.isPlayer = a.name === me;
});
Net.on("roster", (m) => {
  host = m.host; minutes = m.minutes || 5;
  roster.clear();
  for (const p of m.players) roster.set(p.n, { num: p.num, look: p.look, on: p.on, bot: p.bot });
  for (const a of byName.values()) { const r = roster.get(a.name); if (r) { a.num = r.num; a.look = r.look; } }
  $("roster").innerHTML = m.players.map((p) =>
    `<li class="${p.on ? "" : "off"}${p.n === me ? " you" : ""}${p.bot ? " bot" : ""}"><b>${String(p.num).padStart(2, "0")}</b>${escapeHtml(p.n)}${p.n === m.host ? ' <span class="crown" title="host">HOST</span>' : p.bot ? ' <span class="crown bot" title="a bot: a real player who joins takes its place">BOT</span>' : ""}</li>`).join("");
  const nb = m.players.filter((p) => p.bot).length;
  $("count").textContent = `${m.players.length}/${m.max || 40} player${m.players.length === 1 ? "" : "s"}${nb ? ` (${nb} bot${nb === 1 ? "" : "s"})` : ""}`;
  for (const a of byName.values()) a.bot = !!(roster.get(a.name) || {}).bot;
  updateHostUi();
});
Net.on("L", (s) => {
  phase = s.ph; phaseT = s.pt; gatherLeft = s.tl; cap = s.cap; teamCount = s.tc;
  serverAngle = s.ca; carouselSpeed = s.cs;
  for (let i = 0; i < ROOMS; i++) {
    const d = doors[i];
    d.inPlay = !!s.live[i]; d.state = d.inPlay ? "open" : "closed"; d.open = s.dr[i] / 100; d.flash = s.fl[i] / 10;
  }
  occ = s.occ;
  watcher.tx = s.w[0]; watcher.ty = s.w[1]; watcher.mode = s.w[2] ? "drag" : "home"; watcher.scaleT = s.w[3] / 100; watcher.carry = s.w[4];
  const seen = new Set();
  for (const [n, x, y, f, face] of s.p) {
    const a = personFor(n); seen.add(n);
    if (a.fresh || Math.hypot(x - a.x, y - a.y) > 260) { a.x = x; a.y = y; a.fresh = false; }
    a.tx = x; a.ty = y; a.carried = !!(f & 1); a.stun = !!(f & 2); a.face = face;
  }
  for (const n of [...byName.keys()]) if (!seen.has(n)) byName.delete(n);
  people = [...byName.values()];
  player = byName.get(me) || null;
  if (player && !camReady) { cam.x = player.x; cam.y = player.y; camReady = true; }
  syncSong();
});
let camReady = false;
Net.on("ev", (e) => {
  if (e.e === "phase") onPhase(e.ph);
  else if (e.e === "shove") {
    const a = byName.get(e.n);
    if (a) { a.face = e.f; Art.pose(a, "shove", 0.35); if (near(a.x, a.y, 600)) Sfx.shove(); }
    for (const h of e.hit) { const o = byName.get(h); if (o) puff(o.x, o.y - 30, "#ffffff", 6); }
  } else if (e.e === "grab") {
    const a = byName.get(e.n);
    if (a && near(a.x, a.y, 800)) Sfx.caught();
    cam.shake = Math.max(cam.shake, e.n === me ? 18 : 6);
    if (e.n === me) caption("GOTCHA", "", "red");
  } else if (e.e === "replaced") {
    caption(e.n === me ? "YOU'RE IN" : `${e.n} JOINED`, "", "green", 1.6);
  } else if (e.e === "drop") {
    puff(e.x, e.y - 20, "#ffffff", 10);
    if (near(e.x, e.y, 800)) Sfx.slam();
    if (e.n === me) caption(`CELL ${e.cell + 1}`, "", "red");
  }
});
let lastPhaseEv = null;
function onPhase(ph) {
  const prev = lastPhaseEv; lastPhaseEv = ph;
  if (ph === "gather") caption(prev === "allin" ? "SOMEONE LEFT" : "PICK A CELL", "", prev === "allin" ? "red" : "");
  else if (ph === "allin") { caption("EVERYONE'S IN", "", "green"); Sfx.safe(); }
  else if (ph === "mad") { caption("TOO SLOW!", "", "red"); flashRed = 0.5; cam.shake = 18; Sfx.call(); }
  else if (ph === "seal") {
    const n = doors.filter((d, s) => d.inPlay && occ[s] > 0).length;
    caption(`${n} TEAM${n === 1 ? "" : "S"}`, "", "green", 99);
    Sfx.slam(); cam.shake = 14; songFor = "seal";
    setTimeout(() => { if (songFor === "seal") Song.fade(1.4); }, 900);
  }
}
Net.on("lost", (why) => {
  if (why === "elsewhere") { $("lost").classList.remove("hidden"); $("lost-text").textContent = "You opened the game in another tab."; }
  else if (why === "retry") sub("Connection lost. Reconnecting…");
});

// The mingle song follows the lobby:
//   waiting / picking cells   part one, on a loop
//   everyone's in a cell      the climax: the clock ticks, the lights flicker on every tick,
//                             and the doors slam on its big beat (the countdown is timed to it)
//   the Watcher is mad        the ticking stretch of the climax, on a loop, until it's done
function syncSong() {
  if (!audioReady || !Song.buf) return;
  if ((phase === "wait" || phase === "gather") && songFor !== "mingle") {
    songFor = "mingle"; Song.play(phase === "gather" ? (GATHER - gatherLeft) % SWITCH : 0, [0, SWITCH]);
  } else if (phase === "allin" && songFor !== "climax") {
    songFor = "climax"; Song.play(SWITCH + clamp(phaseT, 0, ALLIN_T - 0.5));
  } else if (phase === "mad" && songFor !== "mad") {
    songFor = "mad"; Song.play(SWITCH, [SWITCH, SLAM]);
  }
}
// lights stutter on each tick of the climax, harder as the slam gets close
let lastTickN = -1;
const flick = { t: 0, depth: 0 };
function climaxTicks() {
  if (!Song.playing || (phase !== "allin" && phase !== "mad")) { lastTickN = -1; return; }
  const t = Song.time(), n = TICKS.filter((k) => k <= t).length;
  if (lastTickN >= 0 && n !== lastTickN) {
    const p = phase === "allin" ? clamp(phaseT / ALLIN_T, 0, 1) : 0.7;
    flick.t = 0.07 + p * 0.06; flick.depth = 0.45 + p * 0.35;
    const bar = $("bar"); bar.classList.remove("tick"); void bar.offsetWidth; bar.classList.add("tick");
  }
  lastTickN = n;
}

// ---------------------------------------------------------------- HUD
let capT = 0;
function caption(text, cls, color, dur = 2.6) {
  capT = dur;
  const el = $("caption");
  el.textContent = text; el.className = ""; void el.offsetWidth;
  if (cls) el.classList.add(cls);
  if (color) el.classList.add(color);
  if (text) el.classList.add("pop");
}
let lastSub = "";
function sub(text) { if (text !== lastSub) { $("sub").textContent = text; lastSub = text; } }
function inCells() { return people.filter((a) => !a.carried && cellOfA(a) >= 0).length; }
function updateHostUi() {
  const isHost = me && host === me;
  $("start-btn").classList.toggle("hidden", !(isHost && phase === "wait"));
  $("bot-ctl").classList.toggle("hidden", !(isHost && phase === "wait"));
  // match length: everyone sees it; only the host can change it, before the round starts
  const lc = $("len-ctl"), canSet = isHost && phase === "wait";
  lc.classList.toggle("locked", !canSet);
  for (const b of lc.querySelectorAll("button")) { b.classList.toggle("on", +b.dataset.min === minutes); b.disabled = !canSet; }
  $("session").classList.toggle("waiting", phase === "wait");
}
function updateHud() {
  updateHostUi();
  const clockEl = $("clock");
  if (phase === "allin") {
    const left = Math.max(0, ALLIN_T - phaseT);
    clockEl.textContent = `0:${String(Math.ceil(left)).padStart(2, "0")}`;
    clockEl.classList.remove("hidden"); clockEl.classList.add("low");
    $("bar-fill").style.width = `${clamp(left / ALLIN_T, 0, 1) * 100}%`;
    $("bar-fill").style.background = left < ALLIN_T * 0.35 ? "#ff8a3d" : "#ffd23f";
    $("bar").style.opacity = 1;
  } else if (phase === "gather") {
    const s = Math.ceil(Math.max(0, gatherLeft));
    clockEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    clockEl.classList.remove("hidden");
    clockEl.classList.toggle("low", s <= 10 && phase === "gather");
    $("bar-fill").style.width = `${clamp(gatherLeft / GATHER, 0, 1) * 100}%`;
    $("bar-fill").style.background = gatherLeft < 10 ? "#ff8a3d" : "#1fae95";
    $("bar").style.opacity = 1;
  } else { clockEl.classList.add("hidden"); $("bar").style.opacity = 0; }
  $("alive").textContent = phase === "wait" ? `${people.length} in the hall` : `${inCells()} / ${people.length} in cells`;
  $("round").textContent = phase === "wait" ? `code ${code}` : `${teamCount} team${teamCount === 1 ? "" : "s"} · up to ${cap}`;
  if (!player) return;
  const here = player.carried ? -1 : cellOfA(player);
  if (phase === "wait") sub(host === me ? "You're the host. Press START (or Enter) when everyone's here." : `Waiting for ${host || "the host"} to start. Share the code: ${code}`);
  else if (phase === "seal" || phase === "done") sub("Each cell is a team. Off to the maze!");
  else if (player.carried) sub("Caught! The Watcher is putting you in the emptiest cell.");
  else if (phase === "allin") sub(`Everyone's in a cell. Locking the teams in ${Math.max(1, Math.ceil(ALLIN_T - phaseT))}…`);
  else if (phase === "mad") sub(here >= 0 ? `The Watcher is dragging the stragglers in. ${people.length - inCells()} left.` : "It's coming for you. Get into a cell!");
  else if (here >= 0) sub(`You're in Cell ${here + 1} (${occ[here]}/${cap}). Walk out to switch teams.`);
  else sub("Walk into a cell to join that team. Full cells won't let you in.");
}

// ---------------------------------------------------------------- update (drawing only: the server moves everyone)
function update(dt) {
  time += dt; phaseT += dt;
  if (phase === "gather") gatherLeft = Math.max(0, gatherLeft - dt);
  // the floor: run at the server's speed, nudged toward the server's angle
  carouselAngle += carouselSpeed * dt;
  carouselAngle += wrap(serverAngle - carouselAngle) * clamp(dt * 4, 0, 1);
  serverAngle += carouselSpeed * dt;
  const k = 1 - Math.exp(-dt * 16), kc = 1 - Math.exp(-dt * 26);
  for (const a of people) {
    const ox = a.x, oy = a.y, kk = a.carried ? kc : k;
    a.x += (a.tx - a.x) * kk; a.y += (a.ty - a.y) * kk;
    const sp = Math.hypot(a.x - ox, a.y - oy) / Math.max(dt, 1e-3);
    a.moving = sp > 25 && !a.carried;
    if (a.moving) a.walk += dt * (sp / 160);
  }
  watcher.t += dt;
  watcher.x += (watcher.tx - watcher.x) * kc; watcher.y += (watcher.ty - watcher.y) * kc;
  watcher.scale = lerp(watcher.scale, watcher.scaleT, clamp(dt * 6, 0, 1));
  if (watcher.mode === "drag" && Math.hypot(watcher.tx, watcher.ty) > 30) for (let i = 0; i < 2; i++) particles.push({ x: watcher.x + rand(-30, 30), y: watcher.y + rand(-10, 20), vx: rand(-30, 30), vy: rand(-40, -10), life: rand(0.5, 1.1), max: 1.1, c: "smoke", s: rand(10, 22) });
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2; }
  particles = particles.filter((p) => p.life > 0);

  climaxTicks();
  if (phase === "allin" || phase === "mad") {
    // the lights dim and flicker, worse and worse toward the slam
    const p = phase === "allin" ? clamp(phaseT / ALLIN_T, 0, 1) : 0.7;
    const base = phase === "allin" ? lerp(0.95, 0.42, p) : 0.55;
    if (flick.t <= 0 && Math.random() < dt * (1.5 + 9 * p)) {
      flick.t = rand(0.04, 0.16); flick.depth = rand(0.35, 0.85);
      if (Math.random() < 0.4) Sfx.buzz();
    }
    flick.t -= dt;
    lightLevel = base * (flick.t > 0 ? 1 - flick.depth : 1);
    if (phase === "mad" && Math.random() < dt * 1.2) flashRed = Math.max(flashRed, 0.18);
  } else {
    const want = phase === "seal" || phase === "done" ? 0.8 : 1;
    lightLevel = lerp(lightLevel, want, clamp(dt * 2, 0, 1));
  }

  const f = player || { x: 0, y: 0 };
  cam.x = lerp(cam.x, f.x, clamp(dt * 5, 0, 1));
  cam.y = lerp(cam.y, f.y - 40, clamp(dt * 5, 0, 1));
  cam.zoom = lerp(cam.zoom, cam.target * baseZoom(), clamp(dt * 6, 0, 1));
  cam.shake = Math.max(0, cam.shake - dt * 40);
  flashRed = Math.max(0, flashRed - dt * 1.2);
  if (capT > 0 && (capT -= dt) <= 0) caption("", "", "", 0);
  updateHud();
}

// ---------------------------------------------------------------- loop and input
addEventListener("keydown", (e) => {
  if (e.repeat || (e.target && e.target.tagName === "INPUT")) return;
  if (e.code === "Space") Net.send({ t: "shove" });
  if (e.code === "Enter" && host === me && phase === "wait" && $("enter").classList.contains("hidden")) Net.send({ t: "start" });
});
addEventListener("wheel", (e) => { cam.target = clamp(cam.target * (e.deltaY > 0 ? 0.9 : 1.1), 0.45, 1.9); }, { passive: true });
$("start-btn").addEventListener("click", () => Net.send({ t: "start" }));
$("len-ctl").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  Net.send({ t: "length", min: +b.dataset.min });
});
// host: fill the session with bots (real players who join later take their places)
$("bot-ctl").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  Net.send(b.dataset.clear ? { t: "bots", clear: true } : { t: "bots", add: +b.dataset.add });
});
$("copy").addEventListener("click", () => {
  const url = `${location.origin}/play?code=${code}`;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { $("copy").textContent = "Copied!"; setTimeout(() => { $("copy").textContent = "Copy link"; }, 1500); }).catch(() => prompt("Share this link", url));
});
$("enter-btn").addEventListener("click", () => {
  Sfx.init(); if (Sfx.a) Sfx.a.resume();
  audioReady = true; syncSong();
  $("enter").classList.add("hidden"); $("hud").classList.remove("hidden");
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  adaptQuality(dt);
  Input.tick(now);
  update(dt);
  render();
  requestAnimationFrame(frame);
}

window.__game = { get people() { return people; }, get player() { return player; }, get phase() { return phase; }, doors, watcher, cam };
Song.load();
loadImages().then(() => {
  arena = buildArena();
  placeProps();
  requestAnimationFrame(frame);
});
Net.start();
