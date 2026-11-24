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

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const MAX_PLAYERS = 40;
const TICK_HZ = 30;
const LOBBY_GRACE = 15;      // s a disconnected player keeps their place in the lobby
const EMPTY_LIFETIME = 120;  // s a session with no connected humans survives
const RESULTS_TIME = 14;     // s on the results screen before going back to the lobby
const BOT_NAMES = ["Ada", "Bea", "Cal", "Dot", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lou", "Max", "Ned", "Oz", "Pip",
  "Quin", "Rex", "Sid", "Tia", "Uma", "Vic", "Wes", "Xan", "Yui", "Zed", "Ari", "Bo", "Cy", "Di", "Ed", "Flo", "Gil", "Hux", "Ike", "Jem", "Kai", "Lev", "Mo", "Nia"];

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

  // ---- bots (docs/SESSIONS.md, docs/BOTS.md)
  bots() { return [...this.players.values()].filter((p) => p.bot); }
  // TODO (task #6): the real replaceBot(name) (placeholder until then: never replaces)
  replaceBot(name) { void name; return null; }
  addBots(n) {
    for (let i = 0; i < n && this.players.size < MAX_PLAYERS; i++) {
      const free = BOT_NAMES.find((b) => !this.players.has("Bot-" + b));
      const name = free ? "Bot-" + free : "Bot-" + (this.players.size + 1);
      const p = this.newPlayer(name, true);
      this.players.set(name, p);
      this.lobby.addPerson(p);
    }
    this.rosterChanged = true;
  }
  clearBots() { for (const b of this.bots()) this.removePlayer(b.name); }

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

  // ---- one tick of the session (docs/SESSIONS.md)
  tick(dt) {
    this.stageT += dt;
    for (const p of [...this.players.values()]) {
      if (p.ws || p.bot) continue;
      p.offFor += dt;
      if (this.stage === "lobby" && p.offFor > LOBBY_GRACE) this.removePlayer(p.name);
    }
    if (this.host) {
      const h = this.players.get(this.host);
      if (!h || (!h.ws && h.offFor > 5)) {
        const c = this.connected();
        if (c.length) { this.host = c[0].name; this.rosterChanged = true; }
      }
    }
    if (!this.connected().length) {
      this.emptyFor += dt;
      if (this.emptyFor > EMPTY_LIFETIME) { this.destroy(); return; }
    } else this.emptyFor = 0;
    if (this.rosterChanged) { this.rosterChanged = false; this.broadcast(this.roster()); }

    if (this.stage === "lobby") {
      this.lobby.update(dt);
      for (const e of this.lobby.drainEvents()) this.broadcast(e);
      this.broadcast(this.lobby.snapshot());
      if (this.lobby.done) this.startMaze(this.lobby.teams);
    } else {
      const match = this.match;
      match.update(dt);
      const snaps = new Map();
      const viewOf = (p) => (p.team >= 0 ? p.team : match.clampTeam(p.watch));
      for (const p of this.connected()) {
        const team = viewOf(p);
        if (!snaps.has(team)) snaps.set(team, JSON.stringify(match.snapshot(team)));
        send(p.ws, snaps.get(team));
      }
      for (const [team, e] of match.drainEvents()) {
        const s = JSON.stringify(e);
        for (const p of this.connected()) if (viewOf(p) === team) send(p.ws, s);
      }
      if (match.boardDue()) this.broadcast(match.board());
      if (this.stage === "maze" && match.over) {
        this.stage = "results"; this.stageT = 0;
        this.broadcast(match.results());
      } else if (this.stage === "results" && this.stageT > RESULTS_TIME) this.backToLobby();
    }
  }
  startMaze(teams) {
    for (const p of this.players.values()) p.team = -1;
    for (const t of teams) for (const name of t.members) {
      const p = this.players.get(name);
      if (p) p.team = t.id;
    }
    this.match = new MazeMatch(this, teams);
    this.stage = "maze"; this.stageT = 0;
    this.rosterChanged = true;
    this.broadcast({ t: "go", to: "/maze?code=" + this.code });
  }
  backToLobby() {
    for (const p of this.humans()) if (!p.ws) this.removePlayer(p.name);
    for (const p of this.players.values()) { p.team = -1; p.watch = 0; }
    this.match = null; this.stage = "lobby"; this.stageT = 0;
    this.lobby = new LobbySim(this);
    for (const p of this.players.values()) this.lobby.addPerson(p);
    this.rosterChanged = true;
    this.broadcast({ t: "go", to: "/play?code=" + this.code });
  }
  destroy() {
    sessions.delete(this.code);
    for (const name of this.players.keys()) if (sessionOf.get(name) === this) sessionOf.delete(name);
  }
}

// The connection: first message host/join, rate limit 120/s, 10 s join timeout, pings, then
// session.onMessage. See docs/SESSIONS.md ("connect").
function connect(ws, user) {
  let session = null, player = null;
  let budget = 120;
  const refill = setInterval(() => { budget = 120; }, 1000);
  const joinTimer = setTimeout(() => { if (!player) ws.close(4001, "no join"); }, 10000);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (data, isBinary) => {
    if (isBinary || --budget < 0) {
      if (budget < -60) ws.close(4008, "too fast");
      return;
    }
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== "object" || Array.isArray(m) || typeof m.t !== "string") return;

    if (!player) {
      if (m.t === "host") {
        const old = sessionOf.get(user);
        if (old) old.removePlayer(user);
        session = new Session(user);
      } else if (m.t === "join") {
        const code = typeof m.code === "string" ? m.code.toUpperCase() : "";
        session = sessions.get(code);
        if (!session) {
          send(ws, { t: "err", code: "nosession" });
          ws.close(4004, "no session");
          return;
        }
        if (!session.players.has(user) && session.players.size >= MAX_PLAYERS && !session.bots().length) {
          send(ws, { t: "err", code: "full" });
          ws.close(4005, "full");
          return;
        }
        const old = sessionOf.get(user);
        if (old && old !== session) old.removePlayer(user);
      } else return;
      player = session.addPlayer(user);
      session.attach(player, ws);
      return;
    }
    if (session.players.get(user) !== player || player.ws !== ws) return; // replaced/removed
    session.onMessage(player, m);
  });

  ws.on("close", () => {
    clearInterval(refill);
    clearTimeout(joinTimer);
    if (session && player) session.detach(player, ws);
  });
  ws.on("error", () => {}); // close follows
}

// The 30 Hz tick loop over every session, and the 20 s ping loop.
function start() {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const s of [...sessions.values()]) {
      try { s.tick(dt); } catch (e) { console.error(`app: session ${s.code} tick failed`, e); }
    }
  }, 1000 / TICK_HZ);
  setInterval(() => {
    for (const s of sessions.values()) {
      for (const p of s.connected()) {
        const ws = p.ws;
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 20000);
}

module.exports = { connect, start, sessions };
