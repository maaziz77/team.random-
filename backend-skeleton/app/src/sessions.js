"use strict";
// ============================================================================================
// STUB: sessions, host/join codes, players, reconnects, the 30 Hz tick loop (task #4), and the
// bot parts (addBots, clearBots, replaceBot: task #6).
// Spec: docs/SESSIONS.md and docs/PROTOCOL.md. Keep these names: server.js and the other tasks
// rely on them.
// ============================================================================================
const { LobbySim } = require("./lobby");
const { MazeMatch } = require("./maze");
const { makeLook } = require("./look");
void LobbySim; void MazeMatch; void makeLook;

// TODO (task #4): CODE_CHARS, MAX_PLAYERS (40), TICK_HZ (30), LOBBY_GRACE (15), EMPTY_LIFETIME (120),
// RESULTS_TIME (14); TODO (task #6): BOT_NAMES. All values in docs/SESSIONS.md.

const sessions = new Map();   // code → Session
const sessionOf = new Map();  // username → the Session they're in
void sessionOf;

class Session {
  // TODO (task #4): constructor(host): code, host, players, stage, matchMinutes = 5, lobby, match, ...
  // TODO (task #4): connected(), humans(), freeNum(), newPlayer(name, bot), addPlayer(name), removePlayer(name), pickHost()
  // TODO (task #6): bots(), replaceBot(name), addBots(n), clearBots()
  // TODO (task #4): attach(p, ws), detach(p, ws), hello(p), roster(), broadcast(msg), onMessage(p, m)
  // TODO (task #4): tick(dt), startMaze(teams), backToLobby(), destroy()
}
void Session;

// TODO (task #4): the connection: first message host/join, rate limit 120/s, 10 s join timeout,
// pings, then session.onMessage. See docs/SESSIONS.md ("connect").
function connect(ws, user) { void user; ws.close(1011, "not built yet"); }

// TODO (task #4): the 30 Hz tick loop over every session, and the 20 s ping loop.
function start() {}

module.exports = { connect, start, sessions };
