"use strict";
// ============================================================================================
// STUB: the lobby simulation (task #5) and the lobby bots' brain (task #6).
// Spec: docs/LOBBY.md (and docs/BOTS.md for the bot part). Keep the class, method and export
// names: sessions.js calls them.
// ============================================================================================

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const ROOMS = 10, R = 560, WALL = 36, DEPTH = 250, RWALL = 26, DOOR_HALF = 52;
const CAROUSEL_R = 340, PED_R = 78, SW = (Math.PI * 2) / ROOMS, BODY_R = 13;
const ZONE_R = R - BODY_R - 2;  // past this radius you count as in (or stepping into) a cell
const GATHER = 20;              // seconds to pick a cell after the host presses Start
const ALLIN_T = 8.2;            // everyone's in → doors slam after 8.2 s (timed to the music on the client)
const SEAL_T = 2.6;             // doors shut → teams formed after 2.6 s
const MAX_TEAM = 4;
// TODO (task #6): BOT_AFK
const SPEED = 205;              // player speed px/s
const CAROUSEL_SPEED = 0.42;    // rad/s
const CELL_COLORS = ["#ffd23f", "#3fa7ff", "#ff6f86", "#43c47a", "#9b6bff", "#ffb000", "#1fae95", "#ff7a3d", "#5b7bff", "#c98b5a"];

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const polar = (x, y) => [Math.hypot(x, y), Math.atan2(y, x)];
const sectorOf = (th) => ((Math.round(th / SW) % ROOMS) + ROOMS) % ROOMS;
const sectorPhi = (th, s) => wrap(th - s * SW);
const fromPolar = (r, th) => [Math.cos(th) * r, Math.sin(th) * r];
const doorPoint = (s, r) => fromPolar(r, s * SW);
void doorPoint; // used by the bot brain (task #6)
function cellOf(x, y) { const [r, th] = polar(x, y); return r > ZONE_R ? sectorOf(th) : -1; }
// a random standing spot inside cell s
function roomSpot(s) {
  const r = rand(R + WALL + 55, R + WALL + DEPTH - 45);
  const maxPhi = SW / 2 - (RWALL / 2 + BODY_R + 12) / r;
  return fromPolar(r, s * SW + rand(-maxPhi, maxPhi) * 0.85);
}

// teams of up to MAX_TEAM: just enough cells for everyone, each holding an even share
function planLobby(n) {
  const teams = clamp(Math.ceil(n / MAX_TEAM), 1, ROOMS);
  return { teams, cap: Math.ceil(n / teams) };
}

class LobbySim {
  constructor(session) {
    this.session = session;
    this.people = new Map();
    this.phase = "wait";
    this.events = [];
    this.done = false; this.teams = null;
    this.doors = [];
    for (let s = 0; s < ROOMS; s++) this.doors.push({ open: 0, target: 0, live: false, flash: 0 });
    this.phaseT = 0; this.gatherLeft = GATHER; this.teamCount = 0; this.cap = MAX_TEAM;
    this.carouselAngle = 0; this.carouselSpeed = CAROUSEL_SPEED; this.occ = new Array(ROOMS).fill(0);
    this.watcher = { x: 0, y: 0, vx: 0, vy: 0, mode: "home", pause: 0, scale: 1, carry: null, dest: null };
  }

  // ---- people
  addPerson(p) {
    if (this.people.has(p.name)) return;
    let x, y;
    do { [x, y] = fromPolar(rand(PED_R + 30, CAROUSEL_R - 24), rand(0, Math.PI * 2)); } while (!this.valid(x, y));
    this.people.set(p.name, {
      p, name: p.name, x, y, vx: 0, vy: 0, face: 1,
      stun: 0, shoveT: 0, shoveCd: 0, shoveDir: [1, 0], carried: false,
      // bot brain (docs/BOTS.md)
      goal: -1, wp: null, wpRoom: -1, wanderT: 0, joinAt: rand(3, GATHER * 0.7),
      afk: false, // TODO (task #6): !!p.bot && Math.random() < BOT_AFK
      speed: p.bot ? rand(150, 185) : SPEED,
    });
    if (this.teamCount && this.phase !== "wait") this.ensureRoom();
  }
  removePerson(name) {
    const w = this.watcher;
    if (w.carry && w.carry.name === name) { w.carry = null; w.dest = null; }
    this.people.delete(name);
  }
  isCarried(name) { const a = this.people.get(name); return !!(a && a.carried); }
  // TODO (task #6): a real player takes over a bot's spot
  replacePerson(botName, p) { void botName; void p; }

  // ---- geometry
  valid(x, y, rad = BODY_R) {
    const [r, th] = polar(x, y);
    if (r < PED_R + rad) return false;
    if (r <= R - rad) return true;                                   // the hall
    const s = sectorOf(th), phi = sectorPhi(th, s);
    if (r < R + WALL + rad) return this.doors[s].open > 0.55 && Math.abs(phi) * R <= DOOR_HALF - rad * 0.7; // the doorway
    if (r > R + WALL + DEPTH - rad) return false;                     // back wall
    return (SW / 2 - Math.abs(phi)) * r >= RWALL / 2 + rad;           // inside the cell, clear of its side walls
  }
  // a full or closed cell turns people away; once the Watcher is mad (or sealing), nobody walks out
  crossing(a, nx, ny) {
    const from = cellOf(a.x, a.y), to = cellOf(nx, ny);
    if (from === to) return false;
    if (to >= 0 && (!this.doors[to].live || this.occ[to] >= this.cap)) return true;
    return from >= 0 && (this.phase === "mad" || this.phase === "seal");
  }
  // try the full move, then each axis, then slide along the circle
  moveActor(a, dx, dy) {
    const ok = (x, y) => this.valid(x, y) && !this.crossing(a, x, y);
    if (ok(a.x + dx, a.y + dy)) { a.x += dx; a.y += dy; return; }
    if (ok(a.x + dx, a.y)) { a.x += dx; return; }
    if (ok(a.x, a.y + dy)) { a.y += dy; return; }
    const [r, th] = polar(a.x, a.y), step = Math.hypot(dx, dy) / Math.max(r, 1);
    for (const s of [1, -1]) {
      const [tx, ty] = fromPolar(r, th + s * step);
      if ((tx - a.x) * dx + (ty - a.y) * dy > 0 && ok(tx, ty)) { a.x = tx; a.y = ty; return; }
    }
  }
  countCells() {
    this.occ = new Array(ROOMS).fill(0);
    for (const a of this.people.values()) {
      if (a.carried) continue;
      const s = cellOf(a.x, a.y);
      if (s >= 0) this.occ[s]++;
    }
  }
  inCells() { return [...this.people.values()].filter((a) => !a.carried && cellOf(a.x, a.y) >= 0); }
  outsiders() { return [...this.people.values()].filter((a) => !a.carried && cellOf(a.x, a.y) < 0); }

  // TODO (task #5): start, ensureRoom, setPhase, emptiestCell, updateWatcher, shove, finish
  start() {}
  drainEvents() { const e = this.events; this.events = []; return e; }
  // TODO (task #6): steerTo, wanderVel, roomOf, navToRoom, chooseCell, botVel
  // TODO (task #5): one tick of the simulation
  update(dt) { void dt; }
  // TODO (task #5): the "L" snapshot (docs/PROTOCOL.md)
  snapshot() { return { t: "L", ph: this.phase }; }
}

module.exports = { LobbySim, planLobby };
