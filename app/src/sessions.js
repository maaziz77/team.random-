"use strict";
// ============================================================================================
// Sessions, host/join codes, players, reconnects, the 30 Hz tick loop (task #4), and the
// bot parts (addBots, clearBots, replaceBot: task #6).
// Spec: docs/SESSIONS.md and docs/PROTOCOL.md. Keep these names: server.js and the other tasks
// rely on them.
// ============================================================================================
const { LobbySim } = require("./lobby");
const { MazeMatch } = require("./maze");
const { makeLook } = require("./look");
void MazeMatch;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const MAX_PLAYERS = 40;
const TICK_HZ = 30;
const LOBBY_GRACE = 15;      // s a disconnected player keeps their place in the lobby
const EMPTY_LIFETIME = 120;  // s a session with no connected humans survives
const RESULTS_TIME = 14;     // s on the results screen before going back to the lobby
// TODO (task #6): BOT_NAMES. All values in docs/SESSIONS.md.
void TICK_HZ; void LOBBY_GRACE; void EMPTY_LIFETIME; void RESULTS_TIME;

const sessions = new Map();   // code → Session
const sessionOf = new Map();  // username → the Session they're in (one session per user)
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); };

function newCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (sessions.has(code));
  return code;
}

class Session {
  constructor(host) {
    this.code = newCode();
    this.host = host;
    this.players = new Map();   // name → player, insertion order = roster order
    this.stage = "lobby";
    this.matchMinutes = 5;
    this.lobby = new LobbySim(this);
    this.match = null;
    this.emptyFor = 0;
    this.stageT = 0;
    this.rosterChanged = false;
    sessions.set(this.code, this);
  }

  // ---- players
  connected() { return [...this.players.values()].filter((p) => p.ws); }
  humans() { return [...this.players.values()].filter((p) => !p.bot); }
  freeNum() {
    const used = new Set([...this.players.values()].map((p) => p.num));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }
  newPlayer(name, bot) {
    return { name, bot, num: this.freeNum(), look: makeLook(), ws: null, offFor: 0, input: { x: 0, y: 0 },
      act: false, shove: false, team: -1, watch: 0 };
  }
  addPlayer(name) {
    let p = this.players.get(name);
    if (p) return p;
    if (this.bots().length) p = this.replaceBot(name);
    if (!p) {
      p = this.newPlayer(name, false);
      this.players.set(name, p);
      if (this.stage === "lobby") this.lobby.addPerson(p);
    }
    this.rosterChanged = true;
    sessionOf.set(name, this);
    return p;
  }
  removePlayer(name) {
    this.players.delete(name);
    if (sessionOf.get(name) === this) sessionOf.delete(name);
    this.lobby.removePerson(name);
    if (this.match) this.match.memberGone(name);
    if (this.host === name) this.pickHost();
    this.rosterChanged = true;
  }
  pickHost() {
    const c = this.connected()[0] || this.humans()[0];
    this.host = c ? c.name : null;
  }

  // TODO (task #6): the real bots(), replaceBot(name), addBots(n), clearBots() (placeholders
  // until then: there are no bots yet)
  bots() { return []; }
  replaceBot(name) { void name; return null; }
  addBots(n) { void n; }
  clearBots() {}

  // ---- connections
  attach(p, ws) {
    if (p.ws && p.ws !== ws) {
      send(p.ws, { t: "err", code: "elsewhere" });
      p.ws.close(4000);
    }
    p.ws = ws; p.offFor = 0; p.input = { x: 0, y: 0 };
    this.rosterChanged = true;
    send(ws, this.hello(p));
    send(ws, this.roster());
    if (this.stage !== "lobby" && this.match) send(ws, this.match.intro(p));
  }
  detach(p, ws) {
    if (p.ws !== ws) return;
    p.ws = null; p.offFor = 0; p.input = { x: 0, y: 0 };
    this.rosterChanged = true;
  }
  hello(p) {
    return { t: "hello", code: this.code, you: p.name, num: p.num, host: this.host, stage: this.stage };
  }
  roster() {
    return {
      t: "roster", host: this.host, max: MAX_PLAYERS, minutes: this.matchMinutes,
      players: [...this.players.values()].map((p) => ({ n: p.name, num: p.num, look: p.look, on: !!(p.ws || p.bot), bot: p.bot, team: p.team })),
    };
  }
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) send(p.ws, s);
  }
  // client → server messages (docs/PROTOCOL.md)
  onMessage(p, m) {
    const isHost = p.name === this.host;
    const inWait = this.stage === "lobby" && this.lobby.phase === "wait";
    switch (m.t) {
      case "in": {
        const axis = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
        p.input = { x: axis(m.x), y: axis(m.y) };
        break;
      }
      case "shove":
        if (this.stage === "lobby") p.shove = true;
        break;
      case "use":
        if (this.stage === "maze") p.act = true;
        break;
      case "start":
        if (isHost && this.stage === "lobby") this.lobby.start();
        break;
      case "length":
        if (isHost && inWait && [2, 3, 4, 5].includes(m.min)) { this.matchMinutes = m.min; this.rosterChanged = true; }
        break;
      case "bots":
        if (!isHost || !inWait) break;
        if (m.clear === true) this.clearBots();
        else if (Number.isInteger(m.add)) this.addBots(Math.max(1, Math.min(40, m.add)));
        break;
      case "watch":
        if (Number.isInteger(m.team)) p.watch = m.team;
        break;
      case "ping":
        send(p.ws, { t: "pong", c: m.c });
        break;
    }
  }
  // TODO (task #4): tick(dt), startMaze(teams), backToLobby(), destroy()
}
void Session;

// TODO (task #4): the connection: first message host/join, rate limit 120/s, 10 s join timeout,
// pings, then session.onMessage. See docs/SESSIONS.md ("connect").
function connect(ws, user) { void user; ws.close(1011, "not built yet"); }

// TODO (task #4): the 30 Hz tick loop over every session, and the 20 s ping loop.
function start() {}

module.exports = { connect, start, sessions };
