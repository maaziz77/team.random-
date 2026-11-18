"use strict";
/*
  The maze, in the browser. The server runs every team's shaft (app/src/maze.js) and sends this
  page the state of the team you're on (or watching) ~30 times a second. The walls aren't sent:
  this page rebuilds the same shaft from the match seed with shared/mazeworld.js. Here we only
  send keys and draw, smoothing positions between updates.
*/

const ASSETS = window.ASSETS || {};
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- constants
const INK = "#1d1b26";
const C = 176;          // cell interior size
const W = 34;           // wall thickness
const P = C + W;        // cell pitch
const WALL_H = 44;      // how far wall tops are drawn above their footprint
const BODY_R = 14;
const MON_R = 20;
const THAW_TIME = 2.0;

const STYLES = [
  { floor: "#ffd9a8", alt: "#f6c98f", top: "#ffd23f", front: "#c99a12", pat: "wood" },
  { floor: "#bfe9ff", alt: "#a6dcf7", top: "#5bb4ff", front: "#2f78c4", pat: "check" },
  { floor: "#ffc2c7", alt: "#f7aab2", top: "#ff7f93", front: "#c44a5f", pat: "carpet" },
  { floor: "#c9f2d6", alt: "#b1e6c3", top: "#55cf86", front: "#2c9257", pat: "check" },
  { floor: "#e6d4ff", alt: "#d5bdfb", top: "#a47cff", front: "#6a46c4", pat: "wood" },
];
const GATE_COL = ["#ffd23f", "#3fa7ff", "#ff6f86", "#48e28a", "#a47cff"];
const PROP_KEYS = ["plant", "boxes", "bookshelf", "stool", "cooler", "armchair", "coatrack"];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// ---------------------------------------------------------------- images
const IMG = {};
function loadImages() {
  // python's simple server sometimes drops a connection on a fast reload, so retry a few times
  const load = (k, tries) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[k] = im; res(); };
    im.onerror = () => (tries > 0 ? setTimeout(() => load(k, tries - 1).then(res), 250) : res());
    im.src = ASSETS[k].src + (tries < 3 ? `?r=${tries}` : "");
  });
  return Promise.all(Object.keys(ASSETS).map((k) => load(k, 3)));
}

// ---------------------------------------------------------------- audio
const Sfx = {
  a: null, chargeT: 0,
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
  drone() {
    const a = this.a; if (!a || this.droneOn) return;
    this.droneOn = true;
    const g = a.createGain(); g.gain.value = 0.035; g.connect(a.destination);
    for (const f of [55, 82.4, 110.6]) {
      const o = a.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = 0.07 + Math.random() * 0.1; lg.gain.value = 1.5;
      lfo.connect(lg).connect(o.frequency); o.connect(g); o.start(); lfo.start();
    }
  },
  click() { this.tone(520, 0.08, 0.16, "square", 300); this.noise(0.06, 2000, 0.15, "bandpass"); },
  unclick() { this.tone(300, 0.08, 0.1, "square", 200); },
  banish() { this.noise(0.9, 800, 0.45, "lowpass"); this.tone(330, 0.8, 0.18, "sine", 80); setTimeout(() => this.tone(990, 0.4, 0.08, "triangle", 1320), 250); },
  lever() { this.noise(0.09, 900, 0.35, "bandpass"); this.tone(180, 0.12, 0.22, "square", 90); setTimeout(() => this.tone(880, 0.12, 0.1, "triangle"), 60); },
  charge(p, dt) { this.chargeT -= dt; if (this.chargeT > 0) return; this.chargeT = 0.12; this.tone(300 + p * 500, 0.14, 0.08, "triangle"); },
  circuit() { this.tone(200, 0.7, 0.14, "sawtooth", 1600); this.noise(0.5, 3000, 0.18, "highpass"); },
  gate() { this.noise(0.5, 400, 0.6); this.tone(90, 0.4, 0.4, "sine", 50); [0, 120, 240].forEach((d, i) => setTimeout(() => this.tone(523 + i * 262, 0.3, 0.1, "triangle"), 200 + d)); },
  freeze() { this.noise(0.5, 5000, 0.35, "highpass"); this.tone(1400, 0.5, 0.08, "sine", 300); this.tone(180, 0.6, 0.25, "sawtooth", 60); },
  thaw() { [0, 80, 160, 240].forEach((d, i) => setTimeout(() => this.tone(660 + i * 165, 0.2, 0.08, "triangle"), d)); },
  spotted() { this.tone(110, 0.9, 0.3, "sawtooth", 70); this.noise(0.4, 600, 0.3); },
  heartbeat() { this.tone(60, 0.18, 0.45, "sine", 40); setTimeout(() => this.tone(55, 0.16, 0.32, "sine", 38), 170); },
  lose() { this.tone(220, 1.6, 0.3, "sawtooth", 55); },
  win() { [0, 110, 220, 330, 520].forEach((d, i) => setTimeout(() => this.tone(523 * Math.pow(1.26, i), 0.35, 0.12, "triangle"), d)); },
};

// ---------------------------------------------------------------- the shaft (rebuilt here from the seed)
const { MazeWorld } = Maze;
const tpos = (k) => Math.floor(k / 2) * P + (k % 2 ? W : 0);
const tlen = (k) => (k % 2 ? C : W);
function tileAt(v) { const k = Math.floor(v / P); return v - k * P < W ? 2 * k : 2 * k + 1; }
const ccx = (i) => i * P + W + C / 2;
function cellOfXY(x, y) { return [clamp(Math.floor((x - W / 2) / P), 0, L.COLS - 1), clamp(Math.floor((y - W / 2) / P), 0, L.ROWS - 1)]; }
const cellOf = (a) => cellOfXY(a.x, a.y);
const cidx = (i, j) => j * L.COLS + i;
let kit = null, L = null;
const nbBuf = [];

// ---------------------------------------------------------------- state from the server
const WALK_TIME = 10;
const MODE_NAMES = ["sleep", "patrol", "search", "hunt", "leave"];
let me = null, code = "", seed = 0, teams = [], myTeam = -1, watching = -1;
let host = null; // the session's host: only they can open the algorithm view (G)
const isHost = () => !!me && host === me;
let team = [], player = null;
const monster = { x: -5000, y: -5000, tx: -5000, ty: -5000, mode: "sleep", t: 0, face: 1, target: null };
let phase = "connecting", phaseT = 0, time = 0, level = 1, matchLeft = 300, transitT = -1;
let flashRed = 0, flashBlue = 0, debug = false, heartT = 0;
let particles = [], board = [], over = false;
const cam = { x: 0, y: 0, zoom: 1, target: 1, shake: 0 };
const roster = new Map(); // username → { num, look }

function frontierGate() { return L ? L.gates.find((g) => !g.open) || null : null; }
function member(name) {
  const r = roster.get(name) || {};
  return { name, num: r.num || 0, look: r.look || Art.makeLook(), bot: !!r.bot, x: 0, y: 0, tx: 0, ty: 0, face: 1, walk: rand(0, 10), moving: false,
    frozen: false, thaw: 0, inv: 0, on: true, freezeAnim: 0, isPlayer: name === me, fresh: true };
}
// build the world for a team, from floor 1, exactly as the server did
function buildFor(tm) {
  const t = teams[tm];
  watching = tm;
  kit = MazeWorld(seed, t.id);
  kit.newWorld(1, t.size);
  L = kit.L;
  team = t.members.map(member);
  player = team.find((m) => m.isPlayer) || null;
  monster.x = monster.tx = monster.y = monster.ty = -5000;
  particles = [];
  buildTeamChips();
  renderBoard();
}

Net.on("hello", (m) => {
  me = m.you; code = m.code; host = m.host;
  setKeyHints();
  if (m.stage === "lobby") { location.replace(`/play?code=${m.code}`); return; }
  history.replaceState(null, "", `/maze?code=${m.code}`);
});
Net.on("roster", (m) => {
  host = m.host;
  if (!isHost() && debug) { debug = false; updateDebugPanel(); }
  setKeyHints();
  roster.clear();
  for (const p of m.players) roster.set(p.n, { num: p.num, look: p.look, bot: p.bot });
  for (const a of team) { const r = roster.get(a.name); if (r) { a.num = r.num; a.look = r.look; a.bot = !!r.bot; } }
});
Net.on("mintro", (m) => {
  seed = m.seed; teams = m.teams; myTeam = m.you; matchLeft = m.ml;
  const spectator = myTeam < 0;
  buildFor(spectator ? clamp(watching, 0, teams.length - 1) : myTeam);
  const t = teams[watching];
  const others = t.members.filter((n) => n !== me);
  $("intro-text").innerHTML = spectator
    ? `You joined mid-match, so you're watching ${teams.length} team${teams.length === 1 ? "" : "s"}. You'll play the next round.`
    : `You're on <b>${escapeHtml(t.name)}</b>${others.length ? ` with ${others.map((n) => `<b>${escapeHtml(n)}</b>`).join(", ")}` : ", on your own"}. Deepest floor in ${Math.round(matchLeft / 60)} minutes wins.`;
  $("start").innerHTML = `<span>${spectator ? "Watch" : "Play"}</span>`;
  setKeyHints();
  // just your own team's card (the leaderboard shows everyone once you're in)
  const shown = spectator ? [] : [teams[myTeam]];
  Ui.teamCards($("intro-teams"), shown.map((x) => ({ name: x.name, color: x.color, members: x.members.map((n) => { const r = roster.get(n) || {}; return { num: r.num || 0, name: n, isPlayer: n === me, look: r.look }; }) })));
});
Net.on("M", (s) => {
  if (!teams.length) return;
  if (s.tm !== watching) buildFor(s.tm);
  // grow the shaft to match the server (each floor is generated from the seed, so it's identical)
  while (L.floors.length < s.nf) kit.appendFloor(L.floors[L.floors.length - 1].depth + 1);
  if (s.cur !== L.cur) {
    L.cur = s.cur;
    for (const fl of L.floors) if (fl.f < s.cur - 1) fl.canvas = null;
  }
  level = s.lv; phase = s.ph; phaseT = s.pt; matchLeft = s.ml; transitT = s.tr;
  // someone took over a bot: line the team up with the server's list again
  const names = s.m.map((x) => x[0]);
  if (names.join("\n") !== team.map((a) => a.name).join("\n")) {
    team = names.map((n) => team.find((a) => a.name === n) || member(n));
    player = team.find((a) => a.isPlayer) || null;
    if (teams[watching]) teams[watching].members = names;
    buildTeamChips();
  }
  L.transit = s.tr >= 0 ? { t: s.tr } : null;
  for (const [name, x, y, face, f, thaw] of s.m) {
    let a = team.find((m) => m.name === name);
    if (!a) { a = member(name); team.push(a); }
    if (a.fresh || Math.hypot(x - a.x, y - a.y) > 240) { a.x = x; a.y = y; a.fresh = false; }
    a.tx = x; a.ty = y; a.face = face; a.frozen = !!(f & 1); a.moving = !!(f & 2); a.inv = f & 4 ? 1 : 0; a.on = !!(f & 8); a.thaw = thaw;
  }
  const [mx, my, mode, mface, target] = s.mon;
  if (Math.hypot(mx - monster.x, my - monster.y) > 400) { monster.x = mx; monster.y = my; }
  monster.tx = mx; monster.ty = my; monster.mode = MODE_NAMES[mode] || "sleep"; monster.face = mface; monster.target = target;
  for (const gs of s.g) {
    const g = L.gates[gs.i]; if (!g) continue;
    g.open = !!gs.o; g.sealed = !!gs.s; g.spark = gs.sp; g.owners = gs.ow;
    gs.p.forEach(([power, press, occ, pulled, auto], k) => { const p = g.plates[k]; if (!p) return; p.power = power; p.press = press; p.occ = !!occ; p.pulled = pulled; p.auto = !!auto; });
    g.yours = g.plates.find((p, k) => gs.ow[k] === me) || null;
  }
  for (let i = 0; i < Math.max(0, L.cur - 1); i++) { L.gates[i].open = true; L.gates[i].sealed = true; }
});
Net.on("board", (m) => { board = m.teams; matchLeft = m.ml; renderBoard(); });
Net.on("ev", (e) => {
  const who = e.n ? team.find((m) => m.name === e.n) : null;
  const mine = e.n && e.n === me;
  const label = (n) => (n === me ? "YOU" : n.toUpperCase());
  switch (e.e) {
    case "lever": {
      const g = L.gates[e.g], p = g && g.plates[e.i];
      if (who) { Art.pose(who, "pull", 0.45); if (p) who.face = p.px >= who.x ? 1 : -1; }
      if (p) { if (nearCam(p.x, p.y)) Sfx.lever(); for (let n = 0; n < 8; n++) particles.push({ x: p.px, y: p.py + 14, vx: rand(-120, 120), vy: rand(-160, -40), g: 400, life: rand(0.3, 0.6), max: 0.6, s: rand(2, 4), c: "#b8ffd0" }); }
      break;
    }
    case "plate": {
      const p = L.gates[e.g] && L.gates[e.g].plates[e.i];
      if (p) { if (nearCam(p.x, p.y)) Sfx.click(); for (let n = 0; n < 8; n++) particles.push({ x: p.x, y: p.y - 6, vx: rand(-120, 120), vy: rand(-160, -40), g: 400, life: rand(0.3, 0.6), max: 0.6, s: rand(2, 4), c: "#b8ffd0" }); }
      break;
    }
    case "unclick": { const p = L.gates[e.g] && L.gates[e.g].plates[e.i]; if (p && nearCam(p.x, p.y)) Sfx.unclick(); break; }
    case "circuit": Sfx.circuit(); caption("CIRCUIT CLOSED!", "green", 1.2); break;
    case "gate": {
      const g = L.gates[e.g];
      Sfx.gate(); cam.shake = 10;
      caption("GATE OPEN!", "green", 1.8);
      if (g) for (let n = 0; n < 24; n++) particles.push({ x: tpos(g.tx) + rand(0, C), y: tpos(g.ty) + W / 2, vx: rand(-160, 160), vy: rand(-220, -40), g: 500, life: rand(0.5, 1), max: 1, s: rand(3, 6), c: g.color });
      for (const m of team) if (m.on && !m.frozen) Art.pose(m, "cheer", 1.1);
      break;
    }
    case "banish":
      for (let n = 0; n < 40; n++) particles.push({ x: e.x + rand(-50, 50), y: e.y - rand(0, 170), vx: rand(-160, 160), vy: rand(-200, 40), g: -40, life: rand(0.6, 1.3), max: 1.3, s: rand(8, 18), c: "rgba(26,14,46,0.8)" });
      Sfx.banish(); monster.x = monster.tx = monster.y = monster.ty = -5000;
      break;
    case "freeze":
      Sfx.freeze();
      if (who) { who.freezeAnim = 1; for (let n = 0; n < 18; n++) particles.push({ x: who.x + rand(-20, 20), y: who.y - rand(10, 80), vx: rand(-90, 90), vy: rand(-140, 20), g: 260, life: rand(0.5, 1.1), max: 1.1, s: rand(2.5, 5), c: "#bfeaff" }); }
      if (mine) { flashBlue = 0.55; cam.shake = 14; caption("FROZEN", "", 2); } else caption(`${label(e.n)} FROZE`, "", 1.4);
      break;
    case "thaw":
      Sfx.thaw();
      if (who) for (let n = 0; n < 14; n++) particles.push({ x: who.x + rand(-18, 18), y: who.y - rand(10, 80), vx: rand(-60, 60), vy: rand(-120, -20), g: 200, life: rand(0.4, 0.8), max: 0.8, s: rand(2, 4), c: "#7fd8ff" });
      caption(mine ? "THAWED!" : `${label(e.n)} IS BACK`, "green", 1.2);
      break;
    case "spotted": Sfx.spotted(); if (mine) { caption("IT SEES YOU", "red", 1.2); flashRed = 0.25; } break;
    case "gaveup": caption("IT GAVE UP… FOR NOW", "", 1.4); break;
    case "tele":
      if (who) for (let k = 0; k < 10; k++) particles.push({ x: who.x + rand(-16, 16), y: who.y - rand(0, 70), vx: rand(-60, 60), vy: rand(-90, -10), life: 0.6, max: 0.6, s: rand(3, 6), c: "#fff7c2" });
      if (mine) { caption("TELEPORTED!", "", 1.4); flashBlue = 0.3; }
      break;
    case "floor":
      caption(`FLOOR ${e.lv}`, "green", 2); Sfx.win();
      if (e.lv === 2) sub("Something is down here with you…");
      for (const m of team) m.fresh = true; // snap, don't slide, into the new floor
      break;
    case "allfrozen": caption("EVERYONE FROZE", "red", 2.6); Sfx.lose(); break;
    case "again": caption("GO AGAIN", "", 1.6); for (const m of team) m.fresh = true; break;
    case "back": if (!mine) caption(`${label(e.n)} IS BACK`, "", 1.2); break;
    case "replaced":
      for (const t of teams) t.members = t.members.map((n) => (n === e.bot ? e.n : n));
      caption(e.n === me ? "YOU TOOK OVER A BOT" : `${e.n.toUpperCase()} TOOK OVER ${e.bot.toUpperCase()}`, "green", 1.8);
      break;
    default: break;
  }
});
Net.on("over", (m) => {
  over = true; phase = "over";
  const rows = m.board, win = rows[0];
  const mineT = rows.find((t) => t.id === myTeam);
  const place = mineT ? rows.indexOf(mineT) + 1 : 0;
  const mz = (n) => `${n} floor${n === 1 ? "" : "s"}`;
  const tie = rows.length > 1 && rows[1].levels === win.levels;
  $("over-text").innerHTML = win ? `<b>${escapeHtml(win.name)}</b> wins with ${mz(win.levels)}${tie ? ", and got there first" : ""}.` + (mineT ? ` Your team came #${place} with ${mz(mineT.levels)}.` : "") : "";
  $("board-final").innerHTML = rows.map((t, k) => `<div class="brow${t.id === myTeam ? " mine" : ""}"><span>#${k + 1}</span><span class="dot" style="background:${escapeHtml(t.color)}"></span><span>${escapeHtml(t.name)} <small>${t.members.map(escapeHtml).join(" · ")}</small></span><span class="lv">${t.levels}</span></div>`).join("");
  $("over").classList.remove("hidden");
  Sfx.win();
  let left = 14;
  const tick = () => { $("again-count").textContent = `Back to the lobby in ${left}…`; if (left-- > 0) setTimeout(tick, 1000); };
  tick();
});
Net.on("lost", (why) => {
  if (why === "elsewhere") { $("lost").classList.remove("hidden"); }
  else if (why === "retry") sub("Connection lost. Reconnecting…");
});
const nearCam = (x, y) => Math.hypot(x - cam.x, y - cam.y) < 900;

// the key hints; G (the algorithm view) is only listed for the host
function setKeyHints() {
  const spectator = teams.length > 0 && myTeam < 0, g = isHost() ? " <kbd>G</kbd> algorithms" : "";
  $("controls").innerHTML = (spectator ? "<kbd>Q</kbd><kbd>E</kbd> switch team" : "<kbd>WASD</kbd> move <kbd>E</kbd> pull lever") + g;
  $("intro-keys").innerHTML = (spectator ? "<kbd>Q</kbd><kbd>E</kbd> switch team" : "<kbd>WASD</kbd> move <kbd>E</kbd> pull") + g + " <kbd>WHEEL</kbd> zoom";
}

// ---------------------------------------------------------------- HUD
let capT = 0;
function caption(text, color, dur = 1.8) {
  const el = $("caption");
  el.textContent = text; el.className = ""; void el.offsetWidth;
  if (color) el.classList.add(color);
  if (text) el.classList.add("pop");
  capT = dur;
}
let lastSub = "";
function sub(text) { if (text !== lastSub) { $("sub").textContent = text; lastSub = text; } }
let chipState = [];
function buildTeamChips() {
  chipState = [];
  $("team").innerHTML = team.map((m, n) => `<div class="chip${m.isPlayer ? " you" : ""}" id="chip${n}"><b>${String(m.num).padStart(2, "0")}</b><i>${escapeHtml(m.name)}</i><span></span></div>`).join("");
}
function updateInfo() {
  const t = teams[watching];
  if (!t || !L) return;
  $("me").textContent = player ? me : "WATCHING";
  const here = L.gates[L.cur];
  $("lvl").textContent = `floor ${level} · ${here.plates.length} ${here.kind}${here.plates.length === 1 ? "" : "s"}`;
  $("lives").innerHTML = `<span style="color:${escapeHtml(t.color)}">●</span> ${escapeHtml(t.name)}`;
  const g = frontierGate();
  team.forEach((m, n) => {
    const mineP = g && g.owners ? g.plates.find((p, k) => g.owners[k] === m.name) : null;
    const st = !m.on ? "off" : m.frozen ? "frozen" : mineP && (mineP.power > 0 || nearStation(m, mineP)) ? "plate" : "";
    const label = !m.on ? "away" : m.frozen ? (m.thaw > 0.05 ? `thawing ${Math.round(m.thaw * 100)}%` : "FROZEN") : st === "plate" ? (g.kind === "lever" ? "at a lever" : "at a plate") : m.isPlayer ? "you" : "";
    const key = st + label + m.num;
    if (chipState[n] === key) return;
    chipState[n] = key;
    const el = $(`chip${n}`); if (!el) return;
    el.className = `chip${m.isPlayer ? " you" : ""}${st ? " " + st : ""}`;
    el.querySelector("b").textContent = String(m.num).padStart(2, "0");
    el.querySelector("span").textContent = label;
  });
}
function renderBoard() {
  if (!board.length) return;
  $("board").innerHTML = "<h3>Floors cleared</h3>" + board.map((t, k) => {
    const cls = (t.id === myTeam ? " mine" : "") + (t.id === watching && myTeam < 0 ? " watch" : "");
    return `<div class="brow${cls}" data-n="${t.id}"><span>${k + 1}</span><span class="dot" style="background:${escapeHtml(t.color)}"></span><span>${escapeHtml(t.name)}<small>on floor ${t.level} · ${t.members.map(escapeHtml).join(", ")}</small></span><span class="lv">${t.levels}</span></div>`;
  }).join("");
}
let miniH = 0;
function layoutBoard() { $("board").style.top = `${Math.round(18 + miniH + 22)}px`; }
// the lever you're standing at, if any (the server decides; this just shows the E prompt)
function leverHere() {
  if (!player || player.frozen || phase !== "play" || !L) return null;
  const g = frontierGate();
  if (!g || g.kind !== "lever") return null;
  let best = null, bd = 64;
  for (const p of g.plates) { const d = Math.hypot(player.x - p.x, player.y - p.y); if (d < bd) { bd = d; best = p; } }
  return best;
}
const belowGate = (m) => L.floors[L.cur + 1] && m.y > L.floors[L.cur + 1].row0 * P + W + 14 + 4;
function hint() {
  if (phase === "over" || !L || !started) return;
  const g = frontierGate();
  if (!g) return;
  if (player && phaseT > 2.5 && phase === "play") {
    if (g.kind === "lever") Ui.tip("lever", "Levers", "Press <kbd>E</kbd> at your lever. It springs back after a few seconds.", "lever", "#ffb000");
    else Ui.tip("plate", "Pressure plates", "Step on, then off. It only fires once per step.", "plate", "#ff6f86");
  }
  if (player && team.some((m) => m.on && m.frozen && m !== player)) Ui.tip("thaw", "Frozen!", "Stand next to a frozen teammate to thaw them.", "shadow", "#6cc6ff");
  if (!player) { $("spec").classList.remove("hidden"); $("spec").innerHTML = `Watching <b>${escapeHtml(teams[watching].name)}</b> · <kbd>Q</kbd> <kbd>E</kbd> switch team`; }
  else $("spec").classList.add("hidden");
  const down = g.f > L.cur;
  if (phase === "allfrozen") { sub("Everyone froze. 5 second penalty, then back to the top of this floor."); return; }
  if (!player) { sub(down ? "Gate's open. Heading down…" : `${g.plates.filter((p) => p.power > 0).length} / ${g.plates.length} lights green`); return; }
  if (player.frozen) { sub("Frozen! Wait for a teammate to thaw you."); return; }
  if (down) {
    const left = Math.max(0, Math.ceil(WALK_TIME - Math.max(0, transitT)));
    sub(belowGate(player) ? `Waiting for the others… (${left}s)` : `Head down through the gate! Teleport in ${left}s`);
    return;
  }
  if (g.spark > 0) { sub(""); return; }
  const n = g.plates.length, live = g.plates.filter((p) => p.power > 0).length;
  const mine = g.yours, lever = g.kind === "lever";
  const verb = lever ? "Pull your lever" : "Step on your plate";
  if (!mine) { sub(`${live} / ${n} green. Every station has someone on it: help them, and watch for the Watcher.`); return; }
  if (mine.power > 0) { sub(`${live} / ${n} green. Hold on...`); return; }
  const nearMine = Math.hypot(player.x - mine.x, player.y - mine.y) < (lever ? 64 : 160);
  if (live > 0) { sub(nearMine ? `${verb} NOW!` : `${live} / ${n} green! Hurry to your ${lever ? "lever" : "plate"}!`); return; }
  if (!nearMine) { sub(`Follow the arrow to your ${lever ? "lever" : "plate"}.`); return; }
  const others = g.plates.filter((p) => p !== mine && !p.auto);
  const ready = others.every((p) => team.some((m) => m.on && !m.frozen && m !== player && nearStation(m, p)));
  sub(others.length === 0 ? `${verb}${lever ? " (E)" : ""}!` : ready ? `Everyone's ready. ${verb}${lever ? " (E)" : ""}!` : "Wait for the others to reach theirs, then go together.");
}

// ---------------------------------------------------------------- update (drawing only)
function update(dt) {
  time += dt; phaseT += dt;
  if (capT > 0) { capT -= dt; if (capT <= 0) caption(""); }
  flashRed = Math.max(0, flashRed - dt * 1.4);
  flashBlue = Math.max(0, flashBlue - dt * 1.4);
  cam.shake = Math.max(0, cam.shake - dt * 30);
  if (!L) return;
  if (!over) matchLeft = Math.max(0, matchLeft - dt);
  const k = 1 - Math.exp(-dt * 16);
  for (const a of team) {
    const ox = a.x, oy = a.y;
    a.x += (a.tx - a.x) * k; a.y += (a.ty - a.y) * k;
    const sp = Math.hypot(a.x - ox, a.y - oy) / Math.max(dt, 1e-3);
    if (sp > 20) a.walk += dt * (sp / 215);
    a.freezeAnim = Math.max(0, (a.freezeAnim || 0) - dt * 2);
  }
  monster.x += (monster.tx - monster.x) * k; monster.y += (monster.ty - monster.y) * k;
  monster.t += dt;
  monsterSmoke(dt);
  for (const g of L.gates) g.anim = clamp((g.anim || 0) + (g.open && !g.sealed ? dt * 1.8 : -dt * 3), 0, 1);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.life -= dt; }
  particles = particles.filter((p) => p.life > 0);
  explore();
  const target = focus();
  if (target) {
    cam.x = lerp(cam.x, target.x, 1 - Math.pow(0.002, dt));
    cam.y = lerp(cam.y, target.y - 30, 1 - Math.pow(0.002, dt));
  }
  cam.zoom = lerp(cam.zoom, baseZoom() * cam.target, 1 - Math.pow(0.01, dt));
  if (player && phase === "play" && monster.mode !== "sleep" && monster.x > -1000) {
    const md = Math.hypot(monster.x - player.x, monster.y - player.y);
    if (md < 520) { heartT -= dt; if (heartT <= 0) { Sfx.heartbeat(); heartT = lerp(0.42, 1.3, md / 520); } }
  }
  // the bar shows how long the earliest light has left (or the walk down)
  const g = frontierGate();
  if (L.transit) {
    $("bar").classList.remove("hidden");
    $("bar-fill").style.width = `${Math.round(clamp(1 - L.transit.t / WALK_TIME, 0, 1) * 100)}%`;
    $("bar-fill").style.backgroundColor = "#1fae95";
  } else if (g) {
    const live = g.plates.filter((p) => p.power > 0 && !p.auto);
    $("bar").classList.toggle("hidden", !live.length && !(g.spark > 0));
    const left = g.spark > 0 ? 1 : live.length ? Math.min(...live.map((p) => p.power)) : 0;
    $("bar-fill").style.width = `${Math.round(left * 100)}%`;
    $("bar-fill").style.backgroundColor = g.spark > 0 ? "#48e28a" : live.length === g.plates.length - 1 ? "#ff8a3d" : "#ffd23f";
  }
  if (Math.floor(time * 4) !== Math.floor((time - dt) * 4)) updateInfo();
  const s = Math.max(0, Math.ceil(matchLeft));
  $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  $("clock").classList.toggle("low", s <= 30);
  hint();
}
function focus() { return (player && player.on ? player : null) || team.find((m) => m.on && !m.frozen) || team.find((m) => m.on) || team[0]; }
function explore() {
  const f = focus(); if (!f || !L) return;
  const [ci, cj] = cellOf(f);
  L.explored[cidx(ci, cj)] = 1;
  kit.neighbors(ci, cj, true, nbBuf);
  for (let n = 0; n < nbBuf.length; n += 2) L.explored[cidx(nbBuf[n], nbBuf[n + 1])] = 1;
}

// ---------------------------------------------------------------- rendering
let renderScale = Math.min(devicePixelRatio || 1, 2);
const perf = { n: 0, t: 0 };
function adaptQuality(dt) {
  perf.n++; perf.t += dt;
  if (perf.t < 1.5) return;
  const fps = perf.n / perf.t; perf.n = 0; perf.t = 0;
  if (fps < 48 && renderScale > 0.75) renderScale = Math.max(0.75, renderScale >= 1.5 ? 1 : renderScale - 0.25);
}
function baseZoom() { return clamp(Math.min(innerHeight / 950, innerWidth / 1400), 0.45, 1.5); }

// each floor is pre-rendered to its own canvas when it first comes into view
function floorCanvas(fl) {
  const y0 = fl.row0 * P, h = fl.rows * P + W, x1 = L.worldW;
  const c = document.createElement("canvas");
  c.width = x1; c.height = h;
  const g = c.getContext("2d");
  g.translate(0, -y0);
  const st = STYLES[(fl.depth - 1) % STYLES.length];
  g.fillStyle = st.floor; g.fillRect(0, y0, x1, h);
  g.fillStyle = st.alt;
  if (st.pat === "check") {
    const q = 44;
    for (let y = y0 - (y0 % q); y < y0 + h; y += q) for (let x = 0; x < x1; x += q) if (((x / q) + (y / q)) % 2 === 0) g.fillRect(x, y, q, q);
  } else if (st.pat === "wood") {
    const hh = 30;
    for (let y = y0 - (y0 % hh), r = 0; y < y0 + h; y += hh, r++) {
      if (r % 2) g.fillRect(0, y, x1, hh);
      g.fillStyle = "rgba(120,70,30,0.18)";
      for (let x = (r * 97) % 160; x < x1; x += 160) g.fillRect(x, y, 3, hh);
      g.fillRect(0, y, x1, 2);
      g.fillStyle = st.alt;
    }
  } else {
    for (let y = y0 - (y0 % 26) + 12; y < y0 + h; y += 26) for (let x = ((y / 26) % 2) * 13; x < x1; x += 26) { g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill(); }
  }
  // a few rugs
  if (IMG.rug) for (let n = 0; n < L.COLS * fl.rows * 0.08; n++) {
    const i = Math.floor(Math.random() * L.COLS), j = fl.row0 + Math.floor(Math.random() * fl.rows);
    if (fl.gate.plates.some((p) => p.i === i && p.j === j)) continue;
    g.globalAlpha = 0.9; g.drawImage(IMG.rug, ccx(i) - 70, ccx(j) - 60, 140, 120); g.globalAlpha = 1;
  }
  // soft contact shadow under every wall
  g.save();
  g.shadowColor = "rgba(20,10,40,0.55)"; g.shadowBlur = 22; g.shadowOffsetY = 10;
  g.fillStyle = "#2a2140";
  for (let ty = 2 * fl.row0; ty <= Math.min(L.TH - 1, 2 * (fl.row0 + fl.rows)); ty++) for (const r of L.runs[ty]) g.fillRect(tpos(r.a), tpos(ty), tpos(r.b) + tlen(r.b) - tpos(r.a), tlen(ty));
  g.restore();
  return c;
}

let view = { x0: 0, y0: 0, x1: 0, y1: 0 };
function render() {
  const vw = innerWidth, vh = innerHeight;
  if (vw < 2 || vh < 2 || !L) return;
  const dpr = renderScale;
  if (canvas.width !== Math.floor(vw * dpr) || canvas.height !== Math.floor(vh * dpr)) { canvas.width = Math.floor(vw * dpr); canvas.height = Math.floor(vh * dpr); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0d0a1f"; ctx.fillRect(0, 0, canvas.width, canvas.height);

  const z = cam.zoom, sh = cam.shake ? rand(-cam.shake, cam.shake) * 0.5 : 0;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (vw / 2 - cam.x * z + sh), dpr * (vh / 2 - cam.y * z + sh));
  view = { x0: cam.x - vw / 2 / z - 60, x1: cam.x + vw / 2 / z + 60, y0: cam.y - vh / 2 / z - 60, y1: cam.y + vh / 2 / z + 200 };
  ctx.imageSmoothingQuality = "high";
  for (const fl of L.floors) {
    const y0 = fl.row0 * P;
    if (y0 > view.y1 || y0 + fl.rows * P + W < view.y0) continue;
    if (!fl.canvas) fl.canvas = floorCanvas(fl);
    ctx.drawImage(fl.canvas, 0, y0);
  }

  for (const g of L.gates) for (const p of g.plates) if (p.kind === "plate" && inView(p.x, p.y, 60)) Art.drawPlate(ctx, p.x, p.y, { color: g.color, press: p.press, live: p.power > 0 && !g.open, open: g.open, ready: !g.open && p.power <= 0 && plateReady(p) });
  // shadows under people
  ctx.fillStyle = "rgba(20,10,40,0.28)";
  for (const a of crew) { ctx.beginPath(); ctx.ellipse(a.x, a.y, 15, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  for (const f of crew) if (f.frozen) drawThawRing(f);

  const list = [];
  for (let ty = 0; ty < L.TH; ty++) {
    const y1 = tpos(ty) + tlen(ty);
    if (y1 < view.y0 - 40 || tpos(ty) - WALL_H > view.y1) continue;
    list.push({ y: y1 - 0.5, d: () => drawWallRow(ty) });
  }
  for (const g of L.gates) list.push({ y: tpos(g.ty) + tlen(g.ty) - 0.4, d: () => drawGate(g) });
  for (const g of L.gates) for (const p of g.plates) if (inView(p.px, p.py, 80)) list.push({ y: p.j * P + W + 0.2, d: () => drawStation(g, p) });
  for (const p of L.props) if (p.x > view.x0 && p.x < view.x1 && p.y > view.y0 && p.y < view.y1) list.push({ y: p.y, d: () => drawProp(p) });
  for (const a of crew) list.push({ y: a.y, d: () => drawPerson(a) });
  list.push({ y: monster.y, d: drawMonster });
  list.sort((p, q) => p.y - q.y);
  for (const it of list) it.d();

  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawPlateMarkers();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLight(vw, vh, z);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (vw / 2 - cam.x * z + sh), dpr * (vh / 2 - cam.y * z + sh));
  drawGlows();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (debug) {
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (vw / 2 - cam.x * z), dpr * (vh / 2 - cam.y * z));
    drawDebug();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if (phase !== "title") drawMinimap(vw);
}

function drawWallRow(ty) {
  const y0 = tpos(ty), y1 = y0 + tlen(ty);
  const sol = (tx, yy) => yy >= 0 && yy < L.TH && tx >= 0 && tx < L.TW && (L.solid[yy * L.TW + tx] === 1 || L.gateAt[yy * L.TW + tx] >= 0);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const r of L.runs[ty]) {
    const X0 = tpos(r.a), X1 = tpos(r.b) + tlen(r.b);
    if (X1 < view.x0 || X0 > view.x1) continue;
    const st = STYLES[r.sec % STYLES.length];
    // front faces where the tile below is open floor
    ctx.fillStyle = st.front;
    ctx.beginPath();
    for (let tx = r.a; tx <= r.b; tx++) if (!sol(tx, ty + 1)) ctx.rect(tpos(tx) - 0.5, y1 - WALL_H, tlen(tx) + 1, WALL_H);
    ctx.fill();
    // top face
    ctx.fillStyle = st.top;
    ctx.fillRect(X0, y0 - WALL_H, X1 - X0, y1 - y0);
    // outline
    ctx.strokeStyle = INK; ctx.lineWidth = 3.2;
    ctx.beginPath();
    if (!sol(r.a - 1, ty)) { ctx.moveTo(X0, y0 - WALL_H); ctx.lineTo(X0, y1 - (sol(r.a, ty + 1) ? WALL_H : 0)); }
    if (!sol(r.b + 1, ty)) { ctx.moveTo(X1, y0 - WALL_H); ctx.lineTo(X1, y1 - (sol(r.b, ty + 1) ? WALL_H : 0)); }
    for (let tx = r.a; tx <= r.b; tx++) {
      const a = tpos(tx), b = a + tlen(tx);
      if (!sol(tx, ty - 1)) { ctx.moveTo(a, y0 - WALL_H); ctx.lineTo(b, y0 - WALL_H); }
      if (!sol(tx, ty + 1)) {
        ctx.moveTo(a, y1 - WALL_H); ctx.lineTo(b, y1 - WALL_H);
        ctx.moveTo(a, y1); ctx.lineTo(b, y1);
        if (sol(tx - 1, ty + 1) && tx > r.a) { ctx.moveTo(a, y1 - WALL_H); ctx.lineTo(a, y1); }
        if (sol(tx + 1, ty + 1) && tx < r.b) { ctx.moveTo(b, y1 - WALL_H); ctx.lineTo(b, y1); }
      }
    }
    ctx.stroke();
    // rim highlight
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    for (let tx = r.a; tx <= r.b; tx++) if (!sol(tx, ty - 1)) ctx.fillRect(tpos(tx), y0 - WALL_H + 2, tlen(tx), 5);
  }
}

// the gate's lights sit on the lintel of a door frame built into the wall
const FRAME_H = WALL_H + 30;
const gateSign = (g) => [tpos(g.tx) + C / 2, tpos(g.ty) + W - FRAME_H];
function drawGate(g) {
  const x0 = tpos(g.tx), y0 = tpos(g.ty), w = C, h = W;
  if (x0 > view.x1 || x0 + w < view.x0 || y0 - 120 > view.y1 || y0 + h < view.y0) return;
  const k = 1 - g.anim, hgt = WALL_H * k;
  if (k > 0.01) {
    // a striped barrier block in the wall that sinks into the floor when the gate opens
    ctx.fillStyle = g.color; ctx.fillRect(x0, y0 - hgt, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 + h - hgt, w, hgt); ctx.clip();
    ctx.fillStyle = g.color; ctx.fillRect(x0, y0 + h - hgt, w, hgt);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x0, y0 + h - hgt, w, hgt);
    ctx.fillStyle = INK;
    for (let x = x0 - 40; x < x0 + w; x += 34) { ctx.beginPath(); ctx.moveTo(x, y0 + h); ctx.lineTo(x + 18, y0 + h - hgt); ctx.lineTo(x + 32, y0 + h - hgt); ctx.lineTo(x + 14, y0 + h); ctx.fill(); }
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 3.2;
    ctx.strokeRect(x0, y0 - hgt, w, h);
    if (hgt > 1) ctx.strokeRect(x0, y0 + h - hgt, w, hgt);
  } else {
    // open: a dark stairwell going down
    ctx.fillStyle = "rgba(10,6,24,0.55)"; ctx.fillRect(x0 + 6, y0 + 2, w - 12, h - 4);
  }
  if (g.sealed) return;
  // door frame: two posts standing on the floor at the edges of the doorway, a lintel across
  // the top, and the circuit's lights mounted on the lintel
  const [sx, sy] = gateSign(g), y1 = y0 + h;
  ctx.lineJoin = "round";
  for (const px of [x0 - 3, x0 + w - 9]) {
    ctx.fillStyle = "#3a3450"; ctx.fillRect(px, sy, 12, y1 - sy);
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(px + 2, sy, 3, y1 - sy);
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeRect(px, sy, 12, y1 - sy);
  }
  ctx.beginPath(); roundRect(x0 - 10, sy - 10, w + 20, 20, 5);
  ctx.fillStyle = "#3a3450"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = g.color; ctx.fillRect(x0 - 8, sy - 8, w + 16, 4);
  Art.drawPanel(ctx, sx, sy, panelState(g, -1));
}

function panelState(g, mine) {
  return {
    n: g.plates.length, color: g.color, mine,
    lit: g.plates.map((p) => g.open || p.power > 0),
    ready: g.plates.map((p) => !g.open && p.power <= 0 && plateReady(p)),
    flash: g.spark > 0 ? g.spark : 0,
  };
}
// a station: its light panel on the wall (or on a post if that wall is a doorway), with the lever
function drawStation(g, p) {
  const ps = panelState(g, p.idx);
  ps.lever = p.kind === "lever" ? p.pulled : null;
  const { h } = Art.panelSize(ps.n, p.kind === "lever");
  if (!p.wall) {
    ctx.fillStyle = "#3a3450"; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); Art.rr(ctx, p.px - 5, p.py, 10, p.j * P + W + 18 - p.py, 3); ctx.fill(); ctx.stroke();
  }
  Art.drawPanel(ctx, p.px, p.py, ps);
  // "E" prompt when you can pull this one
  if (p.kind === "lever" && leverHere() === p && p.power <= 0 && !g.open && !(g.spark > 0)) {
    const y = p.py - h / 2 - 26 + Math.sin(time * 6) * 2;
    ctx.save(); ctx.translate(p.px, y);
    ctx.beginPath(); Art.rr(ctx, -15, -15, 30, 28, 6); ctx.fillStyle = "#fbf6ec"; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK; ctx.font = "22px 'Luckiest Guy', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("E", 0, 1);
    ctx.restore();
  }
}
// someone is waiting at this station (and not standing on its plate)
// someone is at this station, ready to go: next to a lever, or anywhere near a plate without
// standing on it (standing on it fires it)
function nearStation(m, p) {
  if (p.kind === "lever") return Math.hypot(m.x - p.rx, m.y - p.ry) < 60;
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  return d < 120 && d >= 38;
}
function plateReady(p) { return crew.some((m) => !m.frozen && nearStation(m, p)); }
const inView = (x, y, m) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;
// the station lights glow in the dark: drawn after the lighting pass
function drawGlows() {
  for (const g of L.gates) {
    if (g.sealed) continue;
    for (const p of g.plates) if (inView(p.px, p.py, 60)) Art.drawPanelGlow(ctx, p.px, p.py, Object.assign(panelState(g, p.idx), { lever: p.kind === "lever" ? 1 : null }));
    const [sx, sy] = gateSign(g);
    if (!g.sealed && inView(sx, sy, 60)) Art.drawPanelGlow(ctx, sx, sy, panelState(g, -1));
  }
}

function drawPlateMarkers() {
  const g = frontierGate();
  if (!g || !g.yours || phase !== "play" || !player) return;
  if (g.f > L.cur) {
    const og = L.gates[L.cur], x = tpos(og.tx) + C / 2, y = tpos(og.ty) - 30 + Math.sin(time * 5) * 6;
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.moveTo(-16, -18); ctx.lineTo(16, -18); ctx.lineTo(0, 6); ctx.closePath();
    ctx.fillStyle = "#48e28a"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    return;
  }
  const p = g.yours;
  if ((p.occ && Math.hypot(player.x - p.x, player.y - p.y) < 40) || (g.kind === "lever" && leverHere() === p)) return;
  const { h } = Art.panelSize(g.plates.length, g.kind === "lever");
  const y = p.py - h / 2 - 22 + Math.sin(time * 5) * 6;
  ctx.save(); ctx.translate(p.px, y);
  ctx.beginPath(); ctx.moveTo(-14, -16); ctx.lineTo(14, -16); ctx.lineTo(0, 4); ctx.closePath();
  ctx.fillStyle = "#ffd23f"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
  ctx.save(); ctx.translate(p.x, p.y + 4);
  ctx.setLineDash([10, 8]); ctx.lineDashOffset = -time * 30;
  ctx.beginPath(); ctx.ellipse(0, 0, g.kind === "lever" ? 34 : 50, g.kind === "lever" ? 16 : 36, 0, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = "#ffd23f"; ctx.stroke();
  ctx.restore();
}
function drawThawRing(f) {
  if (f.thaw <= 0.01) return;
  ctx.beginPath(); ctx.ellipse(f.x, f.y + 2, 40, 18, 0, -Math.PI / 2, -Math.PI / 2 + f.thaw * Math.PI * 2);
  ctx.lineWidth = 6; ctx.strokeStyle = "#7fd8ff"; ctx.stroke();
}

function drawProp(p) {
  const im = IMG[p.key]; if (!im) return;
  const w = im.width * p.s, h = im.height * p.s;
  ctx.drawImage(im, p.x - w / 2, p.y - h + 6, w, h);
}

// people are drawn by the shared rig in art.js; here we only add the maze-specific state
function drawPerson(a) {
  if (a.x < view.x0 || a.x > view.x1 || a.y < view.y0 || a.y > view.y1) return;
  const near = monster.mode === "hunt" && dist(a, monster) < 380;
  const onPlate = L.gates.some((g) => g.plates.some((p) => (p.occ && Math.hypot(a.x - p.x, a.y - p.y) < 40) || (p.kind === "lever" && p.power > 0 && Math.hypot(a.x - p.x, a.y - p.y) < 64)));
  Art.drawPerson(ctx, a, {
    t: time, scared: a.frozen || near || a.fleeT > 0, happy: onPlate, frozen: a.frozen, thaw: a.thaw,
    shake: a.freezeAnim, number: String(a.num).padStart(2, "0"),
  });
  drawNameTag(a);
  if (a.isPlayer && phase !== "title") {
    const y = a.y - 134 + Math.sin(time * 4) * 3;
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

// The monster is the Watcher from the lobby: the calm photo while it wanders, the red-eyed one
// while it hunts. (Falls back to the smoke shadow sprite if the photos are missing.)
function monSprite() {
  const hunting = monster.mode === "hunt";
  const face = hunting ? IMG.watcher_chase : IMG.watcher_calm;
  if (face) return { im: face, s: 0.34, eyes: [{ x: -52, y: -327 }, { x: 64, y: -325 }], base: 26 };
  return { im: hunting ? IMG.shadow_hunt || IMG.shadow : IMG.shadow, s: 0.25, eyes: [{ x: 217.6 - 246.5, y: 119.3 - 724 }, { x: 268.6 - 246.5, y: 120.7 - 724 }], base: 22 };
}
function monsterBob() { return Math.sin(monster.t * 2.2) * 5; }
function drawMonster() {
  const M = monster;
  if (M.x < view.x0 - 140 || M.x > view.x1 + 140 || M.y < view.y0 - 100 || M.y > view.y1 + 260) return;
  const hunting = M.mode === "hunt", sp = monSprite();
  ctx.save();
  ctx.translate(M.x, M.y + monsterBob());
  // a pool of smoke under it
  ctx.fillStyle = "rgba(15,8,30,0.6)";
  ctx.beginPath(); ctx.ellipse(0, 12, 58, 18, 0, 0, Math.PI * 2); ctx.fill();
  if (M.mode === "sleep") ctx.globalAlpha = 0.55 + Math.sin(M.t * 1.5) * 0.15;
  if (sp.im) {
    const w = sp.im.width * sp.s, h = sp.im.height * sp.s;
    const sx = 1 + Math.sin(M.t * 3) * 0.03, sy = 1 + Math.cos(M.t * 2.5) * 0.03 + (hunting ? 0.05 : 0);
    ctx.scale(sx, sy);
    ctx.drawImage(sp.im, -w / 2, -h + sp.base, w, h);
  }
  ctx.restore();
  if (M.mode === "sleep" && phase === "play") {
    ctx.font = "24px 'Luckiest Guy', sans-serif"; ctx.textAlign = "center";
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.fillStyle = "#fff";
    const t = (M.t % 2) / 2;
    ctx.globalAlpha = 1 - t;
    ctx.strokeText("z", M.x + 50 + t * 20, M.y - 190 - t * 40); ctx.fillText("z", M.x + 50 + t * 20, M.y - 190 - t * 40);
    ctx.globalAlpha = 1;
  }
}
// smoke trailing off it while it moves
function monsterSmoke(dt) {
  const M = monster;
  if (M.x < -1000 || M.mode === "sleep" || Math.random() > dt * 14) return;
  particles.push({ x: M.x + rand(-34, 34), y: M.y + rand(0, 14), vx: rand(-20, 20), vy: rand(-50, -15), life: rand(0.5, 0.9), max: 0.9, s: rand(7, 13), c: "rgba(26,14,46,0.75)" });
}

// lighting: a dark maze, warm halo around each person, lamps, coloured plates, red when hunted
const light = document.createElement("canvas");
function drawLight(vw, vh, z) {
  const sc = 0.33, lw = Math.ceil(vw * sc), lh = Math.ceil(vh * sc);
  if (light.width !== lw || light.height !== lh) { light.width = lw; light.height = lh; }
  const g = light.getContext("2d");
  const title = phase === "title";
  g.globalCompositeOperation = "source-over";
  g.fillStyle = title ? "rgb(120,108,170)" : "rgb(46,38,84)"; g.fillRect(0, 0, lw, lh);
  g.globalCompositeOperation = "lighter";
  const S = (x, y) => [((x - cam.x) * z + vw / 2) * sc, ((y - cam.y) * z + vh / 2) * sc];
  const glow = (x, y, r, rgb, k) => {
    const [sx, sy] = S(x, y), rr = r * z * sc;
    if (sx < -rr || sy < -rr || sx > lw + rr || sy > lh + rr || k <= 0.01) return;
    const grd = g.createRadialGradient(sx, sy, 0, sx, sy, rr);
    grd.addColorStop(0, `rgba(${rgb},${k})`); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
  for (const a of crew) {
    if (a.frozen) glow(a.x, a.y - 40, 140, "120,200,255", 0.45);
    else glow(a.x, a.y - 40, a.isPlayer ? 380 : 210, "255,236,200", a.isPlayer ? 0.85 : 0.5);
  }
  for (const l of L.lamps) glow(l.x, l.y - 70, 260, "255,200,120", 0.55);
  for (const gt of L.gates) {
    for (const p of gt.plates) glow(p.px, p.py + 40, 120 + p.power * 60, p.power > 0 ? "120,255,170" : hex(gt.color), gt.open ? 0.06 : 0.2 + p.power * 0.45);
    if (gt.sealed) continue;
    const [gx, gy] = gateSign(gt);
    glow(gx, gy, 120, gt.open ? "72,226,138" : hex(gt.color), 0.35);
    if (gt.open) glow(gx, tpos(gt.ty) + W, 200, "72,226,138", 0.35);
  }
  glow(monster.x, monster.y - 90, 200, monster.mode === "hunt" ? "255,50,60" : "110,90,200", monster.mode === "hunt" ? 0.45 : 0.18);
  g.globalCompositeOperation = "multiply";
  const vg = g.createRadialGradient(lw / 2, lh / 2, Math.min(lw, lh) * 0.3, lw / 2, lh / 2, Math.max(lw, lh) * 0.72);
  vg.addColorStop(0, "#ffffff"); vg.addColorStop(1, "#5a4a8a");
  g.fillStyle = vg; g.fillRect(0, 0, lw, lh);
  ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.drawImage(light, 0, 0, vw, vh); ctx.restore();

  // when it hunts, its red eyes glow through the dark
  const hunting = monster.mode === "hunt";
  if (hunting) {
    const sp = monSprite();
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const e of sp.eyes) {
      const x = (monster.x + e.x * sp.s - cam.x) * z + vw / 2, y = (monster.y + monsterBob() + e.y * sp.s + sp.base - cam.y) * z + vh / 2;
      const r = 22 * z, pulse = 0.75 + Math.sin(time * 9) * 0.25;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, hunting ? `rgba(255,40,40,${0.9 * pulse})` : "rgba(110,255,240,0.6)"); grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }
  if (flashRed > 0) { ctx.fillStyle = `rgba(255,40,60,${flashRed})`; ctx.fillRect(0, 0, vw, vh); }
  if (flashBlue > 0) { ctx.fillStyle = `rgba(150,220,255,${flashBlue})`; ctx.fillRect(0, 0, vw, vh); }
  if (player && player.frozen && phase === "play") {
    const fr = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
    fr.addColorStop(0, "rgba(160,220,255,0)"); fr.addColorStop(1, "rgba(160,220,255,0.45)");
    ctx.fillStyle = fr; ctx.fillRect(0, 0, vw, vh);
  }
}

function drawMinimap(vw) {
  const fl = L.floors[L.cur];
  const y0 = fl.row0 * P, hh = fl.rows * P + W;
  const s = Math.min(200 / L.worldW, 170 / hh), mw = L.worldW * s, mh = hh * s;
  if (Math.round(mh) !== Math.round(miniH)) { miniH = mh; layoutBoard(); }
  const ox = vw - 22 - Math.max(mw, 200) + (Math.max(mw, 200) - mw) / 2, oy = 18;
  ctx.save();
  ctx.beginPath(); roundRect(ox - 8, oy - 8, mw + 16, mh + 16, 12);
  ctx.fillStyle = "rgba(13,10,31,0.82)"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.translate(ox, oy); ctx.scale(s, s); ctx.translate(0, -y0);
  ctx.beginPath(); ctx.rect(0, y0, L.worldW, hh); ctx.clip();
  const st = STYLES[(fl.depth - 1) % STYLES.length];
  ctx.fillStyle = st.floor;
  for (let j = fl.row0; j < fl.row0 + fl.rows; j++) for (let i = 0; i < L.COLS; i++) {
    if (!L.explored[cidx(i, j)] && !debug) continue;
    ctx.fillRect(i * P + W, j * P + W, C, C);
    if (i + 1 < L.COLS && L.eOpen[j][i]) ctx.fillRect(i * P + W + C, j * P + W, W, C);
    if (j + 1 < fl.row0 + fl.rows && L.sOpen[j][i]) ctx.fillRect(i * P + W, j * P + W + C, C, W);
  }
  const g = fl.gate;
  if (L.explored[cidx(g.i, g.j)] || debug) {
    ctx.fillStyle = g.open ? "#48e28a" : g.color;
    ctx.fillRect(tpos(g.tx) - 10, tpos(g.ty) - 10, C + 20, W + 20);
  }
  for (const p of g.plates) if (L.explored[cidx(p.i, p.j)] || debug) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 46, 0, Math.PI * 2); ctx.fillStyle = g.open ? "#8a8399" : p.power > 0 ? "#48e28a" : g.color; ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = p === g.yours && !g.open ? "#ffffff" : INK; ctx.stroke();
  }
  for (const m of crew) {
    ctx.beginPath(); ctx.arc(m.x, m.y, m.isPlayer ? 58 : 44, 0, Math.PI * 2);
    ctx.fillStyle = m.frozen ? "#9fe0ff" : m.isPlayer ? "#ffd23f" : m.look.shirt; ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = INK; ctx.stroke();
  }
  if (debug) { ctx.beginPath(); ctx.arc(monster.x, monster.y, 50, 0, Math.PI * 2); ctx.fillStyle = "#ff3b4e"; ctx.fill(); }
  ctx.restore();
}

// G: show the algorithms (maze graph, BFS distance from the shadow, A* paths)
function drawDebug() {
  if (monster.x < -1000) return;
  const field = kit.bfs(...cellOf(monster), true);
  let maxd = 1; for (const v of field) maxd = Math.max(maxd, v);
  ctx.font = "bold 22px 'Fredoka', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let j = 0; j < L.ROWS; j++) for (let i = 0; i < L.COLS; i++) {
    const d = field[cidx(i, j)], x = ccx(i), y = ccx(j);
    if (x < view.x0 - P || x > view.x1 + P || y < view.y0 - P || y > view.y1 + P) continue;
    const t = d < 0 ? 1 : d / maxd;
    ctx.fillStyle = `rgba(255,${Math.round(lerp(40, 255, t))},${Math.round(lerp(60, 120, t))},${lerp(0.26, 0.0, t)})`;
    ctx.fillRect(x - C / 2, y - C / 2, C, C);
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    if (i + 1 < L.COLS && L.eOpen[j][i]) { ctx.moveTo(x, y); ctx.lineTo(x + P, y); }
    if (j + 1 < L.ROWS && L.sOpen[j][i]) { ctx.moveTo(x, y); ctx.lineTo(x, y + P); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.strokeText(String(d), x + 22, y - 22); ctx.fillStyle = "#fff"; ctx.fillText(String(d), x + 22, y - 22);
  }
  const drawPath = (a, col, dash) => {
    if (!a.path || !a.path.length) return;
    ctx.setLineDash(dash); ctx.lineWidth = 8; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    for (const [i, j] of a.path) ctx.lineTo(ccx(i), ccx(j));
    ctx.stroke(); ctx.setLineDash([]);
  };
  // the Watcher's current A* route to whoever it's after (the server runs the real one)
  const tgt = team.find((m) => m.name === monster.target);
  if (tgt) drawPath({ x: monster.x, y: monster.y, path: kit.astar(...cellOf(monster), ...cellOf(tgt), true) }, "rgba(255,50,70,0.95)", []);
  // station → gate links
  for (const g of L.gates) for (const p of g.plates) {
    ctx.setLineDash([6, 10]); ctx.lineWidth = 3; ctx.strokeStyle = g.color;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tpos(g.tx) + C / 2, tpos(g.ty) + W / 2); ctx.stroke(); ctx.setLineDash([]);
  }
}
function updateDebugPanel() {
  const el = $("debugpanel");
  el.classList.toggle("hidden", !debug);
  if (!debug || !L) return;
  const fs = L.floors[L.cur].spec;
  el.innerHTML = `<b>Shaft</b> seed ${L.seed} · ${L.COLS} columns wide for a team of ${L.size}. Floor ${level} is ${fs.rows} rows: a randomised depth-first-search (recursive backtracker) maze with ${Math.round(fs.braid * 100)}% of dead ends knocked through to make loops. Its gate in the bottom wall is the only way down; the next floor is generated when you arrive.<br>
  <b>Circuit</b> ${fs.need} ${fs.kind}${fs.need === 1 ? "" : "s"}, lights stay green ${fs.window.toFixed(1)} s.<br>
  <b>Stations</b> (levers / plates) placed by BFS: far from the entrance and the gate, then as far apart from each other as possible, against a north wall for the light panel.<br>
  <b>The Watcher</b> state: ${monster.mode}${monster.target ? ` (after ${escapeHtml(monster.target)})` : ""}. It runs on the server: A* with a Manhattan heuristic over the cell graph, re-planned every half second. Numbers on the floor are BFS steps from it; the red line is its route.<br>
  <b>Same walls everywhere</b>: the server only sent the seed; this page generated the shaft itself (${kit.stats.astarCalls} A* searches drawn here).`;
}

function drawNameTag(a) {
  const y = a.y - 108;
  ctx.save();
  ctx.font = "700 15px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(a.name).width + 14;
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); roundRect(a.x - w / 2, y - 10, w, 20, 8); ctx.fillStyle = a.isPlayer ? "#ffd23f" : a.frozen ? "#9fe0ff" : a.bot ? "rgba(31,174,149,0.85)" : "rgba(29,27,38,0.78)"; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = a.isPlayer || a.frozen ? INK : "#fbf6ec"; ctx.fillText(a.name, a.x, y + 1);
  ctx.restore();
}

// ---------------------------------------------------------------- loop
let crew = []; // teammates who are connected (the ones drawn)
let started = false;
function startGame() {
  if (started) return;
  started = true;
  Sfx.init();
  if (Sfx.a) { Sfx.a.resume(); Sfx.drone(); }
  $("title").classList.add("hidden"); $("hud").classList.remove("hidden");
}
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  // the match is already running: any key gets you in
  if (!started && teams.length && !["Tab", "Escape"].includes(e.code)) startGame();
  if (e.code === "KeyG" && L && isHost()) { debug = !debug; updateDebugPanel(); }
  if (myTeam >= 0 && (e.code === "KeyE" || e.code === "Space" || e.code === "Enter")) Net.send({ t: "use" });
  if (myTeam < 0 && teams.length && (e.code === "KeyQ" || e.code === "KeyE")) {
    const n = teams.length;
    Net.send({ t: "watch", team: (watching + (e.code === "KeyE" ? 1 : n - 1)) % n });
  }
});
addEventListener("wheel", (e) => { cam.target = clamp(cam.target * (e.deltaY > 0 ? 0.9 : 1.1), 0.45, 1.8); }, { passive: true });
$("start").addEventListener("click", startGame);
$("board").addEventListener("click", (e) => { const r = e.target.closest(".brow"); if (r && myTeam < 0) Net.send({ t: "watch", team: +r.dataset.n }); });

let last = performance.now(), dbgT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  adaptQuality(dt);
  if (myTeam >= 0) Input.tick(now);
  crew = team.filter((m) => m.on);
  update(dt);
  dbgT -= dt; if (debug && dbgT <= 0) { dbgT = 0.5; updateDebugPanel(); }
  render();
  requestAnimationFrame(frame);
}

window.__game = { get L() { return L; }, get team() { return team; }, get player() { return player; }, get phase() { return phase; }, monster, cam, get teams() { return teams; } };
loadImages().then(() => requestAnimationFrame(frame));
Net.start();
