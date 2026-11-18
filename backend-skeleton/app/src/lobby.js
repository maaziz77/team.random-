"use strict";
// ============================================================================================
// STUB: the lobby simulation (task #5) and the lobby bots' brain (task #6).
// Spec: docs/LOBBY.md (and docs/BOTS.md for the bot part). Keep the class, method and export
// names: sessions.js calls them.
// ============================================================================================

// TODO (task #5): constants (ROOMS, R, WALL, DEPTH, RWALL, DOOR_HALF, CAROUSEL_R, PED_R, SW, BODY_R,
// ZONE_R, GATHER = 20, ALLIN_T = 8.2, SEAL_T, MAX_TEAM, SPEED, CAROUSEL_SPEED, CELL_COLORS) and
// helpers (polar, sectorOf, fromPolar, doorPoint, cellOf, roomSpot). TODO (task #6): BOT_AFK.

// teams of up to 4: just enough cells for everyone (docs/LOBBY.md)
// TODO (task #5)
function planLobby(n) { void n; return { teams: 1, cap: 4 }; }

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
