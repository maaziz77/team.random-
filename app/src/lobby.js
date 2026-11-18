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
    // TODO (task #5): the rest of the state (doors, timers, carousel, occ, watcher, ...)
  }
  // TODO (task #5): people
  addPerson(p) { void p; }
  removePerson(name) { void name; }
  isCarried(name) { void name; return false; }
  // TODO (task #6): a real player takes over a bot's spot
  replacePerson(botName, p) { void botName; void p; }
  // TODO (task #5): valid, crossing, moveActor, countCells, inCells, outsiders,
  // start, ensureRoom, setPhase, emptiestCell, updateWatcher, shove, finish
  start() {}
  drainEvents() { const e = this.events; this.events = []; return e; }
  // TODO (task #6): steerTo, wanderVel, roomOf, navToRoom, chooseCell, botVel
  // TODO (task #5): one tick of the simulation
  update(dt) { void dt; }
  // TODO (task #5): the "L" snapshot (docs/PROTOCOL.md)
  snapshot() { return { t: "L", ph: this.phase }; }
}

module.exports = { LobbySim, planLobby };
